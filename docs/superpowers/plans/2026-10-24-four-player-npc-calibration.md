# 四人桌 NPC 校准实施计划

日期：2026-10-24（Asia/Shanghai）

状态：待实施。当前只新增规格/计划，游戏代码未修改。编写基线326b586；先读 `docs/superpowers/specs/2026-10-24-four-player-npc-calibration-design.md`。

## 执行约束

- 保留用户新改动，以当前代码实施；直接main开发和本地提交，不建分支/worktree/PR，不回退基线。
- 本轮四人桌：防守校准、松跟型、普通3bet和必要的有效深度修复。六人桌、动态适应及其他UI/P2后续。
- 测试用替身/隔离存储和固定发牌；不调用真实资金/流水、不部署、不推送、不删除文件。
- 保留已完成金额守卫、结算、历史及hand_review协议。旧历史和冻结旧策略不得重解释。

## A. 基线、完整加注上下文和有效深度

- [ ] 新增独立校准测量工具，先以当前决策重跑基线，记录种子、配置、分母、全部频率。
- [ ] 区分完整开池/3bet/4bet与不足额全下；公共摘要只用公开动作，保留合法加注开关。
- [ ] 有效深度按真正定价的完整加注者；无人开池时使用本人能参与的最大有效深度。
- [ ] 200bb BTN/BB、0.5bb全下SB仍深筹；真正开池者40bb则短筹；不足额全下不覆盖参考对手。
- [ ] 新diagnosis及实际NPC上下文记录参考对手、有效bb和动作语境，旧记录缺字段可读。

落点：observation/types、preflop helper、runtime/npcContext；不移除all-in分池/权益资格。

## B. 松跟策略和配置身份

- [ ] 新增loose_passive及完整PROFILES/DEFEND/profileFor注册，座位仍human/ai_0/ai_1/ai_2。
- [ ] 默认mixed为稳健/松凶/松跟；loose/tight键可用，保守ai_2语义保留。
- [ ] 松跟有独立开池/平跟/防守/3bet继续、短深筹表与翻后参数，合理平跟为主，强牌仍加注。
- [ ] 大厅显示所选组合一行说明，名称/style/profile与实际配置一致。
- [ ] baseline策略ID独立限定旧三种；旧测试显式选择旧ID，新策略单独覆盖，不能补造冻结基线。
- [ ] 提升范围版本，TableConfig/SessionSnapshot保存可选npcConfigVersion；新选择写当前值，sessionFromTable复制原值，存量配置/手牌不补成新版本。

落点：types、profiles、defendLines、sessionConfig、Lobby；不做宽UI改造。

## C. 常规开池防守

- [ ] 校准BB vs UTG/BTN/SB，按规格100bb目标枚举1326组合。
- [ ] 补齐SB vs UTG/BTN、BTN vs UTG及各位置开池/平跟矩阵。
- [ ] 松跟正常价call占继续至少70%，松凶3bet明显高于松跟，位置/价格/风格差异可解释。
- [ ] 72o普通价格弃牌、免费check、强牌价值加注、大额/全下保护代表牌通过。
- [ ] 分别测40/100/200bb，不因无关短码触发短筹，也不把正常价宽范围套到高风险。

落点：profiles/defendLines/preflop、strategy/rangeReport测试。

## D. 普通3bet及继续范围

- [ ] 首次开池仍保留>5bb large、>=20bb high-risk；真实call风险15%/50%继续优先保护。
- [ ] 完整3bet按前一正常开池约4倍、实际投入风险、目标<20bb分档，覆盖2.5→10、3→12、3.5→14。
- [ ] 4bet+及信息不足保持保守；短不足额全下不被识别为完整3bet。
- [ ] 本人已开池/冷跟/未入池分开选继续范围，call与4bet分开统计。
- [ ] 100bb稳健/松凶BTN已开池组合正常3bet继续30–50%；其他风格及40/200bb独立报告/案例。
- [ ] 6bb巨大开池、40bb高投入3bet、20bb高风险、便宜小额例外、无加注权限回归通过。

落点：preflopPrice/preflop及公共摘要；新增原因码同步reasonText。

## E. 量化报告、兼容与交付

- [ ] 两个种子、每位置至少4998次完整发牌和六种风格座位轮换，测2.5/3bb正常开池后联合全弃。
- [ ] 分开报告旧混合身份和新默认身份；新默认参考上限UTG55%、BTN45%、SB60%。
- [ ] 两个种子各2000手固定人类纯翻前对照，每手重置筹码，正确统计本人实际参与且仍在局的翻牌率。
- [ ] 100bb本人见翻牌高于同口径基线；15%仅非阻断参考，未达列出位置/动作/价格分解及理由；补40/200bb诊断，不用旧25%/23%报告证明改善。
- [ ] 报告列版本、种子、配置、分母、call/raise拆分；新报告独立路径且显式写出，旧报告不被默认测试覆盖。
- [ ] 验证同一ai_2座位使用loose_passive，三组配置及新旧历史名称/profile正确。
- [ ] 新可选字段从诊断经contextFor显式传递，经CompletedHand/hand_review完整构造解析保留；存在时校验，缺失时接受旧档案，旧outbox/key不变。
- [ ] 金额/合法动作/筹码守恒、历史与同步回归通过；相关测试后跑全量测试、build、lint。
- [ ] 更新规格微调理由、下方结果和报告，本地提交，交付实际频率和风险边界。

可复用的验证入口（新增校准测试按实现加入）：

```sh
npx --no-install vitest run src/ai/strategy.test.ts src/ai/observation.test.ts src/ai/rangeReport.test.ts src/ai/runtime.test.ts src/game/training.test.ts
npx --no-install vitest run src/game/chipAmount.test.ts src/game/handReviewRecord.test.ts src/store/handReviewSync.test.ts src/store/gameStore.test.ts src/act/applyAction.test.ts
npx --no-install vitest run
npm run build
npm run lint
```

现有rangeReport/experienceReport含旧场景或旧口径，重用时按规格补足，冻结历史基线与当前校准基线要明确分开。

## 结果记录

| 项目 | 当前状态 |
| --- | --- |
| 实现基线 | 326b586；编写文档前工作区干净 |
| 已完成上轮验证 | 实施计划记录170测试及构建通过，lint有3个既有错误；本轮尚未重新验证 |
| 基线与正确统计 | 待实施 |
| 完整加注/有效深度 | 待实施 |
| 新profile及默认组合 | 待实施 |
| 防守校准 | 待实施 |
| 普通3bet继续 | 待实施 |
| 隔离报告/回归/兼容 | 待实施 |
| 游戏实现提交 | 待实施，当前仅文档 |

## 开发聊天提示词

```text
请在 /Users/admin/qh/aiprogram/dz-pk 实施四人桌NPC校准。
先读 docs/superpowers/specs/2026-10-24-four-player-npc-calibration-design.md 和
docs/superpowers/plans/2026-10-24-four-player-npc-calibration.md，检查规则和Git状态。
保留现有改动及已完成的金额守卫/结算/完整hand_review，不回退基线，不重跑旧大计划。

按A→E实施：校准常规开池防守；新增独立loose_passive，默认稳健/松凶/松跟，
旧保守留可选且seatId与profileId分开；普通完整3bet独立定价与继续范围，
保留巨大开池/高投入/全下保护；修复微短全下对手压缩深筹参考的问题。
松跟必须有真实独立行为，合法平跟为主，强牌仍能价值加注。

用1326组合、完整发牌联合全弃、固定人类实际见翻牌统计验收，分母和种子按规格。
保护旧冻结策略和历史快照；新实际NPC依据完整进入回顾和流水。
六人桌及跨手动态适应后续，不引入强制跟注/固定牌局或读取隐藏牌。

自主完成合理调参、隔离验证、相关及全量测试、构建和lint，
更新计划/报告并按项目工作流本地提交。不部署、不推送、不写真实资金/流水、不删文件。
```
