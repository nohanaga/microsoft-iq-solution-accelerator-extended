# Azure 基盤

EC と同期処理が必要とする Azure 資源・認証の配置先です。[E2E 構築手順](../../docs/end-to-end-setup.md) と [PostgreSQL 構築手順](../../apps/storefront/postgres/README.md) に、資源作成・ネットワーク・Entra 認証・初期投入・EC / 同期の権限・接続を記載しています。Azure 全体を一括作成する Infrastructure as Code はありません。

## 管理対象

- PostgreSQL のサーバー、ネットワーク、暗号化接続、アプリ用と同期用の権限。
- EC が利用するモデルの接続先と、実際に作成されたモデルデプロイの参照。
- EC をクラウド公開する場合の Node.js と Python の実行環境、HTTPS、秘密情報の参照、監視。
- 配備者と実行主体を分けた権限、資源の所有情報、停止・削除方法。

初回移植の実行形態は既存のローカル BFF を維持します。クラウド公開先の選定は、会話ごとの Python 子プロセス、セッションのメモリー保持、スケールアウト時の継続性を確認した上で行います。静的ホスティングだけでは現在の EC は動作しません。

PostgreSQL の DDL は [apps/storefront/README.md](../../apps/storefront/README.md)、合成原本は [scenarios/micro-coffee/README.md](../../scenarios/micro-coffee/README.md) に属します。資源作成時に業務テーブルを暗黙に上書きしません。

既存環境のサブスクリプション、リージョン、管理者、ファイアウォール、モデル名は流用しません。最小権限の実行 ID を設計し、Managed Identity 対応は接続先・SDK ごとに確認します。EC の顧客認証と、Azure へのサービス認証は別の要件です。

Fabric の分析接続を PostgreSQL Mirroring と説明しません。既存の受注連携は outbox 同期であり、Mirroring の採用・構成はこの初期設計の対象外です。

