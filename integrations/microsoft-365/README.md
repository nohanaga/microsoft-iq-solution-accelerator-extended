# Microsoft 365 連携

Work IQ の接続条件と、任意の Teams / Copilot Studio 連携を扱います。初期のローカル閲覧・EC・Fabric 業務画面に、Microsoft 365 の全サービスを必須とはしません。Work IQ の構築手順と原本は同梱済みで、実環境への掲載・接続は未実施です。

## Work IQ の導入範囲

元の WQ-001/002/003 をデモ専用 SharePoint に掲載・発行し、公開先・アクセス権・出典 ID を記録します。[Foundry/IQ 構築手順](../../infra/foundry/README.md) の第 2・4 節に、原本、Work IQ の利用条件、Entra 委任権限、OAuth 接続、同意、接続 ID の引渡しを記載しています。Blob の検索で Work IQ を代替しません。

公開前には、対象のテナント・ライセンス・API・同意・利用者権限で実際に参照できることを確認します。既存デモの台本に Work IQ が登場するだけで、実接続が完成しているとは判断しません。初回実演には専用の合成資料を使用し、実在の社員のメールや会議を収集して配布しません。

## 任意の拡張

Teams や Copilot Studio を利用する場合だけ、アプリ・ソリューション定義、接続参照、環境変数、インポート手順を追加します。ブラウザー専用の画面操作ツール、サーバー実行ツール、承認が必要な業務操作を分けます。

通知、発注、在庫更新、承認フローは、初期公開版の完成済み機能には含めません。

## 参考

- [Microsoft IQ Solution Accelerator](https://github.com/microsoft/microsoft-iq-solution-accelerator)