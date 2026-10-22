# dz-pk NPC AI 接入规格

日期：2026-10-22（Asia/Shanghai）

状态：方案已写入，功能尚未实施。配套实施计划为 `docs/superpowers/plans/2026-10-22-npc-ai.md`。

项目根目录：`/Users/admin/qh/aiprogram/dz-pk`。

## 1. 要解决的问题

目前 `actAI()` 只按随机数决定弃牌、过牌、跟注、加注，不读取自己的底牌或公共牌。因此三个 NPC 虽然名字不同，打法并没有对应的牌力判断和个性。

第一版将其改为：

```text
机器人轮到行动
  → 构造只含可见信息的 observation
  → 判断起手牌 / 当前牌型 / 估算底池权益
  → 按阶段、下注价格、位置和个性选择动作
  → 检查轮次、动作和金额
  → 调用现有牌桌动作方法
```

目标是做出可解释、合法、不透视、可测试的本地规则 NPC。策略收益和强度需要后续测量；本次不宣称 GTO、职业水平或已经优于所有对手。

## 2. 第一版边界

包含：

- TypeScript 本地决策模块，与 Zustand 和 React 分开。
- 翻前的显式起手牌范围、位置与面对加注的规则。
- 翻后的 Monte Carlo 权益估计，正确补全公共牌、处理多人和平局。
- 赔率、筹码与边池资格作为继续下注的参考。
- 三种 NPC 风格，映射到稳定玩家 ID。
- NPC 专用执行适配器、计算预算、错误兜底和过期结果丢弃。
- 有意义的单元测试、牌桌集成回归、性能测量及本地试玩。

后续阶段：对手动作推断加权范围、长期对手统计、联网多人牌桌、服务器权威引擎、大模型 API、CFR / 强化学习 / 自我训练。

沿用现有牌桌、发牌、资金和日志流程。本次不改远程部署、资金余额或数据库，不自动发布。独立实现这些算法，不复制、逐行翻译或移植 GPLv2 Java 仓库代码。

### 2.1 texaspoker 的具体借鉴点

参考仓库：[wangtaoking1/texaspoker](https://github.com/wangtaoking1/texaspoker)。已审阅版本固定为 `ae7a1607147666800eb2823843f678be07dff8ed`，不能用 GitHub 页面更新时间推断代码仍在持续维护。

本方案参考其设计组织；目前只完成分析和规格，尚未接入或复用任何 Java 实现。开发时先阅读下列源文件，再依据 dz-pk 的数据结构独立实现对应模块。

| 原仓库模块 | 可借鉴的思路 | dz-pk 对应实现 |
| --- | --- | --- |
| [SuperAI.java](https://github.com/wangtaoking1/texaspoker/blob/ae7a1607147666800eb2823843f678be07dff8ed/trunk/game/works/source/utils/SuperAI.java) | 保存自己的底牌、公共牌和公开下注信息；通过 `thinkAfterHold / Flop / Turn / River` 按街拆决策 | 白名单 `observation`；翻前规则与翻牌 / 转牌 / 河牌策略分开组织 |
| 同文件的 `getResponse()` | 将策略意图转换为统一动作响应 | `AIAction` 与 NPC executor；重新定义金额与合法性，不沿用其竞赛协议 |
| [SelectAI.java](https://github.com/wangtaoking1/texaspoker/blob/ae7a1607147666800eb2823843f678be07dff8ed/trunk/game/works/source/AdvancedAI/SelectAI.java) | 依据 6–8 / 4–5 / 3 / 2 人选择策略 | 人数与短桌位置影响范围、权益和规则；NPC 个性另由 profile 调节，不把原类名当成个性模型 |
| [ProbAI.java](https://github.com/wangtaoking1/texaspoker/blob/ae7a1607147666800eb2823843f678be07dff8ed/trunk/game/works/source/probability/ProbAI.java) | 翻前按对子、高牌、同花、连接性等特征分组；翻后结合牌力、跟注金额和行动位置组织规则 | `preflop.ts` 与 `strategy.ts` 的特征、分支和配置；具体范围、阈值与尺寸通过当前牌桌测试确定 |
| [ProbabilityComputer.java](https://github.com/wangtaoking1/texaspoker/blob/ae7a1607147666800eb2823843f678be07dff8ed/trunk/game/works/source/probability/ProbabilityComputer.java) | 从已知牌之外构造对手可能底牌，比较牌力 | `equity.ts` 的未知牌集合；概率算法重新实现为补齐公共牌、多人联合抽样、平局分池 |

必须保留的审计结论：

- 默认 `GameClient` 实际实例化 `ProbAI`，`SelectAI` 被注释；它不是当前默认运行策略。参考时区分可用设计与实际入口。
- 旧概率计算在翻牌 / 转牌只比较当前公共牌，没有补齐未来公共牌；`>=` 将平局计为“不输”，不能当作底池权益。多人又用单挑概率乘方，不能直接用于本方案。
- 原策略中的概率阈值、固定盲注倍数与随机比例依赖旧概率口径，且没有针对当前 dz-pk 牌桌验证，不能原样搬用。
- 牌型增量计算和部分条件存在已确认缺陷，例如某个翻前高牌分支重复检查第一张底牌。因此复用现有 `pokersolver`，重新实现特征与测试。
- 三种 NPC 风格、正确边池权益、轮次防重放与计算预算是 dz-pk 的新增设计；不声称这些已经由 texaspoker 提供。

完成开发时，在这张表中补充实际函数与对应测试，说明每个借鉴点怎样落到代码。这样“参考过仓库”有可检查的实现对应关系。

## 3. 已确认的接入位置

| 当前文件 | 当前作用 | 接入方式 |
| --- | --- | --- |
| `/Users/admin/qh/aiprogram/dz-pk/src/store/gameStore.ts` | `actAI()` 与所有牌桌动作；保存完整牌局 | 替换随机决策；构造过滤后的快照；调用 NPC 执行适配器 |
| `/Users/admin/qh/aiprogram/dz-pk/src/utils/poker.ts` | `pokersolver` 牌型与胜负比较 | 复用评估能力，新增权益模拟，不把牌型排名当成胜率 |
| `/Users/admin/qh/aiprogram/dz-pk/src/components/GameTable.tsx` | 轮到 AI 时延迟 1.5 秒触发 `actAI()` | 保留展示节奏；防止重复计算与迟到执行 |
| `/Users/admin/qh/aiprogram/dz-pk/src/act/applyAction.ts` | 外部动作校验，绑定 `human` | 参考校验规则，不直接用于 NPC |
| `/Users/admin/qh/aiprogram/dz-pk/src/store/gameStore.test.ts` | 筹码、短码全下、最小加注、边池回归 | 保持通过，并补 NPC 集成用例 |
| `/Users/admin/qh/aiprogram/dz-pk/src/store/logSync.ts` | 将 `gameLog` 逐行推送云端 | 决策诊断不放入公开 `gameLog`，不破坏现有日志口径 |

现有 `playerRaise()` 已处理部分金额与全下规则；`playerCheck()` 没有检查是否面对下注。NPC 执行器必须先验证，不能依赖底层自动钳制来掩盖错误决策。

## 4. 模块组织

建议新增下列模块；允许在实现中合并很小的辅助文件，不建立通用插件框架。

```text
src/ai/
  types.ts              可见局面、合法动作、决策、诊断类型
  observation.ts        Store → 白名单快照；不保留 Store 引用
  profiles.ts           ai_0 / ai_1 / ai_2 的配置
  preflop.ts            起手牌类别、位置、翻前规则
  equity.ts             未知牌抽样、多人权益与分池回收估计
  strategy.ts           纯函数 decide；阶段规则与下注尺寸
  executor.ts           轮次与动作校验、分发到底层动作
  runtime.ts            in-flight 去重、预算、取消、错误兜底
```

若性能测量要求较多抽样，再增加 `equity.worker.ts` 或 `decision.worker.ts`。策略模块不直接 import `useGameStore`，不读取 DOM、网络或真实牌堆。

## 5. 输入与输出契约

### 5.1 Observation

快照至少包含：

- `turnToken`、`actorId`、下注街 `stage`。
- 机器人自己的两张 `holeCards`、已公开 `board`。
- `pot`、`bigBlind`、`dealerIndex`、自己的座位。
- 所有玩家的公开字段：`id / seat / chips / currentBet / invested / status`；`invested` 包含本手所有街累计投入。
- `currentMaxBet / lastRaiseSize / canRaise` 与派生的合法动作。
- 用于翻前规则的当前街公开行动概要，例如加注次数、最近加注者。若现有状态没有该信息，新增小型结构化公开行动记录；不得从含底牌的原始日志直接推断。

明确禁止传入：完整 `get()`、任何其他人的底牌、实际剩余 `deck`、原始 `gameLog`。快照复制数组与对象；以后 Store 改变不能改写正在计算的输入。

计算前验证自己的底牌恰好两张，翻前 / 翻牌 / 转牌 / 河牌公共牌分别为 0 / 3 / 4 / 5 张，已知牌合法且不重复，对手数量与未知牌量足够。非法输入返回明确失败交给 runtime 兜底，不调用评估器处理坏牌，不无限重抽，不产生 `NaN`。

### 5.2 金额口径

所有金额为有限、非负整数筹码：

```text
pot         已包含所有已投入的筹码，包括本街下注；不再加一遍 currentBet
toCall      max(0, currentMaxBet - actor.currentBet)
callCost    min(actor.chips, toCall)
minRaiseTo  currentMaxBet + lastRaiseSize
maxRaiseTo  actor.currentBet + actor.chips
raiseTo     本街累计下注总额，不是额外增加的金额
```

`minRaiseTo` 是沿用当前引擎的规则口径。若发现更广泛的德州规则问题，单独记录并用回归测试处理，不静默改写整套引擎。

### 5.3 决策类型

```ts
type AIAction =
  | { action: 'fold' }
  | { action: 'check' }
  | { action: 'call' }
  | { action: 'raise'; raiseTo: number };

interface AIDecision {
  turnToken: string;
  actorId: string;
  move: AIAction;
}
```

初次下注和加注统一使用 `raise`。短码全下跟注是 `call`；全下加注是 `raiseTo = maxRaiseTo`。无需另加一个金额语义重复的 `allin` 动作。

`decide(observation, profile, options)` 返回动作及独立诊断；纯函数中可注入 RNG、样本数和时间预算。采样随机与策略随机分开，便于固定种子重现。

诊断可包含 `profileId / street / reasonCode / samples / equity / elapsedMs / assumptions`，保存在本地开发调试结构中。默认不显示、上传或写入实时公共日志，因为权益和理由可能暴露 NPC 手牌信息。

## 6. 轮次与合法动作

执行前重新读取 Store，确认牌桌存在、处于下注街、当前玩家是该 NPC 且状态为 `active`，并匹配 `turnToken`。

新增单调递增的 `decisionRevision`。凡影响决策的牌局变动都推进版本，包括入座、离桌、开始一手、成功动作、阶段与行动玩家变化、筹码变动；单纯日志或显示变动不推进版本。

令牌绑定 `sessionId + handNumber + decisionRevision + actorId`。同一 NPC 在同一街可能第二次轮到，不能只用玩家 ID 和街区分。执行成功后旧令牌失效。

合法动作规则：

- `check`：仅 `toCall = 0`。
- `call`：仅 `toCall > 0` 且有筹码；可不足额全下跟注。
- `fold`：允许当前活跃玩家弃牌；策略在可免费过牌时优先过牌。
- `raise`：必须 `canRaise = true`，金额是有限整数且大于 `currentMaxBet`。
- 筹码够完整加注时，目标必须在 `[minRaiseTo, maxRaiseTo]`。
- 筹码不够完整加注，但 `maxRaiseTo > currentMaxBet` 时，只允许 `raiseTo = maxRaiseTo` 这一个短码全下加注目标。
- 若 `maxRaiseTo <= currentMaxBet`，只能跟注 / 弃牌，没有加注选项。

合法性在 observation 中用于约束策略，在 executor 中再次确认。非法结果记录本地诊断，对仍然有效的本轮执行安全兜底：可过牌就过牌，否则弃牌。

过期或重复结果直接丢弃。不能对新轮次执行旧请求的兜底动作。

## 7. 牌力与权益计算

### 7.1 翻前

两张底牌不能直接交给要求 5–7 张牌的牌型评估器。先归类为 `AA / AKs / AKo` 等起手牌，结合座位、人数与当前街加注情况走翻前规则。

第一版使用显式范围表，区分未开池、跟入 / 已加注、再次加注的场景。短桌位置单独映射，不能把四人桌的 UTG 直接当九人桌的 UTG。范围表和加注金额可配置、可测试，不用一个起手牌分数替代所有翻前场景。

### 7.2 翻后 Monte Carlo

1. 从新建的 52 张牌中只排除本人的底牌和公开公共牌。
2. 联合、不放回抽取 `status = active` 或 `all-in` 的对手底牌；排除 `folded` 和未参与本手的 `sitting-out` 玩家。
3. 将公共牌补足五张，再用评估器比较每个人最终最佳五张牌。
4. 单个共同争夺的池中，独赢记 `1`，输记 `0`，与总共 `k` 名玩家平分时记 `1/k`；平均值为权益。
5. 多人直接联合模拟，不用单挑概率乘方；不把平局记成整池获胜。

第一版对手范围假设为均匀随机合法组合。必须在诊断与说明中写清该假设，不能描述成已经识别出真人的实际范围。对手已弃牌但未公开的底牌也不能当作已知 blocker。

### 7.3 短筹码、边池与价格

普通无边池、本人可争夺整个池且筹码足以跟注（`callCost = toCall`）的场景，静态跟注参考门槛为：

```text
callCost / (pot + callCost)
```

这里 `pot` 已包含对手当前下注。该门槛只作规则参考，假设不再有未来投入；它不是完整的行动 EV。

短筹码 / 边池场景不能用整个底池套这个公式。将拟议 `callCost` 加到本人的累计投入，按所有玩家 `invested` 层级拆池：

- 弃牌玩家的投入贡献池金额，但没有获胜资格。
- 本人没有覆盖的边池不能计入可赢金额。
- 只有一人覆盖的未跟注超额按返还处理，不算可争夺收益。
- 分池辅助结果应分别给出可争夺池与确定返还 `refunds`；返还不乘权益，但实际回收记账不能遗漏这笔筹码。
- 每个模拟结果按各池资格分别决定获胜者和平分份额。
- 计算本人在这些池中的预计回收额，再减去本次 `callCost`，作为固定投入、直接摊牌假设下的参考值。

模拟不假设自己能赢得未投入的未来筹码，不把对手未来弃牌概率凭空加进去。可以提取一个无副作用的分池辅助函数供权益模块和结算复用，也可以独立计算并用同一组边池回归场景对照；避免为本次接入大改结算引擎。

## 8. 策略与三个风格

策略先确定合法动作，再评估继续的价格与风险，最后选择下注意图和尺寸。

翻后至少考虑：权益及其样本可靠性、跟注价格、对手人数、公共牌是否有明显顺子 / 同花可能、当前位置、有效筹码和底池大小。

价值下注是让更弱牌继续付筹码；诈唬需要合理机会和有限频率。第一版没有对手反应模型，不能声称已经精确计算价值下注或诈唬的完整 EV。

下注尺寸从少量明确候选中选择，例如部分底池或若干大盲，再通过合法目标约束。每个场景写清“额外投入”如何换算为本街 `raiseTo`，避免单位混用。

避免“牌型到某级 / 权益超过某个阈值就全下”。全下需要单独考虑价格、有效筹码与风险；第一版优先常规尺度与合理跟注。

| 稳定 ID | 显示名 | 第一版风格 |
| --- | --- | --- |
| `ai_0` | 德州老手 | 入池范围较稳健、根据价格继续、适度价值下注 |
| `ai_1` | 激进小伙 | 较宽的入池范围、较高进攻倾向、有限且有条件的诈唬 |
| `ai_2` | 保守大叔 | 较窄入池范围、对高价格更谨慎、较低诈唬频率 |

个性参数在合理策略内起作用，不能突破合法动作、信息边界或采样预算。实现时把具体范围、阈值和尺寸写进配置与测试；这些是可调整的启发式参数，不是已验证的最优解。

## 9. 运行与性能

保留 `GameTable` 的 1.5 秒展示延迟。它不代表计算耗时限制。

先测量目标浏览器下 `100 / 500 / 2000` 次抽样的耗时、对手数和每个决策总耗时，再确定默认样本数与预算，并记录设备与测试条件。

- 输入样本上限与时间预算可配置；按小批次检查预算，返回已完成的有效样本数量。
- 主线程实测单次计算超过 50ms 时，生产路径采用 Worker 或可让出主线程的分批执行；不要让长循环卡住按钮和动画。
- 同步长循环不能通过 `setTimeout` 获得强制超时保障。
- runtime 对同一个令牌只允许一个 in-flight 请求。Worker 路径设独立的整体超时并能取消 / 丢弃结果。
- 样本不足、异常、超时只对仍有效的本轮兜底。离桌 / 新手 / 新轮次取消旧工作。
- runtime 完成后释放 in-flight 状态；无论正常还是异常都不得卡住后续 NPC。

允许第一步先做同步、受预算限制的小样本实现；是否增加 Worker 由性能测量决定。公开接口保留纯策略与执行边界，为以后异步模型留空间。

## 10. 验收标准

### 信息与权益

1. 固定自己的底牌、公共局面和 RNG，改变真实对手底牌、真实 `deck` 和包含底牌的日志后，observation、权益与决策不变。
2. 计算不修改原局面；每次模拟所有牌唯一且正确补全公共牌。
   非法 / 重复牌、牌数不符和无法抽取的输入有界失败，不陷入重试循环或产生无效数字。
3. 公共牌为皇家同花顺：单挑权益为 `0.5`，四人权益为 `0.25`。
4. 河牌本人持有无法平分的绝对坚果时权益为 `1`。
5. 投入 `50 / 100 / 100` 的三人局：短码玩家只竞争 `150` 主池，不竞争 `100` 边池；弃牌贡献与超额返还另有用例。

### 动作与轮次

6. 面对下注不能过牌；无加注权限不能加注；短码跟注、短码加注及完整最小加注合法。
7. 拒绝 `NaN / Infinity / 负数 / 小数 / 非法小加注`，不产生负筹码或凭空增加筹码。
8. 一个令牌最多执行一次；离桌、新手、同一街再次轮到等场景下旧结果不执行。
9. 超时和错误可安全恢复，多个 NPC 连续行动不会死锁。

### 策略与体验

10. 固定场景与种子集下，弱牌面对高价格更少继续；强牌在合适局面有价值下注；不会自动凭牌型或单一权益阈值全下。
11. 三个 profile 在一组翻前、翻后场景中体现预期方向差异。混合打法用种子集合或控制 RNG 验证，不能要求所有随机种子都选同一动作。
12. 现有短码、最小加注、边池、资金和外部动作回归通过；本地浏览器完整打多手，界面响应正常。
13. 保存性能测量和策略行为报告。少量赢牌或对固定随机对手获胜不构成强度证明。

## 11. 完成时的交付

- 可运行的本地 NPC 三层接入和可调整的三个 profile。
- 上述核心测试及现有测试通过，生产构建成功；新增代码无新的 lint 问题。
- 记录采样默认值、实测耗时、已知近似及尚未实现的对手范围模型。
- 更新实施计划的完成项和验证结果，避免把“已写 spec”当作“功能完成”。
