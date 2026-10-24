---
name: dz-pk-play
description: >-
  读取 dz-pk 德州扑克的对局流水，并替人类座位下注、全下、发下一手或重新买入。
  在用户要求打牌、看当前牌局、跟注、加注、弃牌、全下、发牌、重买，或提到 dz-pk、game_log 时使用。
---

# 替 dz-pk 打牌

游戏页面必须开着，人已经坐在桌前。流水和动作都打向这个页面的源。本机 `npm run dev` 用地址栏里的源，一般是 `http://localhost:5173`。部署后是 `http://<主机>:1111`。下面用 `{游戏}` 表示这个源。

一次只发一个动作。等这次 POST 返回后，再读新流水，然后再决定下一步。

## 读牌局

```bash
curl -sS "{游戏}/v1/records?source=dz-pk&kind=game_log&after_id=0&limit=100"
```

`limit` 最大 100。响应里有 `records` 和 `next_after_id`。下一页把 `after_id` 设成 `next_after_id`，直到 `records` 不足 100 条。

每条记录用这些字段：

- `body`：一行中文流水
- `payload.session`、`payload.hand`、`payload.seq`、`payload.stage`

同一手是相同的 `session` 和 `hand`，按 `seq` 从小到大排。`seq` 缺号就再读一次，先别动作。动作写入大约有 300 毫秒延迟，刚操作完如果还没看到新行，等一下再读。

座位按入座顺序循环。默认混合是 `你 (Player)`、`德州老手`、`激进小伙`、`松跟玩家`。偏紧组合里第三名才是 `保守大叔`。以流水里的名字为准。

一手开始的流水里有庄家和你的底牌。庄家的下一家是小盲，再下一家是大盲。翻前由大盲的下一家先行动。翻牌、转牌、河牌由小盲先行动。已经弃牌或全下的人跳过。

这一手结束的标志是流水里出现 `本手结束筹码`。

## 动作

```bash
curl -sS -H "Content-Type: application/json" \
  -d '{"action":"check"}' \
  "{游戏}/api/act"
```

请求体只使用这七种：

```json
{ "action": "fold" }
{ "action": "check" }
{ "action": "call" }
{ "action": "raise", "to": 40 }
{ "action": "allin" }
{ "action": "deal" }
{ "action": "rebuy" }
```

`raise` 的 `to` 是这一街加到的总额，和流水里的「加注到」相同，不是再投入的差额。`to` 必须是大于等于 0 的整数。金额偏小，牌桌会抬到最小加注。超过剩余筹码，按全下处理。

不要发 `GET /api/act`。那是页面自己取动作用的。

成功是 `200`，身体为 `{"ok":true,"action":"call"}`。失败时这次请求没有改变牌桌：

| HTTP | error | 含义 |
|---|---|---|
| 400 | `bad_action` | 动作名不对 |
| 400 | `bad_amount` | 加注缺少合法的 `to` |
| 409 | `pending` | 上一个动作还没返回 |
| 409 | `not_your_turn` | 还没轮到你 |
| 409 | `illegal_action` | 这个按钮现在不能按 |
| 409 | `hand_in_progress` | 这一手还没结束 |
| 409 | `need_rebuy` | 筹码是 0，要先重买 |
| 409 | `insufficient_funds` | 桌子外的资金不够买入 |
| 409 或 504 | `no_table` | 页面没开，或人还没坐下。504 表示 8 秒内页面没有取走动作 |

被拒绝后不要立刻换个动作连发。先把这一手的流水重新读齐。

## 什么时候发哪条

轮到 `你 (Player)`，并且 `payload.stage` 是 `preflop`、`flop`、`turn` 或 `river`：

- 这一街没人下注：`check`，或者 `raise`、`allin`
- 有人下注：`fold`、`call`。这一手还允许加注时才发 `raise` 或 `allin`
- 筹码不够跟注：发 `call`。页面会把剩余筹码全部跟进去

`payload.stage` 是 `idle` 或 `showdown`，或者已经看到 `本手结束筹码`：

- 结束时你的筹码大于 0：`deal`
- 结束时你的筹码等于 0：`rebuy`。金额是这张桌子的买入，成功后会自动发下一手

`deal` 或 `rebuy` 成功后，等流水里出现下一手的 `--- 第` 再继续。下注成功后，等流水里出现你这次动作的那一行再继续。
