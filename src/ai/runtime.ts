import { estimateEquityInBatches } from './equity';
import { executeDecision, type ExecuteResult, type LiveTurn, type NpcTableActions } from './executor';
import { buildObservation } from './observation';
import { decide, type Decided, type DecideOptions } from './strategy';
import type { AIProfile } from './profiles';
import { isBettingStage, type AIDiagnosis, type NpcSourceInput } from './types';

export interface NpcLimits {
  samples: number;
  timeBudgetMs: number;
  batchSize: number;
  overallTimeoutMs: number;
}

// 本机 Node 上，3 人翻牌 2000 次同步抽样约 100ms，超过 50ms。
// 默认只抽 200 次，并按 40 次一批让出主线程；单批约数毫秒。40ms 预算到点就返回已完成样本。
let limits: NpcLimits = {
  samples: 200,
  timeBudgetMs: 40,
  batchSize: 40,
  overallTimeoutMs: 1000,
};

const diagnostics: AIDiagnosis[] = [];
const inflight = new Set<string>();
const jobs = new Set<{ aborted: boolean }>();
let epoch = 0;

export function getNpcLimits(): NpcLimits {
  return { ...limits };
}

export function setNpcLimits(next: NpcLimits): void {
  limits = { ...next };
}

export function getNpcDiagnostics(): readonly AIDiagnosis[] {
  return diagnostics;
}

export function clearNpcDiagnostics(): void {
  diagnostics.length = 0;
}

export function invalidateNpcRuntime(): void {
  epoch += 1;
  for (const job of jobs) job.aborted = true;
}

export function resetNpcRuntimeForTests(): void {
  invalidateNpcRuntime();
  inflight.clear();
  jobs.clear();
  clearNpcDiagnostics();
}

function remember(diagnosis: AIDiagnosis): void {
  diagnostics.push(diagnosis);
  if (diagnostics.length > 40) diagnostics.shift();
}

export interface RunNpcArgs {
  source: NpcSourceInput;
  readLive: () => LiveTurn;
  actions: NpcTableActions;
  profile: AIProfile;
  options?: DecideOptions & {
    batchSize?: number;
    overallTimeoutMs?: number;
    yieldBetweenBatches?: boolean;
  };
  decideFn?: (obs: import('./types').AIObservation) => Decided | Promise<Decided>;
}

export type RunResult =
  | ExecuteResult
  | { ok: false; reason: 'in-flight' | 'fallback' | 'duplicate' | 'stale'; applied?: import('./types').AIAction; detail?: string };

function fallback(args: RunNpcArgs, token: string, detail: string): RunResult {
  const live = args.readLive();
  if (!live.tableExists || !live.betting || live.actorStatus !== 'active' || live.turnToken !== token || !live.actorId) {
    return { ok: false, reason: 'stale' };
  }
  const move = live.legal.canCheck ? { action: 'check' as const } : { action: 'fold' as const };
  const executed = executeDecision(
    { turnToken: token, actorId: live.actorId, move },
    args.readLive,
    args.actions,
  );
  const stage = isBettingStage(args.source.stage) ? args.source.stage : 'preflop';
  remember({
    profileId: args.profile.id,
    street: stage,
    reasonCode: move.action === 'check' ? 'fallback-check' : 'fallback-fold',
    samples: 0,
    equity: null,
    evReference: null,
    elapsedMs: 0,
    assumptions: [detail],
    handKey: null,
    position: null,
  });
  if (executed.ok || executed.applied) {
    return { ok: false, reason: 'fallback', applied: executed.applied ?? move, detail };
  }
  return executed;
}

async function compute(args: RunNpcArgs, observation: import('./types').AIObservation, job: { aborted: boolean }, epochAtStart: number): Promise<Decided | null> {
  if (args.decideFn) return await args.decideFn(observation);
  if (job.aborted || epochAtStart !== epoch) return null;
  if (observation.stage === 'preflop') return decide(observation, args.profile, args.options);
  const current = getNpcLimits();
  const eq = await estimateEquityInBatches(
    observation,
    {
      samples: args.options?.samples ?? current.samples,
      timeBudgetMs: args.options?.timeBudgetMs ?? current.timeBudgetMs,
      batchSize: args.options?.batchSize ?? current.batchSize,
      sampleRng: args.options?.sampleRng,
      now: args.options?.now,
      callCost: observation.callCost,
    },
    async () => {
      if (args.options?.yieldBetweenBatches === false) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    () => job.aborted || epochAtStart !== epoch,
  );
  if (job.aborted || epochAtStart !== epoch) return null;
  if (!eq.ok && eq.error === 'aborted') return null;
  return decide(observation, args.profile, { ...args.options, equityOverride: eq });
}

export async function runNpcDecision(args: RunNpcArgs): Promise<RunResult> {
  const epochAtStart = epoch;
  const built = buildObservation(args.source);
  if (!built.ok) {
    if (built.error === 'not-betting' || built.error === 'not-acting') return { ok: false, reason: 'stale' };
    const live = args.readLive();
    if (!live.betting || !live.actorId) return { ok: false, reason: 'stale' };
    return fallback(args, live.turnToken, built.error);
  }

  const token = built.observation.turnToken;
  if (inflight.has(token)) return { ok: false, reason: 'in-flight' };
  inflight.add(token);
  const job = { aborted: false };
  jobs.add(job);
  let settled = false;
  const once = (result: RunResult): RunResult => {
    if (settled) return { ok: false, reason: 'duplicate' };
    settled = true;
    return result;
  };

  const timeoutMs = args.options?.overallTimeoutMs ?? getNpcLimits().overallTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RunResult>((resolve) => {
    timer = setTimeout(() => {
      if (settled) return;
      job.aborted = true;
      const live = args.readLive();
      if (epochAtStart !== epoch || live.turnToken !== token) {
        resolve(once({ ok: false, reason: 'stale' }));
        return;
      }
      resolve(once(fallback(args, token, 'timeout')));
    }, timeoutMs);
  });

  const work = (async (): Promise<RunResult> => {
    try {
      const computed = await compute(args, built.observation, job, epochAtStart);
      if (settled || job.aborted || epochAtStart !== epoch || args.readLive().turnToken !== token) {
        return once({ ok: false, reason: 'stale' });
      }
      if (!computed) return once(fallback(args, token, 'no-decision'));
      remember(computed.diagnosis);
      return once(executeDecision(computed.decision, args.readLive, args.actions));
    } catch {
      if (settled || epochAtStart !== epoch || args.readLive().turnToken !== token) {
        return once({ ok: false, reason: 'stale' });
      }
      return once(fallback(args, token, 'error'));
    }
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    job.aborted = true;
    inflight.delete(token);
    jobs.delete(job);
  }
}
