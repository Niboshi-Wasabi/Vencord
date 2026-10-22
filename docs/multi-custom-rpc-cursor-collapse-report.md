# 調査報告: Cursor Discord RPC 起動で MultiCustomRPC が折りたたまれる件

日付: 2026-10-23  
対象: MultiCustomRPC + Cursor 上の VSCord（`leonardssh.vscord`）  
結論の一行: **原因は MultiCustomRPC のバグではなく、Discord クライアントが Playing を最大1件に畳む仕様。Cursor/VSCord も Playing で来るため、後から（または `created_at` が新しい方）が残り、MultiCustomRPC 側が消えて見える。**

---

## 1. 観測された現象

- MultiCustomRPC でプロファイルを出している状態で、Cursor の Discord Rich Presence（設定上は VSCord）を有効にすると、**2つ目相当の Activity が折りたたまれて見えなくなる**。
- 本機の Cursor 設定:
  - 拡張: `leonardssh.vscord-5.3.10-universal`
  - `vscord.enable`: true
  - `vscord.app.name`: `"Cursor"`

「2つ目」は MultiCustomRPC の2プロファイル目だけでなく、**「Cursor の Playing」と「MultiCustomRPC の Playing」の競合**としても同じ畳み込みが起きる。

---

## 2. Cursor / VSCord 側が送っているもの

VSCord は Discord のローカル IPC に `SET_ACTIVITY` を送る。バンドル内の実装は概ね次の形:

```text
setActivity(e, t) {
  let A = {
    name: e.name,
    type: e.type ?? ActivityType.Playing,  // 既定は Playing (0)
    created_at: Date.now(),
    instance: !!e.instance
  };
  ...
  client.request("SET_ACTIVITY", { pid, activity: A })
}
```

要点:

| 項目 | 値 |
| --- | --- |
| 経路 | Discord IPC `SET_ACTIVITY`（クライアントが `LOCAL_ACTIVITY_UPDATE` 相当へ落とす） |
| 既定 type | **Playing** |
| `created_at` | **毎回 `Date.now()`**（編集のたびに新しくなる） |
| `pid` | エディタのプロセス ID |
| 表示名 | 設定の `vscord.app.name`（本機は `"Cursor"`） |

公式 RPC ドキュメントでも `SET_ACTIVITY` の type は Playing / Listening / Watching / Competing に限定される。エディタ系 RPC は慣習的に Playing を使う。

参照:

- 本機: `~/.cursor/extensions/leonardssh.vscord-5.3.10-universal/dist/extension.js`
- upstream: [leonardssh/vscord `src/activity.ts`](https://github.com/leonardssh/vscord/blob/main/src/activity.ts)
- [Discord RPC — SET_ACTIVITY](https://docs.discord.com/developers/topics/rpc)

---

## 3. Discord クライアント側の畳み込み（一次原因）

datamining されたクライアント実装（`SelfPresenceStore` / `PresenceStore`）では、ローカル Activity を presence に載せる前に次を行う。

### 3.1 Playing は最大1件

```javascript
function P(activities) {
  const nonPlaying = [];
  const playing = [];
  for (const a of activities)
    a.type === PLAYING ? playing.push(a) : nonPlaying.push(a);
  if (playing.length <= 1) return activities;
  return [...nonPlaying, [...playing].sort(priority)[0]].sort(priority);
}
```

- Playing が2件以上 → **優先度ソートで1件だけ残す**
- Listening / Watching / Competing / Streaming は、この「Playing 専用畳み込み」の対象外（別経路の uniq はありうる）

### 3.2 優先度ソート（概略）

種別の重み（大きいほど優先）:

| type | 重み（概略） |
| --- | --- |
| Custom Status | 4 |
| Competing | 3 |
| Streaming | 2 |
| **Playing** | **1** |
| その他（Listening / Watching など） | 0 |

同順位なら:

1. パーティ等のフラグ
2. **`created_at` が大きい方**

VSCord は更新のたびに `created_at: Date.now()` を付ける。MultiCustomRPC 側が古い `created_at`（または未設定に近い状態）だと、**Cursor の Playing が勝ちやすい**。

### 3.3 追加の uniq

自己 presence 組み立て時に、概ね次のキーで重複除去される:

```text
`${type}:${application_id}:${name}`
```

同じ Playing + 同じ Application ID + 同じ表示名なら、こちらでも1件にまとまる。Cursor と MultiCustomRPC は通常 ID/名前が違うので、主因は **3.1 の Playing 畳み込み**。

### 3.4 LocalActivityStore 自体は複数保持できる

`LOCAL_ACTIVITY_UPDATE` は `socketId` ごとに Activity を保持する。  
**「store には残るが、SelfPresenceStore が Playing を1件に減らしてから外へ出す」** という二段構え。  
そのため「プラグインは送っているのに Discord 上では消える」が起きる。

根拠チャンク（例）:

- `Wumpus-Central/discrapper-canary` の `chunks/461213.js`（SelfPresenceStore の filter + Playing 畳み込み）
- 同 `chunks/480595.js`（LocalActivityStore）
- 同 `chunks/290863.js`（PresenceStore 側の同様の Playing 畳み込み `O()`）

---

## 4. 今回の因果チェーン

```text
MultiCustomRPC  (socket MultiCustomRPC:<id>, type=Playing, LOCAL_ACTIVITY_UPDATE)
        +
VSCord/Cursor   (IPC SET_ACTIVITY, type=Playing, created_at=now を頻繁更新)
        ↓
LocalActivityStore  … 両方の socket を保持しうる
        ↓
SelfPresenceStore   … Playing を1件に畳む（新しい created_at の Cursor が勝ちやすい）
        ↓
外向け presence / UI … MultiCustomRPC の Playing が見えなくなる
```

MultiCustomRPC の reconcile が「消した」わけではない。Discord が **表示用リストから落とす**。

---

## 5. 類似例（リファクタ方針用）

同じ「複数ソース × Discord の1 Playing 制約」パターン。

| 事例 | 何が起きるか | 既存の対処・示唆 |
| --- | --- | --- |
| **CustomRPC + ゲーム検知** | 両方 Playing。クライアントが1件に畳む。フォーカス/新しさで勝敗 | Discord 公式も「複数 RPC ゲームはフォーカス側」と説明してきた経緯（[discord-rpc#217](https://github.com/discordapp/discord-rpc/issues/217)）。完全同時表示はクライアント非対応が長い |
| **CustomRPC + VSCord/Cursor** | 本報告と同一。IPC Playing vs Flux Playing | どちらかを止めるか、Multi 側を非 Playing にする |
| **CustomRPC + MusicRichPresence** | LastFM は Listening にできる。Playing 畳み込みを避けやすい | `useListeningStatus`、`hideWithActivity` / `hideWithSpotify` で**自ら譲る**設計 |
| **Spotify + Playing ゲーム** | Spotify は Listening。Playing 1件制限の外。併存しやすい | 種別を分ける実例 |
| **MultiCustomRPC 複数プロファイルがすべて Playing** | プロファイル同士でも1件しか残らない | 設定UI警告（実装済み方向）。種別分散が本命 |
| **同一 app ID + 同一 name** | uniqBy でさらに潰れる | プロファイルごとに Application ID / 表示名を分ける |
| **IgnoreActivities** | LocalActivityStore / ゲーム一覧をフィルター | 「送らない・見せない」をプラグイン側で制御する先例 |
| **arRPC / 外部 IPC** | 別 socket で複数アプリが来る。結局 SelfPresence で Playing 畳み込み | socket 分割だけでは Playing 同時表示は解けない |

MusicRichPresence の方針は特に参考になる:

- 既定で Spotify と被ったら自分を消す（`hideWithSpotify`）
- 任意で「他 Activity があったら自分を消す」（`hideWithActivity`）
- Listening に寄せて Playing スロットを空ける

→ MultiCustomRPC も「全部押し込む」より **競合時ポリシー（譲る / 種別を変える / 警告する）** が現実的。

---

## 6. MultiCustomRPC にとっての意味

### できること

- socket を分けて LocalActivityStore に複数載せる（実装済み）
- Playing 以外の type を混ぜて、Playing 畳み込みを避ける
- `created_at` を付けて、同種別どうしの勝敗を少し制御する（既に対応方向）
- UI で「Playing が複数（外部含む）だと1件しか出ない」と明示する
- 外部 Playing（Cursor / ゲーム）検知時に警告、または一時的に自プロファイルを Watching 等へ退避するオプション

### できないこと（Discord クライアント制約）

- **複数の Playing を同時にユーザーへ保証して見せる**
- IPC 側（VSCord）と Flux 側（MultiCustomRPC）の Playing を両方 presence に残すこと

### 保証しない文言の叩き台

- Discord は Playing を最大1件に畳む。Cursor（VSCord）やゲーム検知など他の Playing があると、MultiCustomRPC の Playing は表示から外れることがある。
- 同時表示したい場合は Activity Type を分けるか、他方の RPC を止める。

---

## 7. リファクタリング方針の候補

優先度は上から「制約に正直」「運用しやすい」順。

### A. ドキュメント + 警告のみ（最小）

- README / 設定 About に Cursor・ゲーム・CustomRPC との Playing 競合を明記
- Playing 有効プロファイルが1件超、または外部 Playing 検知時に警告カード

### B. 競合ポリシー（MusicRichPresence 型）

設定例:

- `yieldToExternalPlaying`（既定 true）: Cursor / ゲーム等の Playing がある間、自前 Playing を送らない、または非 Playing に退避
- `preferOwnPlaying`: 逆に自前を優先（外部はユーザーが止める前提）

検知: `LocalActivityStore.getApplicationActivities()` / `PresenceStore` / `RunningGameStore` を購読。

### C. 種別戦略を製品の中心にする

- プロファイル作成時の既定を Playing 以外にしない（Playing は「メイン1枠」とラベル）
- 「同時表示セット」プリセット: 1 Playing + 1 Watching + 1 Listening
- 2つ目以降の Playing を UI で禁止または強く警告

### D. upstream 向けに期待値を下げる

- 「複数 Rich Presence 管理」は正しい
- 「複数 Playing の同時公開保証」は Discord 非対応として Gate / PR から外す
- PoC 合格条件を「別 type なら別ユーザーに複数見える」に書き換える

### E. やらない方がよいこと

- Discord の SelfPresenceStore を大規模 patch して Playing 制限を外す（壊れやすく、他ユーザー側のサーバー畳み込みは解けない）
- socket 数を増やすだけで同時 Playing を解決しようとする（store には残っても presence で消える）

---

## 8. 再現確認の手順（検証メモ）

1. MultiCustomRPC だけ Playing 1件 → 表示されること
2. Cursor/VSCord を有効化 → Multi の Playing が消える（または Cursor だけ残る）こと
3. Multi を Watching に変更し Cursor Playing のまま → **両方見える**こと（仮説の確認）
4. Discord DevTools で `LocalActivityStore` 相当に両 socket が残るか、`SelfPresenceStore.getActivities()` では Playing が1件かを見る

未実施の場合は「仮説検証待ち」と残す。本報告の因果はクライアント実装と VSCord 実装から十分に説明できる。

---

## 9. まとめ

| 問い | 答え |
| --- | --- |
| MultiCustomRPC が2つ目を消している？ | いいえ。Discord が Playing を1件に畳んでいる |
| Cursor は何か特別？ | 特別ではない。VSCord 経由の **Playing + 頻繁な `created_at` 更新** |
| 類似例は？ | ゲーム+CustomRPC、VSCord+CustomRPC、MusicRichPresence の譲り設計、Spotify（Listening）との併存 |
| リファクタの芯は？ | 「複数 socket」ではなく **「Playing 1枠の取り合い」を設計の前提にする** |

関連ドキュメント:

- [multi-custom-rpc-design.md](./multi-custom-rpc-design.md)（PoC Gate・同時表示）
- [multi-custom-rpc-open-questions.md](./multi-custom-rpc-open-questions.md)（方針未決論点）
