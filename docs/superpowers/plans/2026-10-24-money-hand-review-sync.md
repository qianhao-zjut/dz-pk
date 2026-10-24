# 整数筹码与完整手牌流水实施计划

日期：2026-10-24（Asia/Shanghai）

状态：已完成（A→D）。基线文档 `abc343c`；实现落点 `1e1239d`…`45cedaf`。

先读 `docs/superpowers/specs/2026-10-24-money-hand-review-sync-design.md`。基线 `d3de8d2`；本轮只修P1金额与完整 hand_review 同步，不重跑旧训练计划，也不顺手修其他P2。

## 执行约束

- 检查规则和Git状态，保留用户新改动；按项目工作流直接main开发/提交，不建分支、worktree或PR。
- 测试和试玩隔离fetch、浏览器存储、资金与记录库；不能写真实 `/api/bankroll` 或 `/v1/records`，不部署、不删文件、不改真实资金。
- 读记录库接口契约即可，本轮不改 sqlite-lib 的模型或数据库。其body上限64KiB、payload上限16KiB。

## A. P1 金额入口

- [x] 用已有四人反例暴露小数进入动作链；记录旧19.5池派20的问题。
- [x] 金额输入保留字符串，确认时检查非空、安全整数与合法范围；非法值显示错误并保留面板。
- [x] store在任何记录/状态改变前拒绝非安全整数及负值；保留合法整数现有尺寸归一。
- [x] 外部动作统一安全整数校验，错误返回bad_amount，不假报成功。
- [x] 覆盖6.5、空白、NaN、±Infinity、负数和不安全整数；深复制状态证明日志、行动、轮次和资金均不变。
- [x] 合法6/7、含死钱三人平分、最小加注/上限/短全下/权限回归通过，结算及下一手守恒。

主要落点：`src/game/chipAmount.ts`、GameTable、gameStore、applyAction及相关测试。未重写整数派彩，未修正历史资金。

## B. 完整流水记录构造

- [x] 定义 `hand_review` v1记录构造/解析纯函数，输入为已完成不可变CompletedHand。
- [x] body包含摘要和完整紧凑JSON段；payload只放版本、session/hand/table/hand_id及格式索引。
- [x] 用 `dz-pk:hand_review:{sessionId}:{handNumber}` 固定client_key；created_at固定为endedAt。
- [x] 保留所有底牌、行动金额/牌面快照、真实NPC上下文/assumptions、派彩/退款/初末筹码，不包含deck和未发牌。
- [x] 校验必要字段；旧完整档案保留原值，无法完整还原的旧文本不补造。
- [x] 验证JSON还原深度相等，测典型/高行动数UTF-8字节大小；超限保留失败状态，不截断全文。

出口：`src/game/handReviewRecord.ts`；一条记录足以完整还原本手事实。

## C. 结算事件与可靠outbox

- [x] 新增独立handReviewSync/outbox，初始化一次，连接已完成历史新增事件；不能仅观察showdown阶段。
- [x] 同步从已支付归档取得数据，最后NPC依据不漏；复制请求后独立于20手展示历史。
- [x] 首次/刷新初始化等待历史hydration后补传本地已有完整20手，注册/补传与客户端/服务端均幂等；历史补传不弹回顾。
- [x] 先持久化待发再请求，离桌/下一手保留；默认不打开回顾仍同步。
- [x] 网络/超时/5xx可重试，确定性4xx保持失败且不堵后续；失败状态有简洁提示和手动重试。
- [x] 确认201/200返回的source/kind、payload.hand_id及body还原的完整档案一致后标成功，保存record id；顶层无hand_id且不返回client_key；失去响应后重试不重复落库。
- [x] outbox按client_key原子写入/删除（优先IndexedDB，localStorage整数组需等价跨标签锁）；ACK按当前队列key移除，每页面单flush，A期间B入队及多标签写入不能被旧数组覆盖。
- [x] 存储不可用保留内存并显示状态；不在控制台打印body、payload、底牌或地址。
- [x] 使用独立队列key，旧game_log协议/排队不被新功能覆盖；如共享发送工具，只抽取必要部分并补兼容验证。

主要落点：`src/store/handReviewSync.ts`、`handReviewOutbox.ts`、`main.tsx`、Lobby 最近手牌状态。ACK 顺序为 `putSynced` 再 `removeByKey`（`45cedaf`）。

## D. 验证与交付

- [x] 金额入口、公共牌平分、守恒和旧合法动作回归通过。
- [x] 验证全弃/翻牌弃牌/摊牌/全下边池全部有完整hand_review，进行中退出或本人先弃牌不提前发送。
- [x] 覆盖历史hydration延迟、重复归档、重复初始化、会话切换、离桌/刷新、丢响应、并发入队、多标签及离线超过20手。
- [x] 覆盖400/413不阻塞、存储不可写、请求超时；开关与是否查看不影响同步。
- [x] 用假HTTP回包或隔离临时记录库验证201创建、200幂等、身份/内容不符拒绝成功，body可解析且与原档案相等；确认没有真实资金/流水请求。
- [x] 跑相关测试后全量测试、构建、lint；记录新增与旧问题，必要时用隔离浏览器核对输入错误和同步状态。
- [x] 更新规格实现差异及下方结果，按项目工作流本地提交。本轮不自动推送或部署。

验证命令：

```sh
npx --no-install vitest run src/game/chipAmount.test.ts src/game/handReviewRecord.test.ts src/store/handReviewSync.test.ts src/store/gameStore.test.ts src/act/applyAction.test.ts
npx --no-install vitest run
npm run build
npm run lint
```

现有experienceReport会生成文档且统计有已知P2；这轮不引用25%/23%证明训练效果，不修改其统计作为金额/同步交付的一部分。

## 结果记录

| 项目 | 当前状态 |
| --- | --- |
| 实现基线 | 文档 `abc343c`；代码自 `1e1239d` 起 |
| 最近评审验证 | 全量 **170** 测试通过；`npm run build` 通过；lint 仍为既有 3 错误（GameTable effect setState、Lobby export、pokersolver `any`），无新增 |
| P1金额 | 完成（`1e1239d`） |
| hand_review构造/还原 | 完成（`9dab6c1`） |
| 完成事件/历史补传 | 完成（`624f797`） |
| 队列/幂等/失败恢复 | 完成；ACK 竞态修复（`45cedaf`） |
| 隔离落库验证 | 完成（假 fetch / 隔离存储；未写真实 `/v1/records` 或资金） |
| 游戏实现提交 | 完成于 main；未推送、未部署 |

### 实现差异（相对规格）

- UI 金额校验抽到 `confirmTypedRaise`；未挂载 GameTable DOM 测试（逻辑单测覆盖）。
- 同步状态/重试入口放在 Lobby「最近手牌」，牌桌内不显示。
- 无 Web Locks 时 localStorage 整数组路径回退内存并提示无法持久化（优先仍走 IndexedDB）。
- 本地构造失败（超限/不完整）标 `failed` 且无 body，Lobby「重试」对其为 no-op；完整档案仍留本地历史。

### 已知未修（本轮故意留 P2）

- 有效筹码/回顾边池报价/体验报告统计/听牌分类等评审 P2。
- synced 元数据未做 TTL 裁剪；GameTable 不检查 `playerRaise` 返回值关面板（金额已安全）。
