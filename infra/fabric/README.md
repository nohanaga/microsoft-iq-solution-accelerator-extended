# Fabric 基盤

業務アプリが参照する分析・意味定義・任意の予測基盤を扱います。Lakehouse / OneLake / Delta と generation 1 Ontology / Graph の定義生成・新規配備は [scripts/deploy.py](../../scripts/deploy.py) に実装済みです。固定の環境 ID を持つ配備定義は置かず、シナリオと承認済みの環境入力から生成します。新しいコードでの実配備は未確認です。

データ準備・配備・再開は [データ基盤手順書](../../docs/data-foundation.md)、Semantic Model のポータル作成・権限・更新・アプリ接続は [E2E 構築手順](../../docs/end-to-end-setup.md) を参照してください。RTI の元 KQL を同梱し、同手順で Eventhouse を構築できます。予測表示には `prepare --include-predictions` で元の gold 3 テーブルを投入します。元 ML 入力も同梱していますが、再学習・モデル登録・オンライン推論の自動配備は含めません。

## 配置対象

| 領域 | 配置するもの |
| --- | --- |
| Lakehouse | テーブル定義、原本からの投入・変換、スキーマ対応 |
| Semantic Model | 同じテーブル・列を選ぶポータル構築、DAX の参照対象、権限、更新手順 |
| Ontology / GraphModel | ネイティブ定義、データバインディング、関係、更新手順 |
| RTI | 任意の Eventstream、Eventhouse、KQL、合成イベント生成 |
| ML | 元の予測スナップショット・入力履歴、推論結果 3 テーブルと画面の対応。再学習は対象外 |

Rayfin 管理 SQL のエンティティと静的ホスティング設定は、[apps/operations/README.md](../../apps/operations/README.md) に残します。同じ資源を複数の配備処理が管理しないよう、アイテムごとに所有する定義を一つにします。

## 導入条件

セマンティック モデル接続については、公式資料に次の前提があります。

- Fabric Apps ワークロードのテナントでの有効化。
- Semantic Model Execute Queries REST API のテナント設定。
- 対象モデルの Build / Read 権限と、Fabric または Power BI 容量上のモデル。
- アプリ作成に必要なワークスペース権限。

2026-09-28 に参照した公式資料では、セマンティック モデルに接続する Fabric Apps は、Fabric ポータル外の独立したブラウザーウィンドウで開くとクエリエラーになる制限があります。EC の公開 URL と同じ利用条件にはしません。

出典: https://learn.microsoft.com/en-us/fabric/apps/data-apps-template

Fabric iframe 内の SSO は親フレームとの `postMessage` を利用します。Graph や Foundry の利用者委任認証は、別途アプリ登録・API 権限を管理します。Rayfin のセッションを他サービスのアクセストークンとして使いません。

出典: https://learn.microsoft.com/en-us/fabric/apps/fabric-authentication

## 更新と障害

データ投入、モデル定義の適用、分析モデルの更新、グラフの更新、読み戻しを別の段階として記録します。アイテム作成成功だけで照会可能になったとは判断しません。配備先 ID と長時間処理の状態を、公開しない環境別出力へ保存します。

RTI の合成送信と実 SNS 収集、ML の合成履歴に対する評価と実需要への精度保証は区別します。基本デモが、任意の ML 学習・オンライン推論・イベント送信の費用を発生させない構成にします。

