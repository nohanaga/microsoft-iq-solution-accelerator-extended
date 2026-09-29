# PostgreSQL の構築・初期投入・権限

## サマリー

元 EC と同じ [001-schema.sql](001-schema.sql)、[002-seed.sql](002-seed.sql)、[商品原本](../data/catalogue.json) を使います。商品 18 件、店舗 6 件、供給会社 5 件を初期投入し、EC で作成した注文を outbox 経由で Rayfin へ渡します。分析用の過去 33 注文は Lakehouse の原本にある別データです。これを新規 EC 注文として PostgreSQL に挿入しません。

全体の実行順は [E2E 構築手順](../../../docs/end-to-end-setup.md) を参照してください。以下は利用者が後で実行する構築手順であり、この移植作業ではクラウド資源を作成していません。

## 1. サーバーと DB を作る

1. Azure ポータルで、専用リソースグループに **Azure Database for PostgreSQL Flexible Server** を作成します。サブスクリプション、リージョン、サーバー名を記録します。元デモの PostgreSQL は 17 です。同じメジャー版が対象リージョンで選べることを確認してください。
2. デモ用のサイズを選び、料金とバックアップ保持期間を確認します。元デモの小規模構成は Burstable / B1ms / 32 GiB でしたが、リージョンの提供状況に応じて選択します。Fabric Mirroring は本手順では使用しません。
3. **認証**で Microsoft Entra 認証のみを選び、構築担当者を Entra 管理者へ登録します。サーバー作成だけで一般利用者の DB ロールが自動作成されるわけではありません。
4. ネットワークは構築 PC と EC 実行 PC が到達できる方式を選びます。公開アクセスを使うデモでは、その PC の送信元 IPv4 だけをファイアウォールに登録します。全 IPv4 許可は使用しません。閉域の場合は VPN・DNS・経路を先に構成します。
5. サーバーの **データベース**から空の `maikuro_demo` を作成します。FQDN、DB 名、テナント ID を記録します。TLS 証明書とホスト名の検証を無効化しません。

公式の作成手順: https://learn.microsoft.com/azure/postgresql/get-started/quickstart-create-server-portal

Entra 管理者・接続: https://learn.microsoft.com/azure/postgresql/security/security-entra-configure

TLS: https://learn.microsoft.com/azure/postgresql/security/security-tls

## 2. 元のマスターを初期投入する

accelerator ルートで、構築担当者としてサインインして実行します。Python 3.12 と Azure CLI が必要です。山括弧の値は新環境の値に置き換えます。

```powershell
python -m venv apps/storefront/postgres/.venv
apps/storefront/postgres/.venv/Scripts/python.exe -m pip install -r apps/storefront/postgres/requirements.txt
az login --tenant '<tenant-id>'
apps/storefront/postgres/.venv/Scripts/python.exe apps/storefront/postgres/seed-azure.py --tenant-id '<tenant-id>' --subscription-id '<subscription-id>' --resource-group '<resource-group>' --server-name '<server-name>' --database maikuro_demo --confirm-synthetic
```

[seed-azure.py](seed-azure.py) は Azure CLI のサインイン利用者で接続し、対象サーバー・テナントを照合してから DDL と seed を実行します。商品・店舗・供給会社・商品と供給会社の対応を原本と読み戻し照合し、結果を `artifacts/commerce/deployment.json` に保存します。接続は `sslmode=verify-full` です。トークンを引数やファイルへ保存しません。

seed は空のマスターテーブル専用です。投入済みなら再投入せず、同じ引数の `--confirm-synthetic` を `--read-only` に替えて既存データを確認できます。既存環境のデータ削除や初期化はこの手順に含みません。商品値を変えない再現では `prepare-commerce.ts` による再生成も不要です。

## 3. アプリと同期の DB ロールを作る

VS Code の PostgreSQL 拡張など Entra 認証対応クライアントから、Entra 管理者で `postgres` DB に接続します。対象テナントに存在する EC 実行者と同期担当者を登録します。次はユーザー UPN の例で、架空のユーザーを新規作成する操作ではありません。同じ利用者を両用途に使うデモではロール登録を一度だけ行います。

```sql
SELECT * FROM pgaadauth_create_principal('<ec-runner-upn>', false, false);
SELECT * FROM pgaadauth_create_principal('<sync-runner-upn>', false, false);
```

次に `maikuro_demo` DB へ接続し、初期構築時に一度だけ以下を実行します。引用符内の UPN を実際のロール名へ置き換えます。DB 名を変更した場合は `GRANT CONNECT` の対象も変更します。

```sql
CREATE ROLE maikuro_ec_runtime NOLOGIN;
CREATE ROLE maikuro_order_sync NOLOGIN;
GRANT CONNECT ON DATABASE maikuro_demo TO maikuro_ec_runtime, maikuro_order_sync;
GRANT USAGE ON SCHEMA maikuro TO maikuro_ec_runtime, maikuro_order_sync;

GRANT SELECT ON maikuro.products, maikuro.stores, maikuro.suppliers,
    maikuro.ec_catalogue TO maikuro_ec_runtime;
GRANT SELECT, INSERT ON maikuro.orders, maikuro.order_lines,
    maikuro.rayfin_outbox TO maikuro_ec_runtime;
GRANT UPDATE (status, received_at) ON maikuro.orders TO maikuro_ec_runtime;

GRANT SELECT ON maikuro.products, maikuro.stores, maikuro.suppliers,
    maikuro.orders, maikuro.order_lines, maikuro.rayfin_outbox TO maikuro_order_sync;
GRANT UPDATE (published_at, attempts, last_error)
    ON maikuro.rayfin_outbox TO maikuro_order_sync;

GRANT maikuro_ec_runtime TO "<ec-runner-upn>";
GRANT maikuro_order_sync TO "<sync-runner-upn>";
```

通常運用の EC と同期処理に、管理者・テーブル所有者・DDL・DELETE 権限は不要です。このロール分離はテーブルへのアクセスを制御するもので、元のデモ API に顧客ごとの認証・所有者認可を追加するものではありません。顧客向けインターネット公開は別途設計してください。

Managed Identity で動かす場合も、その ID に対応する PostgreSQL ロールを作成し、`maikuro_ec_runtime` を付与します。本リポジトリの同期スクリプトは Azure CLI 認証なので、EC の `managed_identity` 設定が同期処理へ引き継がれるわけではありません。

DB ロール管理の根拠: https://learn.microsoft.com/azure/postgresql/security/security-manage-entra-users

## 4. EC を接続する

[.env.example](../.env.example) を基に、EC の `.env` へ次を設定します。EC プロセスを起動する前に、上で登録した実行者として対象テナントへ Azure CLI でサインインします。`PGUSER` とトークンの利用者を一致させます。

```dotenv
PGHOST=<server-name>.postgres.database.azure.com
PGPORT=5432
PGDATABASE=maikuro_demo
PGUSER=<ec-runner-upn>
PG_AUTH_MODE=azure_cli
PG_TENANT_ID=<tenant-id>
```

`PG_SSL_CA_FILE` は組織の接続環境で必要な場合に信頼する CA バンドルのローカルパスを指定します。証明書検証を回避する設定ではありません。パスワードを `.env` へ追加しないでください。

ルートで `npm run dev:storefront` を実行し、起動ログの `/shop` を開きます。**データ設定 → PostgreSQL** を選び、商品 18 件・店舗 6 件を確認します。注文を作る操作は DB へ実際に書き込みます。デモ専用 DB でのみ行い、受注番号を記録してください。

## 5. 受注を Rayfin に同期する

Rayfin のスキーマ適用と SQL 初期投入を先に終え、[受注同期手順](../../../services/order-sync/README.md) へ進みます。同期専用利用者を使う場合は、Git 管理外の `config/environments/order-sync.env` に同じ PG 接続情報と同期担当者の `PGUSER` を記載し、`--postgres-env` で指定します。

分析原本の注文 33 件、配分シナリオの注文、EC で新規作成した注文は別の集合です。元データに合わせるために、いずれかを他の集合へ混ぜたり ID を振り直したりしません。