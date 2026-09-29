# Rayfin 業務アプリ

顧客の声、商品開発、供給と注文、オントロジー表示、Data Copilot の既存画面・クライアントと Rayfin 定義を移植済みです。親リポジトリは不要です。

## 起動

Node.js 22.12 以上で、このディレクトリから実行します。

```powershell
npm ci
npm run dev
```

既定は `http://127.0.0.1:4186/` です。使用中なら起動ログのポートを使用してください。終了は Ctrl+C です。別ポートは `npm run dev -- --port 4190` で指定できます。接続設定なしの場合は、同梱データを使うメモリーモードで開きます。保存は実 DB への書込みではなく、Graph・IQ・RTI の実照会も行いません。

## 実データ接続

[.env.example](.env.example) をこのディレクトリの `.env` として設定します。`VITE_` の値はブラウザー配信物に含まれるため、API キー、接続文字列、クライアントシークレットを記載しません。

| 機能 | 設定 |
| --- | --- |
| Rayfin | `VITE_RAYFIN_API_URL`、`VITE_RAYFIN_PUBLISHABLE_KEY`、`VITE_FABRIC_WORKSPACE_ID`、`VITE_FABRIC_ITEM_ID` |
| DAX | `VITE_SEMANTIC_MODEL_ID`。同梱の 26 テーブルと必要な予測テーブルを持つモデル |
| Graph | `VITE_DEVELOPMENT_GRAPH_ID`、`VITE_SUPPLY_GRAPH_ID`、`VITE_ENTRA_TENANT_ID`、`VITE_ENTRA_CLIENT_ID` |
| Data Copilot | `VITE_FOUNDRY_PROJECT_ENDPOINT`、`VITE_FOUNDRY_AGENT_NAME`、`VITE_FOUNDRY_AGENT_VERSION` |
| RTI | `VITE_RTI_QUERY_URI`、`VITE_RTI_DATABASE`。`SocialVoiceWindow` / `SocialVoiceLatest` 関数を持つ Eventhouse |
| 分析時刻 | `VITE_ANALYTICS_TIMESTAMP_OFFSET`。新データ基盤の UTC は `+00:00`、元の JST 格納モデルでは `+09:00` |

接続定義は [src/connection-config.ts](src/connection-config.ts) です。`gold_shipment_risk`、`gold_demand_forecast`、`gold_bean_depletion` は任意で、取得不能なら予測なしで表示します。接続モードで通常テーブルを取得できない場合はエラーとし、メモリーデータへ自動的に切り替えません。

DAX の実利用には Fabric ホスト内の実行が必要です。Rayfin SSO 自体は Fabric ポータルのポップアップ経由でも利用できますが、DAX のホスト依存を解消するものではありません。セマンティック モデルの Build / Read 権限と、テナントの Execute Queries 設定も必要です。MSAL 用アプリ登録のリダイレクト URI は実際の配備先に合わせ、Graph には `Item.Read.All`、Foundry には `https://ai.azure.com/user_impersonation` の委任権限・同意を構成します。以下の公式資料を 2026-09-28 に確認しています。

`VITE_FOUNDRY_AUTO_APPROVE_MCP` は既定で `false` です。信頼済みの読取り専用 MCP 接続だけを採用し、承認方針を確認した場合に限り明示的に有効化します。未設定の Foundry / Eventhouse にはリクエストを送りません。

## Rayfin 配備

[rayfin/rayfin.yml](rayfin/rayfin.yml) のアプリ名、認証の許可 URI、接続先を新環境用に確認してから、このディレクトリで `npm run deploy` を実行します。これは `rayfin up` を呼び、クラウド資源を変更する処理です。今回実行していません。`--force` は使用しません。

`rayfin up` が作る管理 SQL の定義は [rayfin/data/schema.ts](rayfin/data/schema.ts) が入口です。その後は [E2E 構築手順](../../docs/end-to-end-setup.md) の順に、元データの 12 テーブルを `prepare_application.py` で SQL 化して初期投入し、29 テーブルの Semantic Model、Graph、Foundry/IQ を接続します。RTI は同梱 KQL、予測表示は元の固定スナップショットを使います。管理 SQL の特定、初期投入の空テーブル条件、同期担当者の権限、SPA コールバック、環境変数、静的画面の再配備まで同手順に記載しています。

Functions のソースは互換性のため同梱していますが、標準の `functions.enabled` は `false` のままです。現行 Data Copilot は Functions を経由しません。任意に有効化する際の依存は `npm --prefix rayfin/functions ci`、設定は `FOUNDRY_PROJECT_ENDPOINT`、`FOUNDRY_AGENT_NAME`、`FOUNDRY_AGENT_VERSION` です。

Fabric ホストとデータ接続: https://learn.microsoft.com/en-us/fabric/apps/data-apps-template

SSO: https://learn.microsoft.com/en-us/fabric/apps/fabric-authentication

## 内部構成

```text
operations/
|-- src/             React、業務計算、データ取得、Graph、Copilot
|-- public/          公開可能な画像・認証コールバック資産
|-- rayfin/
|   |-- data/        エンティティ、アクセス許可、schema.ts
|   `-- rayfin.yml   認証・管理 SQL・静的ホスティング
`-- package.json     業務アプリ単独の開発・生成・配備用依存
```

Rayfin 設定と業務画面を同じアプリ配下に置き、静的資産のビルド基準ディレクトリを維持します。Rayfin 全体を別の backend フォルダーへ移して相対パスを壊す再配置は行いません。

## 取得経路

| 対象 | 引き継ぐ経路 |
| --- | --- |
| 開発マスター・保存記録・同期済み EC 受注 | Rayfin SDK から管理 SQL |
| 分析テーブル・予測結果 | Fabric ホスト経由のセマンティック モデル / DAX |
| レコードの関連探索 | MSAL 利用者委任による Fabric Graph / GQL |
| Data Copilot | ブラウザーから Foundry Responses API |
| ローカルのデモ表示 | シナリオの合成原本から作るスナップショット |

これらを一つの API・認証方式に見せかけません。実データ取得の失敗をローカル合成データへの切替で隠さず、利用者が選択したモードとデータの由来を区別します。

## 公開時の対象

現行の顧客の声、商品開発、供給の画面を標準入口として移植しました。未使用の Rayfin Functions を必須ランタイムとして扱いません。

Foundry Agent の画面操作は、型付きの許可済み操作として引数を検証します。既存の MCP 承認の自動応答は、公開前に接続先・読み取り専用性・利用者確認の必要性を見直します。画面操作の成功と実業務データの更新を区別します。

