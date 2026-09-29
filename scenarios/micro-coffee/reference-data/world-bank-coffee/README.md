# 世界銀行のコーヒー価格

## サマリー

世界銀行の Commodity Price Data (Pink Sheet) から、2020 年 1 月～2025 年 12 月のアラビカ・ロブスタの月次名目価格を取得しました。2 系列 × 72 か月 = 144 件です。既存の店舗・顧客・受注は合成ですが、この参照データは公開統計です。世界銀行による本プロジェクトの承認・推奨を意味しません。

固定版: [202001-202512-9fdcfa8a2aed9a1b/provenance.json](202001-202512-9fdcfa8a2aed9a1b/provenance.json)。取得日時、公式ブックの URL、原本と採用ファイルの SHA256、変換内容、元データ提供者の記載を保存しています。採用値は [prices.json](202001-202512-9fdcfa8a2aed9a1b/prices.json)、列定義は [table-schema.json](202001-202512-9fdcfa8a2aed9a1b/table-schema.json) です。

## 意味と制約

| 項目 | 内容 |
| --- | --- |
| アラビカ | 元ブックでは ICO の Other Mild Arabicas 指標、New York と Bremen/Hamburg の平均・ex-dock |
| ロブスタ | 元ブックでは ICO の Robustas 指標、New York と Le Havre/Marseilles の平均・ex-dock |
| 単位 | 名目 USD/kg。JPY、円建て小売価格、特定店舗の仕入価格ではない |
| 日付 | 月をその月の 1 日として表記。日次観測を意味しない |
| 欠損 | 補間・推定・ゼロ埋めを行わない |
| 関係 | 架空の材料や仕入先との対応を推測して作らない |
| 改訂 | 配布元の過去値が更新される可能性があるため、再現には同梱版を使う |

分析例は「国際価格の上昇が続いた期間を確認し、供給シナリオで置いた原価の仮定が妥当か検討する」です。価格系列と架空の顧客の声を並べただけで因果関係を示したり、将来の需要・契約原価を予測したと説明したりしません。円換算には別途、同じ期間・用途に合う為替データが必要です。

## 利用条件と出典

公式カタログの当該データセットは Creative Commons Attribution 4.0 と記載されています。出典と変更内容の表示、世界銀行の追加条件、該当する第三者条件を維持してください。元ブックの提供者欄には Bloomberg、Complete Coffee Coverage、International Coffee Organization、Thomson Reuters Datastream、World Bank が記載されています。これらの提供者の別製品・有料データまで再利用できることを意味しません。

帰属表示: **The World Bank: Commodity Price Data (Pink Sheet).** この教材ではコーヒー 2 系列と期間を選択し、日付・列名を正規化しました。補間、通貨換算、架空取引との結合は行っていません。リポジトリのコードのライセンスとデータのライセンスは別です。

- 公式配布元: https://www.worldbank.org/en/research/commodity-markets
- 当該データセットとライセンス: https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections
- CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
- 世界銀行の追加条件・帰属表示: https://data.worldbank.org/summary-terms-of-use
- データアクセスとライセンス: https://datacatalog.worldbank.org/public-licenses#cc-by

取得処理は [scripts/import_public_prices.py](../../../../scripts/import_public_prices.py)、配置手順は [docs/data-foundation.md](../../../../docs/data-foundation.md) を参照してください。原本ブック全体は取得環境の Git 管理外に保存し、リポジトリには採用した固定値・列定義・出典記録を含めます。