# MultiCustomRPC — 残論点ブリーフ（方針検討用）

Codex 等に方針をまとめさせるための入力資料。  
関連: [multi-custom-rpc-design.md](./multi-custom-rpc-design.md)、公開本体 [Niboshi-Wasabi/multiCustomRPC](https://github.com/Niboshi-Wasabi/multiCustomRPC)。

Issue / PR の作成手順は求めない。方針と根拠だけ出す。

---

## 現状（事実）

- 実装済み: 独立 userplugin（複数プロファイル、socket `MultiCustomRPC:<id>`、Import from CustomRPC、編集モーダルの Activity プレビュー、自分プロフィールのボタン表示 patch）。
- 配布: 公開リポジトリはプラグイン本体のみ。Vencord はソースビルド + inject 前提。
- 作業ブランチ: Vencord fork `feat/multi-custom-rpc`。
- 設計書: `docs/multi-custom-rpc-design.md`（初期判断は「独立 userplugin 推奨。ただし他ユーザー同時表示の PoC Gate 通過まで本実装に進まない」）。先頭に実装ステータス注記を追加済み。
- ずれ: 設計上の Phase 0（PoC Gate）を正式記録しないまま本実装まで進んでいる。プレビューと自己ボタン patch も「初期必須でない」だったが実装済み。Import も設計初期は対象外だったが実装済み。
- Discord 制約（確定寄り）: Playing はクライアントが最大1件。Cursor/VSCord・ゲームと競合。PreMiD（Watching/Listening）とは併存しやすい。→ [multi-custom-rpc-cursor-collapse-report.md](./multi-custom-rpc-cursor-collapse-report.md)。

---

## 目的

次の方針を決めること。

1. このプラグインをどう位置づけるか（個人用 / 公開 userplugin / upstream 提案）
2. CustomRPC との関係（併存・置換・吸収）
3. PoC Gate 未通過のまま何を主張・保証するか
4. 今すぐやる作業の優先順位

---

## 論点 A — PoC Gate（最重要）

**未確認のまま「複数 RPC が他ユーザーに同時に見える」を製品として主張できない。**

確認すべきこと（設計書 §8）:

- 別 socket の 2 件が、別アカウントのプロフィールに同時表示されるか
- 片方だけ解除できるか（もう一方が残るか）
- 同一 Application ID / 別 ID、同一 type / 別 type で集約・上書きが起きるか
- プロフィール全画面・ポップアウト・メンバー一覧での件数・順序
- 再接続 / reload / Discord 再起動後の残留・消失・再登録
- CustomRPC / MusicRichPresence / Spotify / ゲームとの共存

**Gate 合格条件（設計）:** 実在 app ID で、別ユーザーに 2 件同時表示 + 個別/全解除成功。

**失敗時の選択肢:**

- 「同時表示は保証しない。管理 UI としての複数プロファイル」にスコープを落とす（現状 README に近い）
- 「プロファイルごとに別 app ID 必須」を要件化する
- 単一アクティブ切り替え（同時公開しない）に後退する
- CustomRPC 拡張（1 件のまま）に寄せ、複数は諦める

方針で決めてほしいこと: Gate を今やるか / やらなくても公開継続するか / 合格するまで upstream 禁止とするか。

---

## 論点 B — CustomRPC との関係

現状: 別プラグイン。同時 ON だと二重表示しうる。README は「Multi だけ使うなら CustomRPC をオフ」と案内。強制排他はしていない。Import は読み取りコピーのみ。

| 案 | 意味 | 主な得失 |
| --- | --- | --- |
| B1 併存（現状） | 利用者が手動でどちらか OFF | 差分最小。二重表示リスクは文書頼み |
| B2 ソフト排他 | 相手が ON なら警告 / 自側を止める | UX は良い。PluginManager 干渉が増える |
| B3 置換提案 | upstream で CustomRPC を複数化 | 説明しやすいが衝突・移行設計が重い |
| B4 吸収しない | Multi は永久に userplugin | 配布・発見性が弱い。追従は手動 |

方針で決めてほしいこと: 短期（今の公開）と中期（upstream を狙うか）で B のどれか。

---

## 論点 C — upstream PR するか

前提:

- userplugin のままでは Vencord 公式取り込み前提ではない
- CustomRPC 改修案の方が「既存機能の拡張」として説明しやすい一方、fork 差分と移行が重い
- Gate 未通過だとレビューで「本当に複数見えるのか」が必ず問われる
- クライアント改変・Discord ToS は利用者が負う（README 免責済み）。メンテナ方針とも衝突しうる

選択肢:

- C1: upstream しない。standalone + 自前ビルド案内を本線にする
- C2: Gate 記録後に CustomRPC 拡張として PR
- C3: Gate 記録後に新規公式プラグインとして PR（CustomRPC は残す）
- C4: 当面 C1、需要と PoC が揃ったら C2/C3 再検討

方針で決めてほしいこと: いまの本線は C のどれか。PR 本文に何を「保証しない」と書くか。

---

## 論点 D — 製品としてまだ決めていない制約

1. **Application ID:** 同一 ID で並ぶのか、別 ID 必須なのか（PoC 依存）
2. **表示上限・順序・優先度:** Discord 任せと明記済み。UI の並び替えを足すか（設計は後続任意、Discord 順位は保証しない）
3. **schemaVersion:** 現在 `1`。未知版は公開停止・データ保持。将来の破壊的変更のルールは未文書化
4. **移行:** 自動移行なし / 手動 Import あり。将来 CustomRPC を deprecate する場合の移行経路は未定
5. **検証範囲:** 作者環境の Discord Stable + 自前 inject のみ。他 OS / Canary / PTB / 公式インストーラ経路は未確認
6. **ボタン検証:** CustomRPC に寄せてテキスト/URL を独立扱い済み。設計初期の「ペア必須」との差を upstream 提出時にどう説明するか
7. **自己ボタン patch / プレビュー:** 実装済み。upstream に含めるか（CustomRPC と同型なら含めやすい）

---

## 論点 E — 配布・運用

- 公式インストーラだけの Vencord には入らない（ビルド必須）
- インストール体験を楽にするか（スクリプト、テンプレ fork、リリース zip）は未着手
- CustomRPC 追従: upstream が変わったら `activity.ts` / `settings.ts` を手動比較（自動化なし）
- 設計書が実装より古い（PoC 未実施表記、Import/プレビュー/patch の記述ずれ）。方針確定後に設計書か README のどちらを正とするか

---

## 受入チェック（設計 §12）でまだ「未」のもの

特に方針に効くもの:

- [ ] PoC Gate（別ユーザー同時表示 + 個別解除）の環境付き記録
- [ ] 同時公開の必要条件（同一 app ID 可否など）の UI/README 明記
- [ ] 再接続・reload・再起動後の残留/重複なしを**別ユーザー側**で確認
- [ ] 共存時制約を説明できる状態（現状は文書レベル、強制制御なし）

実装済みに近いもの: 複数 CRUD、永続化、フィールド一式、Save/Cancel、行単位検証、独立 socket cleanup 設計、など。

---

## Codex への依頼

上記を前提に、次を日本語で簡潔にまとめてほしい。

1. **推奨方針**（短期 / 中期）を 1 案に絞る
2. その案で **今やる / 後回し / やらない** を表にする
3. PoC Gate を「必須」「任意だが PR 前は必須」「スコープ縮小で回避」のどれにするか、理由付き
4. CustomRPC との関係（B1〜B4）と upstream（C1〜C4）の組み合わせを明示
5. 方針が決まったあとに README / 設計書へ書くべき「保証しないこと」の箇条書き（誇張しない文言）

制約:

- Issue / PR は作らない
- 未観測を事実扱いにしない
- 同時表示未確認のまま「複数 RPC 対応完了」と言わない
