import { runEquityBench, timeYieldingDecision } from './equityBench';

const rows = [
  ...runEquityBench(1, [40, 100, 500, 2000], 1),
  ...runEquityBench(3, [40, 100, 500, 2000], 2),
];
const decisions = [
  await timeYieldingDecision(1, 200, 40, 11),
  await timeYieldingDecision(3, 200, 40, 12),
  await timeYieldingDecision(3, 2000, 40, 13),
];
const out = document.querySelector('#out');
if (out) {
  out.textContent = JSON.stringify({
    runtime: 'browser',
    userAgent: navigator.userAgent,
    rows,
    decisions,
  });
}
