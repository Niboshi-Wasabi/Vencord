# MultiCustomRPC 設計・調査報告

調査対象: ローカル Vencord `32c90633`（`package.json`: 1.15.11）、ブランチ `feat/multi-custom-rpc`。
本書は設計成果物であり、プラグイン実装・PoCの実行・Discordへの登録は行っていない。

**判断: 独立 userplugin を推奨する。ただし、異なる socketId の2件が他ユーザーのプロフィールにも同時表示され、片方だけ解除できることをPoCで確認するまで、本実装へ進まない。**

## 1. Existing Implementation Summary

### 構成と根拠

以下は本書の位置からの相対リンク。関数名・型名も併記し、行番号が変わっても追跡できるようにした。

| ファイル | 確認した責務・設計の根拠 |
| --- | --- |
| [customRPC/index.tsx](../src/plugins/customRPC/index.tsx) | `settings`、`TimestampMode`、`createActivity()`、`getApplicationAsset()`、`setRpc()`、起動・停止、Toolbox、Activity Sharingの警告、Activityプレビュー |
| [customRPC/RpcSettings.tsx](../src/plugins/customRPC/RpcSettings.tsx) | `RPCSettings()`、`SingleSetting()`、`SelectSetting()`、検証関数、`updateRPC`。単一設定を直接更新するフォーム |
| [customRPC/settings.css](../src/plugins/customRPC/settings.css) | 2列フォームと無効・エラー表示 |
| [musicRichPresence/index.tsx](../src/plugins/musicRichPresence/index.tsx) | `setActivity()`、`getActivity()`、`updatePresence()`。別socket、他Activity検出と任意の表示抑制 |
| [arRPC.web/index.tsx](../src/plugins/arRPC.web/index.tsx) | `handleEvent()`で外部からのActivityイベントをdispatch。画像の解決とアプリ情報の補完 |
| [ignoreActivities/index.tsx](../src/plugins/ignoreActivities/index.tsx) | `LocalActivityStore`と`ActivityTrackingStore`へのpatch、`isActivityNotIgnored()`。RPC・ゲームの表示経路にフィルターが存在する証拠 |
| [Activity.d.ts](../packages/discord-types/src/common/Activity.d.ts) | `Activity`、`ActivityAssets`、`ActivityButton`。timestampsはnumber、ボタンはラベル配列とURL配列 |
| [PresenceStore.d.ts](../packages/discord-types/src/stores/PresenceStore.d.ts) | `getActivities(userId, guildId?)`は`Activity[]`。`getPrimaryActivity()`は先頭を返す旨のコメント |
| [webpack/common/utils.ts](../src/webpack/common/utils.ts) | `ApplicationAssetUtils`はDiscordのwebpackモジュールを動的に解決。`fetchAssetIds`の検索条件にHTTP URLの判定あり |
| [api/Settings.ts](../src/api/Settings.ts) | `definePluginSettings()`、`withPrivateSettings()`、`settings.store/plain/use()`、変更時のネイティブ保存、移行API |
| [shared/SettingsStore.ts](../src/shared/SettingsStore.ts) | `proxyHandler`、`notifyListeners()`、`addChangeListener()`。ネストしたobject/arrayをProxyで追跡 |
| [main/settings.ts](../src/main/settings.ts) / [VencordNative.ts](../src/VencordNative.ts) | IPCからSettingsStoreへ渡し、`JSON.stringify`で設定ファイルを保存 |
| [customCommands/settings.ts](../src/plugins/customCommands/settings.ts) | `OptionType.CUSTOM`に`Record<string, Tag>`を保存する先例 |
| [customCommands/SettingsTagList.tsx](../src/plugins/customCommands/SettingsTagList.tsx) / [CreateTagModal.tsx](../src/plugins/customCommands/CreateTagModal.tsx) | Card一覧・追加編集削除・`openModal`・ローカルdraft・Save/Cancelの先例 |
| [textReplace/index.tsx](../src/plugins/textReplace/index.tsx) | `Rule[]`を`OptionType.CUSTOM`に保存、`crypto.randomUUID()`で安定IDを生成する先例 |
| [api/PluginManager.ts](../src/api/PluginManager.ts) | `startPlugin()`、`stopPlugin()`、Fluxの自動購読・解除、定義された設定のonChange登録 |
| [pinDms/index.tsx](../src/plugins/pinDms/index.tsx) | `start`と`flux.CONNECTION_OPEN`の両方で初期化する先例 |
| [PluginModal.tsx](../src/components/settings/tabs/plugins/PluginModal.tsx) / [types.ts](../src/utils/types.ts) | CUSTOMは汎用設定フォームに表示されない。COMPONENTで専用UIを供給できる |
| [scripts/build/common.mjs](../scripts/build/common.mjs) | `plugins`と`userplugins`を走査し、後者もビルドへ登録する |

### 現在の登録・更新

1. `definePluginSettings`には公開設定`enablePresence`と、フォームを出す`config`がある。RPC本体の値は`withPrivateSettings`で型付けされている。
2. `createActivity()`が単一の`settings.store`からActivityを生成する。`appName`が空なら`undefined`、`application_id`は`appID || "0"`、typeはPlaying、flagsは`1 << 0`を使用。
3. `setRpc(disable?)`は`createActivity()`をawaitした後、`LOCAL_ACTIVITY_UPDATE`を`socketId: "CustomRPC"`でdispatchする。解除時は`activity: null`。
4. `start: setRpc`、`stop: () => setRpc(true)`。フォームは検証済みの値を即保存し、debounceした`updateRPC`から解除と再登録を呼ぶ。
5. Activity Sharing設定の警告と設定画面プレビューがある。自分のRPCボタンを表示する任意patchもあるが、コメント上は機能の必須条件ではない。

注意: `setRpc(true)`でも画像解決を含む生成処理を先にawaitする。解除に不要な非同期処理と競合の余地があり、Multi版のcleanupにこの実装をそのまま流用しない。

### フィールド・Timestamp・画像

要求された項目に加え、既存には`streamLink`、`partySize`、`partyMaxSize`、全体の`enablePresence`がある。Activity TypeのUI選択肢はPlaying / Streaming / Listening / Watching / Competingで、Custom Statusはない。

| TimestampMode | 実コードの挙動 |
| --- | --- |
| `NONE = 0` | timestampsを付けない |
| `NOW = 1` | **Activity生成時**の`Date.now()`。UI名は「Since discord open」だがDiscord起動時刻の保持処理はない |
| `TIME = 2` | 現在時刻から時・分・秒を引いた、その日のローカル午前0時相当。計算上ミリ秒部分は残る |
| `CUSTOM = 3` | `startTime` / `endTime`をそのまま使用。片方のみでも可、既存はtruthyな値だけ設定 |

全モードを維持する。`NOW`を再接続時にも固定したい場合は既存挙動との意図的な差になるため、初期版では生成時刻という実挙動を維持し、UI表記を正確にする。生年月日等にはCUSTOMを使用する。

`imageBig` / `imageSmall`が**画像のAsset Keyまたは画像本体URL**。どちらも`ApplicationAssetUtils.fetchAssetIds(appID, [key])`を通す。`imageBigURL` / `imageSmallURL`は**画像クリック時の遷移先URL**であり、画像の取得元ではない。tooltipは`large_text` / `small_text`へ入る。既存UIはDiscord CDNリンクやImgur・Tenorの非直接画像リンクを拒否する。

外部URL対応の意図はUI、README、webpack検索条件から確認できるが、URL解決の内部アルゴリズム・キャッシュ期間はローカル実装にない。Discord既存resolverへ委譲し、独自プロキシや画像キャッシュは初期版に追加しない。

## 2. Feasibility

### Confirmed — ローカルコードで確定

- 配列の設定保存と複数Activityを扱う読み取りAPIは存在する。
- CustomRPCとMusicRichPresenceは同じdispatchイベントに別socket名を指定する。MusicRichPresenceは`"LastFM"`で、活動がない場合はnullを送る。
- MusicRichPresenceは`PresenceStore.getActivities()`を走査して他Activityを検出する。`hideWithSpotify`はデフォルトtrue、`hideWithActivity`はfalse。共存時の非表示にはプラグイン自身の方針も関わる。
- IgnoreActivitiesはLocalActivityStore側の一覧とゲーム検知側の一覧をフィルターする。
- ローカルにあるのはDiscordへの呼び出し・型・patch検索条件。`LOCAL_ACTIVITY_UPDATE`を処理するDiscord本体のstore実装と、最終表示一覧を作るUI本体はない。

### Likely — コードからの推定

- `MultiCustomRPC:${profile.id}`を別々に指定する設計は、既存の名前付きsocketの利用と整合する。
- 同一socketへの更新はそのActivityの置換、同一socketへのnullは個別解除として動作する可能性が高い。
- 複数Activityを持つデータ構造はあるが、同種RPCの複数表示や同一application IDの複数表示を保証する証拠にはならない。

### Needs PoC — 本実装のGate

- 異なるsocketの2件がstoreに残り、他ユーザー側にも届き、実際にプロフィールへ同時表示されること。
- 同一app ID / 異なるapp ID、および同一type / 異なるtypeでの集約・上書き条件。
- socket単位nullの個別解除と、残ったActivityの内容・Timestampの維持。
- プロフィール全画面・ポップアウト・メンバー一覧それぞれの表示数・順序・優先順位。固定上限値を設計上の事実として扱わない。
- ゲーム、Spotify、MusicRichPresence、CustomRPCとの共存、再接続、reload、プロセス終了後のサーバー側残留期間。

外部仕様の補足: Discord公式Gateway資料には`activities`配列の定義がある。ただし公開Gatewayモデルは、この非公開のローカルdispatchやUIの同時表示を保証しない。[公式Gateway Events](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway-events.mdx)。公式Timestamp資料にもミリ秒Unix時刻の定義があるが、本設計の直接の根拠はCustomRPC実装である。[公式ActivityTimestamps](https://discord.com/developers/docs/social-sdk/classdiscordpp_1_1ActivityTimestamps.html)。

**結論: 管理・保存は実装可能。同時公開・表示は有力だが未確認。現段階で「実現済み」「必ず表示できる」とは判定しない。**

## 3. Recommended Architecture

### 配置の比較

| 基準 | A: CustomRPC改修 | B: 独立userplugin（推奨） |
| --- | --- | --- |
| upstream追従・merge | 同じindex/UIへの変更が衝突しやすい | 本体差分を避けられる。参照元の変更点は手動確認 |
| 保守性 | 元の実装を一元管理できるが単一利用にも影響 | 独立して検証できる。Activity変換の複製部分を管理する必要 |
| 実装量 | 移行と既存UIの置換が必要 | 入口・モデル・UIが新規。変換ロジックは既存から最小限移植 |
| 競合 | 単一プラグインなので少ない | socket衝突は避けられるが表示枠・同一appの集約はPoC対象 |
| 将来のupstream提案 | 元機能の拡張として説明しやすい | userpluginのままでは取り込み前提でない。将来は共通化を別途設計 |
| 個人利用 | fork差分の継続管理が必要 | `src/userplugins`だけで導入・削除できる |

将来の提出可能性は設計上の比較のみ。本タスクではIssue/PRを作成しない。

```text
ProfileList + ProfileEditorModal（ローカルdraft）
             │ Save / Toggle / Delete
             ▼
settings.ts（検証済みJSON、配列を一括置換）
             │ profiles / enablePresenceの変更通知
             ▼
activityManager.ts（desiredと実行中の差分、競合排除、cleanup）
             │
             ├─ buildActivity(profile, context) → Activity
             │       └─ ApplicationAssetUtils.fetchAssetIds
             └─ dispatch(activity|null, socketId)
```

- `buildActivity()`はUIやSettingsを直接参照せず、渡されたprofile snapshotだけを読む。画像解決を含むためasync。時刻・asset resolverをcontextで渡せば決定的に検証できる。
- `publishActivity()`は生成したActivityを登録する境界。公開前にmanagerが有効性と世代を再確認する。
- `removeActivity(profileId)`は**同期的にnullをdispatch**する。画像・ネットワーク・生成処理を待たない。
- `reconcileProfiles()`が変更通知から必要なprofileだけ更新し、削除済み・無効化済み・不正になったprofileを解除する。
- `CustomRPC`から直接importしない。既存のbuilderは非exportで、settingsと強く結合し、importすると旧プラグインの定義まで依存する。既存変換を小さく移植し、元のcommitと対応項目を記録する。共通のSettings・UI部品・Discord asset resolverは再利用する。
- ボタン自己表示patchやDiscordのActivity一覧を改変するpatchは初期版に加えない。

## 4. Data Model

```ts
import { ActivityType } from "@vencord/discord-types/enums";

export enum TimestampMode { NONE, NOW, TIME, CUSTOM }

export interface RpcProfile {
    id: string;
    name: string;                 // 管理画面の表示名
    enabled: boolean;
    appID?: string;
    appName: string;              // 公開Activityの名前
    type: ActivityType.PLAYING | ActivityType.STREAMING
        | ActivityType.LISTENING | ActivityType.WATCHING
        | ActivityType.COMPETING;
    details?: string;
    detailsURL?: string;
    state?: string;
    stateURL?: string;
    streamLink?: string;
    timestampMode: TimestampMode;
    startTime?: number;           // milliseconds since Unix epoch
    endTime?: number;
    imageBig?: string;            // asset key / image source URL
    imageBigTooltip?: string;
    imageBigURL?: string;         // image click destination
    imageSmall?: string;
    imageSmallTooltip?: string;
    imageSmallURL?: string;
    buttonOneText?: string;
    buttonOneURL?: string;
    buttonTwoText?: string;
    buttonTwoURL?: string;
    partySize?: number;
    partyMaxSize?: number;
}
```

永続化は`definePluginSettings`に次を定義する。`profiles`は`OptionType.CUSTOM`、defaultは`[] as RpcProfile[]`、`enablePresence`はBOOLEAN、`config`はCOMPONENT。`schemaVersion`はprivate setting等に保持し、現スキーマを1とする。新規インストールの一覧は空。未来の未知schemaは自動変換せず、公開を停止してエラーを表示し、元データは保持する。

`withPrivateSettings`は型情報の追加であり、ランタイム検証・デフォルト初期化・秘匿保存ではない。CUSTOMにもランタイム検証はない。読込時に`unknown`として配列と各profileを検証し、問題のある行だけ公開対象から外す。

### ID・更新・破損耐性

- IDは追加時に`crypto.randomUUID()`で作り保存。編集・並び替え・再起動で変更せず、複製時は新IDを発行する。名前や配列indexをsocketに使わない。
- socket IDは`MultiCustomRPC:${id}`。app IDとは別物であり、socket IDをapplication_idやActivityのidに流用しない。
- 読込時にID欠損・重複を検出した場合、その問題行を公開せず修復可能にする。曖昧なsocketを共有しない。原データを無断削除しない。
- Saveではdraftを検証して`settings.store.profiles = nextProfiles`と配列ごと置換する。ネスト変更も追跡可能だが、draftをstoreへ結合せず、中間状態の保存・多重通知を避ける。
- JSONに保存できるplain object / array / string / boolean / finite numberだけを入れる。Map、Set、Promise、実行時エラー、resolver cacheは永続化しない。
- `SettingsStore.plain`を直接変更しない。`settings.use(["profiles"])`で一覧を購読し、managerはSettingsStoreのpath listenerをstart時登録・stop時解除する。
- API上の永続化は確認できるが、ディスク書込成功やクラッシュ時の原子的保存までは保証されない。既存設定基盤に従い、独自の保存ファイルを増やさない。

### 検証・変換方針

既存UIの長さ制限・ID形式・URL・streaming判定を基準にする。application IDは省略時`"0"`という既存互換を維持しつつ、画像使用時は有効なapp IDとresolver結果を確認する。appNameと管理名は必須、時刻は有限の非負安全整数、開始・終了が両方ある場合は開始≦終了、partyは正整数で現在数≦最大数を検証する。

ボタンはテキストとURLを組として検証し、組から2本の配列を生成する。既存の別々の`.filter(isTruthy)`によるラベル・URLのずれは引き継がない。上限は既存UIの31文字をまず維持する。type 0や数値0を一律falsyで削除せず、プロパティごとに省略ルールを決める。timestamp 0は既存のtruthy判定では省略されるため、初期版は0を未指定相当と明記する。

CUSTOMの値はprofile単位で保持し、再接続や別profileの編集で書き換えない。NOW/TIMEもモード値を保存し、生成時に算出する。

画像は共通`resolveAsset(appID, key)`ラッパーから既存resolverへ委譲する。独自キャッシュは不要。将来必要ならappIDとkeyの組でキャッシュし、他profileのapp IDを参照しない。resolver失敗時は当該profileの公開を停止・旧Activityを解除し、他profileを継続する。

なお、この設計は専用Cloud同期を追加しない。既存Settingsに入れるため、Vencord全体の設定同期・バックアップの対象にはなり得る。`private`という名称を同期対象外と解釈しない。

## 5. Activity Lifecycle

### 競合を防ぐmanager

実行時状態として`running`、プラグイン世代`epoch`、profile別revision、公開/試行したsocketの集合、前回の検証済みsnapshot、profile別エラーを保持する。

各更新でplain snapshotを作りrevisionを進める。build開始時のepoch/revisionを捕捉し、await後に「running、同じ世代、同じrevision、現時点でも存在してenabled、全体ON」を満たす場合だけdispatchする。失敗時のcleanupも同じ世代であることを確認し、古い失敗が新しいActivityを消さないようにする。

非同期処理はprofileごとにcatchし、`Promise.allSettled`等で分離する。1件失敗しても他を中断しない。`startPlugin()`/`stopPlugin()`は返されたPromiseをawaitしないので、`start()`は内部タスクの例外処理を用意し、`stop()`は同期cleanupを完了させる。

| イベント | 期待する動作 |
| --- | --- |
| Plugin start | running/epoch初期化→設定読込検証→listener登録→自分の既知socketをnullで整理→有効profileを生成・登録。全体OFFなら登録しない |
| Profile enable | 新revisionで当該profileだけ生成。全体ONなら公開 |
| Profile disable | revision無効化→該当socketを即null。設定は保持 |
| Profile edit | Save後、公開内容が変わる行のみ再生成。同じsocketを更新。type/app ID変更時の事前nullが必要かはPoCで決定。管理名だけなら再公開しない |
| Profile delete | revision無効化→該当socketをnull→一覧から除外。削除前のsocketはmanagerが保持し、設定更新通知からも差分cleanup可能にする |
| Duplicate | 新ID・名前「コピー」・enabled=falseで追加し、意図しない即公開を避ける |
| 全体OFF | 全revision無効化→所有socketを全解除。個別enabledは維持 |
| Plugin disable | 最初にrunning=false、epoch更新、listener/保留タスクの予約を解除→所有socketをすべて同期的にnull。画像処理の完了を待たない |
| 再接続 | `flux.CONNECTION_OPEN`からreconcileを予約。Flux dispatch中の再dispatchを避け、`FluxDispatcher.wait`等の実際のAPIを確認してキューへ回す。enabled最新snapshotを再送 |
| Plugin再有効化 | 保存済みIDを再利用し、同じsocketへ登録。以前の非同期処理はepoch不一致で捨てる |
| Vencord reload | 通常のrenderer再読み込みではstopが必ず走ると仮定しない。新起動で再整合。メモリだけ差し替えるHMRの場合はstop経路を必須にする |
| Discord再起動 | 設定から再登録。旧セッションのサーバー残留が解消する時点はPoCで記録 |

既知socketの範囲は「現在設定にあるID＋managerが以前扱ったID」。他プラグインのsocketやsocket省略の解除は送らない。旧JS実行環境が消えた後の未知socketやサーバー残留をコードだけで完全に消せるとは保証しない。reload試験で残留が起きる場合はGate未通過とし、原因を確認して必要な所有ID管理を追加設計する。

既存MusicRichPresenceのstopはタイマー停止だけで、明示nullを送っていない。これはMulti版のcleanup要件を満たす先例ではない。またarRPCのsocket省略nullも個別解除の見本として使用しない。

## 6. UI / UX

**Card一覧＋1件ずつ編集するModal**を選ぶ。CustomCommandsの既存実装と同じ構造で、巨大フォームの常時表示を避け、Cancelで設定・公開を変えない操作にできる。展開Cardは複数を開くと縦長になりやすく、専用設定ページは新しい遷移の実装が増える。

```text
Multi Custom RPC
[ON] Enable Presence
Activity SharingがOFFなら既存CustomRPCと同様の案内

Custom RPC Profiles
[ON] Birthday / Since 2003     Playing
     Edit   Duplicate   Delete
[ON] Coding                    Playing
     Edit   Duplicate   Delete
[OFF] Broken profile           エラー内容 / Edit / Delete
[+ Add RPC]
```

- 管理名・Activity type・ON/OFF・検証/画像エラーを一覧に表示。dispatch済みを「他ユーザーに表示済み」と表現しない。
- Modalは「基本」「テキスト/リンク」「画像」「ボタン」「Timestamp」「Streaming/Party」に分ける。既存Flex、Heading、TextInput、Select、Switch、Modal等を再利用する。
- typeやtimestamp modeに応じた無効化は既存UIに合わせる。保存は全体検証が通った時だけ可能。Cancelは破棄。削除は確認を挟む。
- Profile enabledと全体Enable Presence、Plugin enabledの3段階を区別する。
- プレビューは後続の任意改善とし、付けるなら選択中の1件のみ。builderを使い、公開managerは呼ばない。プレビュー生成が公開の時刻・revisionを変えない。
- 自分のボタンが見えないことだけで不合格にせず、他ユーザー側で検証する。
- 並び替えは初期必須にしない。後続で上/下ボタンを追加すれば配列入替のみで低コスト。drag-and-dropは不要。順序は管理画面と登録処理の順序で、Discord表示順位を保証しない。順序変更だけで不要な再公開をしない。

## 7. Migration / Compatibility

| 案 | 利点 | 欠点・制約 |
| --- | --- | --- |
| 既存CustomRPCを改修してProfile 1へ自動移行 | 利用者の入力を維持 | upstream差分が増え、旧UI/旧形式へのrollbackを設計する必要 |
| 新Pluginとして完全分離 | 旧設定を壊さず、依存・変更が最小 | 既存値の手動再設定が必要 |
| 初回のみ旧設定をコピー | 移行負担を減らせる | 初回判定・スキーマ・旧機能との重複・再実行防止が必要 |
| 同時利用禁止 | 重複表示を避けやすい | 既存PluginManager/UIへの干渉が増え、別socketの利点を使えない |

**初期版は完全分離・空の一覧から開始を推奨する。** 要件で除外されたImport/Exportを実装せず、既存`Settings.plugins.CustomRPC`も変更しない。既存CustomRPCとの共存をPoCするが、同じ設定の二重登録は利用者が旧側をOFFにして避ける。検証前の強制排他や他プラグインの自動停止は行わない。

一回限りの互換移行を将来採用するなら、汎用Import機能とは分け、許可されたフィールドをsnapshotでコピーし、新ID・無効profileとして保存、専用markerで再実行を防ぐ。`migratePluginSettings()`は旧キーを削除する名前変更API、`migratePluginSetting()`も旧キーを削除するため、独立Pluginへの非破壊コピーにそのまま使わない。初期フェーズの実装対象には含めない。

## 8. PoC Plan

### 目的・範囲

保存・プロフィール編集画面・画像・Timestampなしで、名前付き2socketの同時登録と個別解除だけを検証する。次は**提案コード**でありファイル作成・実行はしていない。仮置き先は`src/userplugins/multiCustomRPC/index.ts`。PoC成功後に置き換え、PoCと製品版を同時に有効化しない。

```ts
import definePlugin from "@utils/types";
import { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { FluxDispatcher } from "@webpack/common";

const sockets = ["MultiCustomRPC:test-a", "MultiCustomRPC:test-b"];
// まず既存CustomRPCと同じfallbackで最小経路を確認する。
// 続いて、利用者が所有する実在app IDへ変更して下記の組合せを検証する。
const appIds = ["0", "0"];

function update(index: number, activity: Activity | null) {
    FluxDispatcher.dispatch({
        type: "LOCAL_ACTIVITY_UPDATE",
        socketId: sockets[index],
        activity
    });
}

function clear() {
    sockets.forEach((_, i) => update(i, null));
}

function publish() {
    clear();
    sockets.forEach((_, i) => update(i, {
        application_id: appIds[i],
        name: `MultiCustomRPC test ${i === 0 ? "A" : "B"}`,
        details: `Independent socket ${i}`,
        type: ActivityType.PLAYING,
        flags: ActivityFlags.INSTANCE
    }));
}

export default definePlugin({
    name: "MultiCustomRPCPoC",
    description: "Verify independent local activity sockets",
    // 検証用。配布する場合は実際の作者情報を設定する。
    authors: [],
    start: publish,
    stop: clear,
    toolboxActions: {
        "Publish A + B": publish,
        "Remove A only": () => update(0, null),
        "Remove B only": () => update(1, null),
        "Remove both": clear
    }
});
```

Toolbox操作は型定義にある`Record<string, () => void>`を利用する検証用操作だけ。独自UIは作らない。作者欄は配布時に正しいメタデータを設定する。

### 手順と記録

1. Discordのビルド/チャンネル、OS、Vencord commit、時刻、Activity Sharing、関係するプラグイン設定を記録する。既存状態を観測してからPoCだけを有効化する。
2. A/Bを登録し、可能なら実行時のLocalActivityStore、`PresenceStore.getActivities(自分のID)`、自分のプロフィール、**別ユーザーのプロフィール表示**をそれぞれ確認する。storeは実行時に実在するメソッドを確認して使い、存在不明のAPIを前提にしない。
3. Aだけ解除→Bのみ、再登録→Bだけ解除→Aのみ、両解除→両方なしを確認。別Activityが消えないことも記録する。
4. app IDの組合せを`0/0`、実在する同一ID、実在する異なるIDへ変えて試す。さらに同一typeとPlaying/Watching等の異なるtypeを比較する。`0/0`失敗だけで実在IDも不可能とは結論しない。
5. 登録順AB/BAを変え、同一socketの内容・type・app ID更新が置換になるか確認。2件目で上書き、同一appのみ集約等の条件を特定する。
6. 別ユーザー側での反映時刻・遅延を記録する。初期観測窓は60秒とし、遅延・レート制限が疑われる場合は低頻度で再試験し、断定しない。
7. 通信再接続、通常reload、Discord完全終了/再起動、Plugin OFF/ONを試す。PoCは再接続フックを持たないので、再接続後に保持されるかをまず観測し、消える場合は手動Publishで回復するか確認する。
8. CustomRPC、MusicRichPresence、Spotify、ゲームを1つずつ追加する。MusicRichPresenceのhide設定とIgnoreActivitiesのフィルターを記録し、意図した非表示と上書きを区別する。
9. 2件合格後、検証時だけC/D…を少数ずつ追加し、プロフィール各UI・メンバー一覧で見える数を記録する。無制限の追加や高頻度の再送はしない。上限は試した環境の観測値として記録する。
10. `Remove both`、Plugin無効化で終了し、他ユーザー側でもPoCの2件が消えることを確認する。

記録表は「条件 / ローカルstore件数 / PresenceStore件数 / 自分のUI / 別ユーザーUI / 解除結果 / 反映時間 / 備考」。未観測は未観測と書き、自己プレビューだけで合格にしない。

**Gate合格:** 実在app IDを使用した条件で、2件が別ユーザーのプロフィールへ同時表示され、個別・全解除が成功すること。同一app IDで失敗し異なるIDで成功するなら「profileごとに異なるapp ID必須」という制約を明記し、要件への適合を判断してから本実装へ進む。再起動後の再登録・cleanupと他Activityの非破壊共存も確認する。

**失敗時:** store登録、外部伝播、UI描画のどこで失われるか切り分ける。単一アクティブprofileの切替だけで満たせる代替案、または別app IDの利用を検討する。同時表示要件を満たさない案を成功扱いしない。自動ローテーションやDiscord本体の大規模patchはこのタスクへ追加しない。

## 9. File Change Plan

PoCは前節の1ファイルのみ。本実装はGate通過後に次を予定する。

| ファイル | 役割 |
| --- | --- |
| `src/userplugins/multiCustomRPC/index.tsx` | definePlugin、start/stop、settingsの接続、再接続イベント、警告UI |
| `src/userplugins/multiCustomRPC/types.ts` | RpcProfile、TimestampMode、schema型 |
| `src/userplugins/multiCustomRPC/settings.ts` | CUSTOM配列、全体トグル、CRUD、snapshotとランタイム検証。小規模なら検証もここに集約 |
| `src/userplugins/multiCustomRPC/activity.ts` | buildActivity、時刻変換、既存asset resolverへの委譲 |
| `src/userplugins/multiCustomRPC/activityManager.ts` | reconcile、publish/remove、世代・revision、所有socket、エラー状態 |
| `src/userplugins/multiCustomRPC/ProfileList.tsx` | Card一覧、トグル、追加/複製/削除 |
| `src/userplugins/multiCustomRPC/ProfileEditorModal.tsx` | draft、検証、Save/Cancel。元フォームの項目・制約を移植 |
| `src/userplugins/multiCustomRPC/styles.css` | 必要な一覧/Modalの最小スタイル。共通部品で足りれば不要 |
| `src/userplugins/multiCustomRPC/README.md` | 検証済み環境・制約・使い方・元実装commitと追従時の確認点 |
| `docs/multi-custom-rpc-design.md` | 本書。PoCの結果に応じて設計判断を更新 |

既存`src/plugins/customRPC`、Settings API、PluginManager、共通webpack、ビルド設定は変更しない計画。既存のGPLヘッダーと由来の著作権表記を移植時に保持する。テストファイルの配置・実行方法はプロジェクトの実行環境に合わせ、既存ビルドのplugin走査に誤って拾われない場所を選ぶ。

## 10. Implementation Phases

| Phase | 内容・終了条件 |
| --- | --- |
| 0: PoC | 前節の最小コードで同時表示・個別解除・reload・共存を観測。Gate未通過なら以降へ進まない |
| 1: Model / lifecycle | 全既存項目を扱うbuilder、同期remove、世代制御、差分reconcile。画像待機中の無効化/削除/stopを含めて検証 |
| 2: Persistence | CUSTOM配列、schema、UUID、CRUD、ランタイム検証。再起動後の保持・1件破損時の分離を確認 |
| 3: Profile UI | Card一覧＋Modal、Save/Cancel、複製、警告。巨大な一覧フォームを作らない |
| 4: Compatibility / cleanup | 旧CustomRPCへの非干渉、全体OFF、再接続、reload、再有効化。移行機構は初期版では不要 |
| 5: Testing / polish | 意味のあるbuilder/manager検証、型・lint・build、別ユーザーでの受入、制約と設定説明をREADMEへ反映 |

実装後の静的検証候補は`pnpm testTsc`、`pnpm exec eslint src/userplugins/multiCustomRPC`、対象CSSがあれば明示パスでstylelint、`pnpm build`。package.jsonのlint-stylesはuserpluginsを除外するため、それだけでCSS検証済みとしない。Webも対象とする場合は`pnpm buildWeb`とWeb実機試験を追加する。

テストは単なるCRUDの写経より、await完了順逆転・stop後の画像解決・古い失敗による新Activity削除防止・1件のresolver失敗で他が継続するケースを優先する。本調査では文書のみを追加したためbuild/testやDiscord実機試験は行っていない。

## 11. Risks

| リスク | 対応 |
| --- | --- |
| 別socketでも同じapp/typeが集約される | Phase 0で実在ID・typeを分けた条件を比較し、実現条件を確定 |
| データ上は複数でもUIは一部だけ表示 | store・外部受信・UIを分けて記録。メンバー一覧とプロフィールの保証を混同しない |
| Discord側の非公開実装変更 | 依存境界をbuilder/dispatcherに集約。upstreamとDiscord更新後にPoCを再実施 |
| 停止・編集と非同期asset解決が競合 | epoch＋profile revision、snapshot、同期null。古い成功・失敗の両方を無効化 |
| reloadや切断後に残留/消失 | 再接続の再整合、既知socketのcleanup。stop必須と決めつけず実機試験でGate判定 |
| 1件の設定破損が全体を停止 | 行単位検証・行単位例外処理・重複ID隔離・元データ保持 |
| 同一image keyを別appで誤解決 | resolverへ各snapshotのapp IDを渡す。独自キャッシュを追加する場合はapp IDもキーに含める |
| ボタンURL配列がずれる | 入力をペアとして検証し同じペア一覧から両配列を生成 |
| 既存コード複製の追従漏れ | 元commitと対応項目を記録し、CustomRPC変更時にbuilder・validationを比較 |
| 多件数で送信が集中する | Save時の更新を基本とし変更profileのみ送信。再接続をまとめ、問題があればPoC結果に基づく間隔/件数制限を追加 |
| 長年の経過時間がUIで省略/制限される | 過去のCUSTOM時刻を実機で試す。データの保持とDiscordの経過時間描画は別に評価 |
| 設定保存のwrite失敗 | 既存基盤の限界として扱い、再起動で保存内容を確認。独自保存基盤の導入で影響を広げない |

Cloud同期の新規実装、自動ローテーション、時間帯切替、ゲーム検知、Spotify自動連携、プリセット共有、Import/Export、高度なテンプレートは対象外。

## 12. Acceptance Criteria

以下は本実装の受入条件であり、現時点で達成したという意味ではない。

- [ ] PoCの結果を環境・条件付きで記録し、2件同時表示と個別解除のGateを通過している。
- [ ] 2件以上を追加・編集・削除・複製・個別ON/OFFできる。DuplicateのIDは別で、初期状態はOFF。
- [ ] 再起動後もID・管理名・enabled・全既存RPCフィールド・ミリ秒Timestampが保持される。
- [ ] 同時公開の必要条件（同一app ID可否など）をUI/READMEに明記し、未確認の表示上限・優先順位を保証しない。
- [ ] Playing / Streaming / Listening / Watching / Competing、streamLink、party情報、テキストリンク、画像2種とクリック先、ボタン2組、4種のTimestamp modeを扱える。
- [ ] NONE / NOW / TIME / CUSTOMの定義が明記され、CUSTOMの値は他profile更新や再接続で変わらない。
- [ ] Asset Keyと外部画像URLをprofileごとのapp IDで解決し、失敗profile以外は継続する。
- [ ] Save前・Cancel時には設定も公開状態も変わらず、検証エラーを保存しない。
- [ ] Profile無効化・削除・全体OFF・Plugin停止で所有socketだけを解除し、他Activityを消さない。
- [ ] 画像解決待機中の編集・削除・停止、完了順の逆転、古い失敗のいずれでも削除済み/古いActivityが復活しない。
- [ ] 再接続・reload・Discord再起動・Plugin再有効化後に重複や残留がなく、有効profileの期待状態へ戻ることを別ユーザー側でも確認する。
- [ ] 不正profileまたは重複IDが混入しても正常profileを公開でき、原データを無断削除しない。
- [ ] 既存CustomRPCのコード・保存値・有効状態を変更せず、共存時の制約を説明できる。
- [ ] カード一覧と1件ずつの編集Modalで操作でき、Activity Sharing OFFを判別できる。
- [ ] 変更に対応する型・lint・buildと競合ケースの検証を通過し、実機試験の条件・未対応範囲を記録する。

## Implementation Brief — Cursorへ渡す実装指示書

対象はVencord forkの`feat/multi-custom-rpc`。設計根拠は本書と`src/plugins/customRPC/{index.tsx,RpcSettings.tsx}`。Issue/PRは作成しない。

1. **最初はPhase 0だけ。** 本書の2socket PoCを最小userpluginとして実装し、別ユーザーのプロフィールで2件同時表示、個別/全解除、同一/別app ID、再接続・reload・再起動・他Activity共存を確認する。実行環境がなければ未検証と報告し、Gate通過扱いにせず本実装へ進まない。
2. Gate合格後、`src/userplugins/multiCustomRPC`に独立Pluginを作成。既存CustomRPC・Settings API・PluginManager・ビルド設定は変更せず、旧設定への自動移行や強制排他は加えない。
3. `RpcProfile[]`をCUSTOM設定、全体enablePresenceをBOOLEANとして保存。UUIDを保存し、socketは`MultiCustomRPC:${profile.id}`。全既存項目に加え管理名とenabledを持たせる。schemaと行単位のランタイム検証を実装する。
4. profile snapshotから生成するasync builder、同期remove、世代/revision付きmanager、設定、UIを分離。Discord既存asset resolverを利用する。画像本体URLとクリック先URLを混同しない。ボタンはラベル/URLのペアから生成する。
5. await後の有効性再確認、削除/停止時の即null、古い失敗の無効化、行単位エラー分離を必須とする。stopはPromise待ちにしない。CONNECTION_OPENの再整合はdispatchの再入を避けて予約する。
6. UIはCustomCommandsのCard一覧＋Modalを参考にする。Save/Cancel、Add/Edit/Delete/Duplicate/Toggleを実装し、Duplicateは新ID・OFF。並び替えは任意で表示順位保証はしない。プレビューと自己ボタン表示patchは必須にしない。
7. Timestampは既存4モードとミリ秒単位を維持。NOWは生成時刻という実挙動を説明する。CUSTOMは再接続で書き換えない。
8. 対象外機能を追加せず、静的検証と非同期競合の検証、別ユーザーでの受入を完了する。未観測のDiscord仕様を断定せず、PoC結果・制約・元実装commitをREADMEに残す。
