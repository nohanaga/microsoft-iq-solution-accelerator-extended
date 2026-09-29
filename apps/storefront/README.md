# EC アプリ

顧客向け画面、Express API、文字相談の Python ワーカー、音声クライアント、PostgreSQL の DDL・初期投入を移植済みです。親リポジトリは不要です。クラウド資源の自動作成は含みません。

## 起動

Node.js 22.12 以上を使用します。このディレクトリで次を実行します。

```powershell
npm ci
npm run dev
```

入口は起動ログの URL + `/shop` です。既定は `http://127.0.0.1:5180/shop`、使用中なら別ポートに進みます。終了は Ctrl+C です。設定なしでもサンプル商品を閲覧できます。DB 保存や AI 応答を模擬するモードではありません。

本番ビルド用の定義は `npm run build`、起動は `npm start` です。今回、本番ビルドは実行していません。現行サーバーはループバック待受・同一オリジンを前提とします。

## 接続設定

[.env.example](.env.example) をこのディレクトリの `.env` として設定し、サーバーを再起動します。秘密情報を Git やブラウザーへ渡しません。

| 機能 | 主な設定 |
| --- | --- |
| 文字相談 | `BARISTA_AGENT_ENDPOINT`、`BARISTA_AGENT_DEPLOYMENT`、`BARISTA_AGENT_PYTHON` |
| Azure 認証 | `AZURE_OPENAI_AUTH_MODE=entra_id` または `api_key`。キーを使う場合だけ `AZURE_OPENAI_API_KEY` |
| Realtime 音声 | `AZURE_OPENAI_ENDPOINT`、`AZURE_OPENAI_DEPLOYMENT_NAME` |
| PostgreSQL | `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PG_TENANT_ID` |
| DB 認証 | `PG_AUTH_MODE=azure_cli` または `managed_identity`。ユーザー割当時は `PG_MANAGED_IDENTITY_CLIENT_ID` |
| 任意の GPT-Live + Jev | `VOICE_LIVE_JEV_ENABLED=true`、`AZURE_GPT_LIVE_*`、`TYPESAFE_API_KEY` |

モデルの値は、使用するリソースに実在するデプロイ名です。サンプル名のモデルを自動作成しません。文字相談では Python 3.12 の仮想環境をこのアプリ内に用意します。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r agent/requirements.txt
```

Windows では既定で `.venv/Scripts/python.exe` を使います。他の OS や環境では `BARISTA_AGENT_PYTHON` に実際の実行ファイルを設定してください。`GET /api/agent/config` は未設定の理由を返します。音声の設定入口は `GET /api/config` です。

## PostgreSQL 初期投入

専用の空の Azure Database for PostgreSQL Flexible Server データベースを用意し、Microsoft Entra 管理者、DB 内のロール、限定したネットワーク許可を設定します。Azure CLI は対象テナントの投入担当者でサインイン済みとします。既存の本番 DB には実行しません。

```powershell
.\.venv\Scripts\python.exe -m pip install -r postgres/requirements.txt
.\.venv\Scripts\python.exe postgres/seed-azure.py --tenant-id '<tenant-id>' --subscription-id '<subscription-id>' --resource-group '<resource-group>' --server-name '<server-name>' --database '<database>' --confirm-synthetic
```

[seed-azure.py](postgres/seed-azure.py) は対象のテナント・サーバーを確認して [001-schema.sql](postgres/001-schema.sql)、[002-seed.sql](postgres/002-seed.sql) を適用し、カタログと読み戻した全商品の内容を照合します。商品・店舗・供給会社に既存行があれば初期投入は停止します。`--confirm-synthetic` を外して `--read-only` にすると投入せず照合だけを行います。出力先は accelerator ルートの `artifacts/commerce/` です。この新環境向け処理は今回実行していません。

商品の編集元は [src/data/products.ts](src/data/products.ts)、共通 SKU・店舗・供給会社は [シナリオ原本](../../scenarios/micro-coffee/data/operations.json) です。`npm run data:prepare` が [data/catalogue.json](data/catalogue.json) と初期投入 SQL を再生成します。生成物を手編集しても再生成で上書きされます。

DB 接続後は EC の「データ設定」から PostgreSQL を選択します。DB エラーをサンプル成功に置き換えません。アプリの実行主体には商品・店舗の参照と、受注・明細・outbox に必要な最小の権限を付与します。初期投入用の管理者をそのまま公開アプリに流用しません。

公式の認証手順（2026-09-28 参照）: https://learn.microsoft.com/en-us/azure/postgresql/security/security-entra-configure

TLS: https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls-how-to-connect

## 内部構成

```text
storefront/
|-- src/             React、EC 操作、文字・音声クライアント
|-- server/          Express、商品・注文 API、Agent・音声の接続仲介
|-- agent/           Python ワーカーと固定した依存定義
|-- postgres/        EC のテーブル・ビュー・outbox のマイグレーション
|-- public/          再配布可能な公開資産のみ
`-- package.json     EC 単独の開発・ビルド・起動定義
```

画面と Node.js を分離配備することや、Python ワーカーを HTTP サービス化することは、初回移植では行いません。現在の標準入出力 JSONL と NDJSON の経路を維持します。音声は文字ワーカーと別経路であり、Realtime と GPT-Live + Jev の設定を混同しません。

## データの所有

- EC の PostgreSQL が商品・受注・明細・同期 outbox を保持します。DDL はこのアプリ、合成データの原本はシナリオが所有します。
- 商品価格と税額はサーバー側で検証・計算します。画面の値や Agent の回答を注文金額として信用しません。
- レビュー・好み・会話表示などのブラウザー保存を、本人認証付きの永続データとみなしません。
- 受注の外部同期は [services/order-sync/README.md](../../services/order-sync/README.md) の責務です。

## 移植範囲

既存の React と DOM コントローラーの共存を維持しています。親リポジトリへの依存と旧デモを読むデータ生成処理は除去済みです。画面・API の移植と UI 全面改修は同時に行っていません。

Node.js の起動要件は既存アプリの 22.12 以上を起点に固定します。Python と Agent Framework の版は既存の依存定義を引き継いで確認します。音声の任意プロバイダーが未設定でも、ローカル商品閲覧を妨げない構成にします。

EC のクラウド配備先は未確定です。現状のループバック待受をそのまま公開せず、HTTPS、顧客認証・認可、秘密情報、セッション寿命、ワーカー数の制限を確認してから決定します。

