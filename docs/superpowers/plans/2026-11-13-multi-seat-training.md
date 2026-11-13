# 4 / 6 / 9 人桌开发计划

日期：2026-11-13

状态：已完成。验证记录见 `../reports/2026-11-13-multi-seat-training.md`。

规格：`../specs/2026-11-13-multi-seat-training-design.md`

基线：`be5ebe0`

## 目标和约束

按照规格的方案 1 增加人数选择、实际位置和规则，以及复用五档旧图表的位置近似。完整图表、多人联网和新的 AI 风格不在本期。

- 遵守 `.cursor/rules/project-workflow.mdc`：直接 main，直接验证、提交；不建分支、worktree、PR。
- 不删除用户文件，不修改或覆盖用户旧牌局。
- 本文是开发任务清单，不是已完成记录。实现时逐项勾选并记录验证结果。
- 不新增 UI 测试依赖或求解器；可复用当前 Vitest、React 静态渲染和现有浏览器。
- 旧四人满员策略用例保留，不能因为加入六/九人而改成更弱断言。

## Task 0：确认基线与接口

- [x] 查看当前状态和后续提交，若 HEAD 超过基线按新实现调整入口，不重置用户提交。
- [x] 读规格、`sessionConfig.ts`、`positions.ts`、`preflop.ts`、`defendLines.ts`、`threeBetLines.ts`、store、回顾上传校验及行动反馈。
- [x] 四人策略对照取开发前当前 HEAD 的分支结果/已有校准用例；`src/ai/baseline/` 是更早版本，不能当成本次四人行为基线。
- [x] 记录基线测试/构建结果与 lint 现有问题：

```bash
npx --no-install vitest run
npm run build
npm run lint
```

## Task 1：人数配置与稳定 NPC 列表

修改：`src/game/sessionConfig.ts`、`src/store/gameStore.ts`、`src/components/Lobby.tsx`。

测试：扩展 `src/game/training.test.ts`，或新增 `src/game/sessionConfig.test.ts`。

- [x] 加可选 `tableSize`，新选择默认 4，支持 6/9；让 `npcsFor`、`tableFromSelection` 支持默认人数参数。
- [x] 按规格生成 3/5/8 个 NPC，区分 seat id 和 profileId，额外名称带编号；保留旧三席内容。
- [x] 大厅选择独立于级别/深度/风格，预览人数和组合数量；入座后冻结。
- [x] 有旧显式 `npcs` 就保留，缺人数字段不重生成旧配置；旧 SessionSnapshot 字段保持原样。
- [x] 测试三种人数/三种组合、唯一性、旧调用、快照冻结、只扣人类买入及离桌返还。

## Task 2：共享本手位置与实际行动顺序

修改：`src/game/positions.ts`、`src/store/gameStore.ts`、必要时 `src/ai/types.ts` / `observation.ts`。

测试：新增 `src/game/positions.test.ts`，扩展 `src/store/gameStore.test.ts`。

- [x] 建立按钮 + 开局参与座位顺序的纯角色函数；支持规格 2–9 人表，四人 UTG 叫法不变。
- [x] 明确桌型容量、本手参与者、当前行动者；本手角色不会随 fold/all-in 改变。
- [x] 开局冻结真实按钮/参与顺序；真实盲注和 limper 身份均查角色，不从策略图表倒推。
- [x] 盲注、翻前、翻后、下一手按钮跳过坐出；修正真实 HU 的按钮兼 SB 及首位顺序。
- [x] 如加可选 participantSeats/坐出 null 角色，同步扩展类型和旧记录读取，不能压缩 players 数组。
- [x] 测试所有按钮轮换、坐出、短盲全下、9 人弃至两人、提前结算轮换、真正 HU。
- [x] 检查底池、边池、返还和整数余数；增加 6/9 人不同全下深度、死钱和平局守恒用例。不要重写已经正确的结算算法。

## Task 3：完整接入位置近似，而不是只改开池

修改：`src/ai/preflop.ts`、`strategy.ts`；新增纯映射模块如 `src/ai/preflopPosition.ts`。

测试：新增 `src/ai/preflopPosition.test.ts`，扩展 `strategy.test.ts` / 校准测试。

- [x] 保留五档原图表来源；实现规格映射及 0.65/0.85 前位系数、25%/60% BTN 来源权重。
- [x] 抽出可显式指定 hero/opener 图表来源的纯分支计算；不改真实 observation 来模拟位置。
- [x] middle/late 合并加权概率；前位减少非核心继续并将概率转成合法被动动作。保留一次最终 RNG 抽取。
- [x] 位置收紧豁免只用 QQ+/AKs/AKo；保留原 `isPremiumHand()` 的全下许可含义，不用它豁免所有 TT+/AQs。
- [x] 将映射用于 unopened、limp/隔离、一次开池防守、完整 3bet 三种身份和 4bet+。hero/opener 双混合使用权重乘积，矩阵缺项沿用现有回退。
- [x] 真实位置、cold callers、IP/OOP、价格闸门、有效深度、短/标准/深筹和短不足额全下逻辑不变。
- [x] 对照固定输入证明四人动作和原来一致；加入同一牌在 early/HJ/CO 的分支梯度、强牌/高风险、面对前位及后位的盲注防守测试。
- [x] 检查 0 概率、重复动作合并、总权重为 1，非法加注/无权限不漏过。

## Task 4：所有座位可见，保持现有反馈

修改：`src/components/GameTable.tsx`；可新增 `SeatPanel.tsx` / 纯布局工具。

测试：用现有 React 静态渲染测试真实输出；浏览器检查实际几何布局。

- [x] 从三个硬编码 NPC 面板抽出共享组件，按真实数组渲染；人类底部，视觉座次与引擎一致。
- [x] 显示实际角色、筹码/bb、下注、最后行动、D、当前高亮和背面牌；人类操作区、公共牌、底池不被遮住。
- [x] 显示桌型人数，保留教学栏、自动回顾选择、音效静音和隐藏页行为。
- [x] 验证 4/6/9 个真实面板及新 id 的行动反馈；不写只搜索源码字符串的新增测试。
- [x] 浏览器体验 1280×800、900×700、390×844，9 人桌不能漏人、乱序或遮住关键状态；记录截图或具体体验结果。

## Task 5：回顾与流水同步完整支持

修改：`src/ai/types.ts`、`npcContext.ts`、`runtime.ts`、`src/game/handRecord.ts`、`handReviewRecord.ts`、`src/components/HandReview.tsx`、大厅摘要及同步类型必要入口。

测试：`src/game/handReviewRecord.test.ts`、`src/store/handReviewSync.test.ts`。

- [x] 扩展实际角色、中文说明、可选人数/参与元数据及上传校验；不能只改 TS 类型漏掉 ROLES 校验集合。
- [x] 新诊断记录真实 position、可选 rangeBucket、来源权重/系数 assumptions；经 runtime 和动作快照贯穿到完整 JSON。
- [x] 更新新策略配置版本，入座与本手快照保留；旧 v1 不补字段、不重算角色、不换风格。
- [x] 六/九人档案分别验证本地回顾、build/parse、outbox 和幂等重试，完整保存每名 NPC 的依据和每席结果。
- [x] 用旧四人记录验证序列化往返不变；验证超 64KiB 的九人档案保持完整并明确同步失败，不截断。
- [x] 保留最近 20 手、可选手末展开及 human 资金账；摘要能区分桌型。

## Task 6：范围频率、运行预算与综合验收

报告：新增 `docs/superpowers/reports/2026-11-13-multi-seat-training.md`，由实现阶段填写，不提前伪造结果。

- [x] 枚举 1326 个真实组合和固定场景，分别报告 4/6/9 × 现有四种风格 × 40/100/200bb 的分档频率；含开池、面对正常开池、完整 3bet 的继续。
- [x] 核对 early-tight ≤ early ≤ 原 UTG 的同条件非核心频率，middle/late 位于两个来源之间；报告默认对手的梯度及启发式限制。不同 opener 的混合要单独对照，不拿不同价格比较。
- [x] 检查八名对手 flop/turn 抽样、批次让出主线程、有效样本数、耗时和 fallback；必要时缩小 batch，不普遍安全弃牌，不盲目提高整体超时。
- [x] 按原取消/去重测试思路覆盖九人离桌、下一手、重复触发，确保旧计算不会执行到新局。
- [x] 6/9 人各实际玩若干完整手，覆盖多人进翻牌、冷跟、再加注和回顾。固定 seed 的脚本可用于稳定触发边界。
- [x] 相关测试通过后完成完整测试、build、lint；将自动检查和手动体验的实际结果写入报告。
- [x] 在规格/计划写明已实现内容、剩余限制；直接 main 提交本次代码和文档，不带入无关变更。

## 最终回报要求

报告：支持的桌型、实际角色/顺序、近似映射方法、四人回归、筹码守恒、九人运行表现、回顾/流水兼容，以及已运行检查的结果。把“已验证”和“暂未验证”分清；不把启发式报告称为 GTO 校准。
