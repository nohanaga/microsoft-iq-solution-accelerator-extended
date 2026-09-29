# 受注同期

PostgreSQL の outbox から Rayfin 管理 SQL へ、受注・明細・必要な商品・ゲスト顧客を一方向に反映する [sync.py](sync.py) を移植済みです。親ヘルパー、固定ワークスペース ID、固定 SQL Database ID は使用しません。常駐・定期実行の仕組みは含みません。

## 実行

Python 3.12、Microsoft ODBC Driver 18 for SQL Server、Azure CLI を用意します。対象テナントの同期担当者でサインインし、PostgreSQL と Fabric SQL の必要な参照・更新権限を付与してください。これは利用者のブラウザー SSO とは別の管理者処理です。

新環境の構築は [E2E 手順](../../docs/end-to-end-setup.md)、PostgreSQL の同期ロールは [DB 構築手順](../../apps/storefront/postgres/README.md)、Fabric SQL のユーザーと Ec 系 4 テーブルの権限は E2E 手順の第 7 節を使用します。EC と同期で利用者を分ける場合は、同期担当者の `PGUSER` を持つ設定ファイルを `--postgres-env` へ渡してください。

このディレクトリで専用環境を作成します。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe sync.py --tenant-id '<tenant-id>' --workspace-id '<workspace-id>' --sql-database-id '<sql-database-item-id>' --verify-only
```

接続元の既定設定は [EC のひな形](../../apps/storefront/.env.example) に対応する `apps/storefront/.env` です。`--postgres-env` で別のファイルを指定できます。`PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER` が必要です。同期処理の認証は指定テナントの Azure CLI です。API キーや DB パスワードは受け取りません。

書込みは同じ引数で `--verify-only` を `--apply` に置き換えて明示的に実行します。`--batch-size` の既定は 100、範囲は 1～1,000 です。結果は accelerator ルートの `artifacts/order-sync/` に保存します。今回、新環境への同期・照合は実行していません。

ODBC の導入: https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server

## 失敗時と再実行

宛先には `rayfin up` 済みの `EcOrders`、`EcOrderLines`、`EcProducts`、`EcCustomers` が必要です。Fabric API でワークスペースと SQL Database の ID を照合して接続し、列不足なら書込み前に停止します。TLS の証明書検証は無効化しません。

処理対象を PostgreSQL の `FOR UPDATE SKIP LOCKED` で確保し、SQL Database ID 由来の UUID と業務 ID で重複を防ぎます。宛先コミットの後に outbox の送信済み状態を確定します。その間で止まった場合は、接続障害を直して同じ宛先へ再実行します。異なる DB ID に変更しての再実行は復旧手順ではありません。

既存行の不一致や終端状態の競合は停止理由です。outbox の削除や `published_at` の手動設定で回避しません。失敗時はトランザクションを戻し、該当イベントの `attempts` と `last_error` を記録します。新環境での障害復旧動作は未確認です。

## 引き継ぐ境界

1. EC API が受注・明細・outbox を同じ PostgreSQL トランザクションで確定します。
2. 同期処理が未送信イベントを読み、既存行との整合を確認して Rayfin 管理 SQL に反映します。
3. 反映結果と送信状態を管理し、途中失敗から再実行できるようにします。

PostgreSQL と Rayfin 管理 SQL をまたぐ分散トランザクションや exactly-once 配信を保証しません。移植後の受入条件には、宛先確定後・送信済み記録前の停止、重複イベント、順序の逆転、終端状態の巻戻し防止を含めます。

## 配置と範囲

Python の同期処理、依存定義、設定読込をここにまとめています。既存の管理者実行スクリプトを維持し、新しいメッセージブローカーや CDC は追加していません。

ワークスペース ID、SQL Database ID、Azure CLI の絶対パス、EC ディレクトリの探索を実装に固定しません。配備対象を入力設定で指定し、想定と違う DB には書き込みません。同期専用の最小権限と、個人情報を含まない実行ログを用意します。

この処理だけでは Lakehouse、DAX の分析モデル、Graph、顧客の声、実在庫は更新されません。EC と分析側を自動的につなぐ閉ループは別の実装項目です。

