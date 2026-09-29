# Foundry と IQ 接続

Data Copilot の [Agent 定義ひな形](agent-definition.example.json)、元と同じ [業務指示](../../scenarios/micro-coffee/prompts/agent-instructions.txt)、規定 3 文書・会議 3 文書から、独立した新環境に接続する手順です。元ひな形の Work IQ・Foundry IQ と画面操作 6 ツールに、開発・供給の Fabric IQ 接続を追加しています。現行クラウド Agent の完全なエクスポートではありません。以下の作成・接続操作は今回実行していません。

モデルのデプロイ名、Agent 名、接続 ID、検索サービス、ナレッジベース名、指示本文を実値に置き換えます。使わない Work IQ / MCP ツールは除きます。ひな形の `require_approval: never` は許可済みの読取りツールに限定する前提であり、任意の外部送信や更新ツールへの適用を許可するものではありません。

元の IQ 検索用ひな形に、元の登録 Notebook `v3/data-copilot/add_tools_to_foundry_agent.ipynb` の 6 つの画面操作ツールを追加しています。Notebook は実行せず定義セルだけを参照し、説明を英語へ置き換えました。許可名・型・必須引数・列挙値を引き継ぎ、供給状態は現在の画面条件から選ぶ説明にしています。画面側の引数検証・実行処理は [copilot-ui-command.ts](../../apps/operations/src/copilot-ui-command.ts) と [copilot.ts](../../apps/operations/src/copilot.ts) です。新環境でのツール実行と既存クラウド版の全接続との一致は未確認です。

## 分離するもの

| 配置先 | 内容 |
| --- | --- |
| このディレクトリ | Agent 作成のひな形、ツール定義、接続作成、版固定、権限 |
| シナリオ | 業務用の指示、用語、根拠文書、出典 ID と有効期間 |
| 業務アプリ | Responses API の呼出し、会話、画面操作ツールの検証・実行 |
| EC アプリ | 別系統の Python Harness と音声クライアント |

EC と業務アプリの Agent を、一つの会話や実行主体へ統合しません。未設定の IQ 接続は無効として扱い、架空の検索結果で代替しません。

## 再現性の条件

業務アプリの Agent 名・版・エンドポイントは [.env.example](../../apps/operations/.env.example) で入力します。名前・エンドポイントの設定だけでは別環境に同じ Agent は作れません。既存クラウド版の指示・ツール・接続・モデルと同梱ひな形の完全一致は未確認です。

接続先の ID、認証、モデルデプロイは環境入力に分けます。検証済みの Agent 版を固定し、最新版への自動追従を公開時の既定にしません。

## 1. プロジェクト・モデル・権限

[E2E 構築手順](../../docs/end-to-end-setup.md) の Lakehouse、Semantic Model、2 つの Ontology の構築を先に完了します。Microsoft Foundry ポータルで新しいプロジェクトを作成し、実際のプロジェクトエンドポイントと ARM リソース ID を記録します。Hub ベースの旧プロジェクトとは区別します。[S1]

**Models / Deployments** で、ツール呼出しに対応する Agent 用モデルをデプロイします。利用可能なモデル・版・リージョン・割当量を確認し、作成したデプロイ名を使います。モデル ID や元環境の Agent version を新環境のデプロイ名として流用しません。Search 用には、ポータル対応の会話モデルと埋め込みモデルも用意します。モデル名・版・SKU は構築記録へ保存します。[S2]

| 主体 | 付与する権限 |
| --- | --- |
| Agent 作成者・利用者 | 対象 Foundry の Foundry User。プロジェクトと親リソースの必要スコープを公式資料に従って指定 |
| 接続作成者 | Foundry Project Manager |
| Search 構築者 | 対象 Search の Search Service Contributor、Search Index Data Contributor、Search Index Data Reader |
| Search のシステム割当 ID | 専用 Storage の Storage Blob Data Contributor、検索モデルを持つ Foundry の Cognitive Services User |
| Foundry プロジェクトのシステム割当 ID | 対象 Search の Search Index Data Reader |
| デモ利用者 | Fabric アイテム・データの閲覧権限、SharePoint の掲載資料を読む権限、Work IQ の利用条件 |

ロール付与には Owner / User Access Administrator などが必要です。通常利用者へこれらの管理権限を付与しません。Foundry ロールが旧名の Azure AI 系で表示される場合があります。Search はこのポータル手順では Basic 以上を選び、システム割当 ID と RBAC を有効化します。Storage はデモ専用の非公開コンテナーを使用します。[S1] [S2]

## 2. 元文書を掲載する

次の 6 ファイルだけを、経路を分けて掲載します。本文・文書 ID・版・業務日・案件 ID・金額を変更しません。

| 経路 | 原本 | 掲載先 |
| --- | --- | --- |
| Foundry IQ | [FQ-001](../../scenarios/micro-coffee/knowledge/foundry-iq/FQ-001-cost-policy-v1.md) | 専用 Blob コンテナー |
| Foundry IQ | [FQ-002](../../scenarios/micro-coffee/knowledge/foundry-iq/FQ-002-cost-policy-v2.md) | 同じ Blob コンテナー。旧版と別ファイル |
| Foundry IQ | [FQ-003](../../scenarios/micro-coffee/knowledge/foundry-iq/FQ-003-reproposal-manual.md) | 同じ Blob コンテナー |
| Work IQ | [WQ-001](../../scenarios/micro-coffee/knowledge/work-iq/WQ-001-blend-rejection.md) | デモ専用 SharePoint ページ |
| Work IQ | [WQ-002](../../scenarios/micro-coffee/knowledge/work-iq/WQ-002-blend-reconsideration.md) | 別の SharePoint ページ |
| Work IQ | [WQ-003](../../scenarios/micro-coffee/knowledge/work-iq/WQ-003-other-product.md) | 別の SharePoint ページ |

Blob は UTF-8 の原ファイルをそのままアップロードします。SharePoint は文書 ID と原タイトルを持つ 3 ページを作り、原稿全文を掲載して**発行**します。表・決定内容・合成資料の表示を省きません。実際の掲載日時を記録し、過去の会議日を SharePoint の作成日に偽装しません。掲載 URL、アイテム ID、閲覧者を Git 管理外の構築記録に保存します。

WQ を Blob に複製して Work IQ の代わりに検索しないでください。台本・期待回答・画面入力例・Agent 指示を検索索引へ入れません。デモ利用者で SharePoint 原文を開けることと、Microsoft 365 検索に掲載資料が反映されたことを確認してから先へ進みます。ローカル Markdown があるだけでは Work IQ は検索できません。[S3]

## 3. Foundry IQ の検索を作る

1. Azure ポータルで対象 Search を開き、**Agentic retrieval → Knowledge sources → Add knowledge source → Azure blob (Indexed)** を選びます。
2. `maikuro-policy-source` などの名前を指定し、前節の専用 Storage / コンテナーを選びます。**Authenticate using managed identity / System-assigned** を指定します。
3. **Enable text vectorization → Add vectorizer** で Foundry プロジェクトと埋め込みモデルのデプロイを選び、System-assigned identity で保存します。生成資産の保存先も専用ストレージにします。
4. 作成後、**Search management** で indexer の成功、対象 data source、index、skillset を確認します。分割後のレコード数は 3 と一致するとは限りません。FQ-001/002/003 の本文が検索できることを確認します。
5. **Agentic retrieval → Knowledge bases → Add knowledge base** で `maikuro-policies` を作ります。Chat completion model に準備した対応モデル、認証に System-assigned identity、Knowledge sources に前項のソースを指定します。原文確認用には Extractive data、要約を使う場合も引用を確認します。
6. プレイグラウンドで、2026-06-18 の 550 円、2026-07-08 の限定候補 650 円・通常候補 550 円、再提案手順がそれぞれ対応する原文から取得できるか確認します。[S2]
7. Foundry プロジェクトの **Build → Knowledge** から、作成済みの Search / ナレッジベースを接続します。別の空のナレッジベースを作成しません。

接続の種類は `RemoteTool`、認証は `ProjectManagedIdentity`、audience は `https://search.azure.com/`、接続先は次です。接続名を記録します。ポータルで作成できない場合は S1 の **Create a project connection** にある ARM PUT の手順を使います。送信先の `project_resource_id` は新環境の ARM ID です。

```text
https://<search>.search.windows.net/knowledgebases/<knowledge-base>/mcp?api-version=2026-08-01-preview
```

この 3 文書は全デモ利用者に開示可能な共通資料です。Blob が非公開でも、プロジェクト ID で検索する索引に利用者別の文書認可が自動付与されるわけではありません。実社内資料に置き換える場合は ACL と利用者文脈を別途構成します。[S1]

## 4. Work IQ 接続を作る

既存の適切な接続がある場合は再利用できます。初回はテナント管理者が Work IQ サービスプリンシパルの準備、Copilot Credits の従量課金有効化、委任権限への管理者同意を完了します。通常の実演者に Global Administrator は不要です。[S3] [S4]

1. Entra に専用の単一テナントアプリを登録し、**Work IQ → Delegated permissions → WorkIQAgent.Ask** を追加して管理者同意を行います。アプリケーション権限のみでは代替できません。
2. Foundry の **Settings → Connections → New connection → Work IQ** で新しい接続を作ります。クライアント ID と期限付きシークレットは担当者が直接入力します。シークレットをリポジトリ・台帳・チャットへ書きません。
3. 以下の URL とスコープを設定し、保存後に Foundry が表示する OAuth リダイレクト URL を、その Entra アプリの **Web** リダイレクト URI へそのまま登録します。
4. デモ利用者で下流の認証・同意を完了し、Work IQ 接続の完全な ARM リソース ID を記録します。

| 項目 | 値 |
| --- | --- |
| Authorization URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/authorize` |
| Token / Refresh URL | `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token` |
| Scopes | `api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask,offline_access` |
| A2A 接続先 | `https://workiq.svc.cloud.microsoft/a2a/` |

本構成は元と同じ Prompt Agent の `work_iq_preview` 直接ツールです。現行資料の Toolbox 経路へ変更することもできますが、既定の再現では経路を混在させません。利用者の委任認証を、Search 用の Managed Identity に置き換えないでください。[S3]

## 5. 開発・供給の Fabric IQ を接続する

画面の Graph/GQL 接続とは別の Foundry 側接続です。配備結果から **Ontology の ID** を取得します。GraphModel の ID をここへ入れないでください。

```text
https://api.fabric.microsoft.com/v1/mcp/dataPlane/workspaces/<workspace-id>/items/<ontology-id>/ontologyEndpoint
```

開発・供給それぞれのエンドポイントを記録します。Foundry の **Settings → Connections → New connection → Fabric IQ** または Agent の **Tools → Add → Fabric IQ (OneLake Catalog)** から、作成した Ontology を選びます。Managed OAuth が選べる環境では利用者認証を完了します。BYO Entra を使う場合は次の手順です。[S5]

1. 専用の単一テナント Entra アプリを登録します。**Power BI Service** の委任権限 `Item.Execute.All` と `Item.Read.All` を追加し、管理者同意を行います。
2. Foundry 接続へクライアント ID、テナント別 Authorization / Token / Refresh URL、期限付きシークレットを直接入力します。
3. 接続の scopes を `https://analysis.windows.net/powerbi/api/Item.Execute.All,https://analysis.windows.net/powerbi/api/Item.Read.All,offline_access` とします。
4. 保存後に表示されたリダイレクト URI を Entra アプリの **Web** に登録します。デモ利用者で認証を完了し、両接続の完全な ARM リソース ID を記録します。

画面側の Graph は `https://api.fabric.microsoft.com/Item.Read.All`、Foundry の Ontology 接続は上記 Power BI audience です。名前の似たスコープを混同しません。Fabric IQ は接続 ID の利用者に対する Fabric 権限も必要です。

## 6. Agent 作成要求を生成する

[config/foundry.example.json](../../config/foundry.example.json) を基に、Git 管理外の `config/environments/foundry.json` を作ります。Agent 名、モデルのデプロイ名、プロジェクトエンドポイント、Work IQ 接続、Search MCP URL / 接続名、開発・供給の Ontology MCP URL / 接続 ARM ID を埋めます。秘密値を記入する項目はありません。

accelerator ルートで次を実行します。これはクラウドに接続せず、元指示本文と 10 ツールを持つ JSON を生成します。

```powershell
python scripts/prepare_application.py --foundry-config config/environments/foundry.json --output artifacts/foundry-demo
```

出力は `agent-request.json` と `manifest.json` です。6 個の画面操作 function、Work IQ、2 個の Fabric IQ、Foundry IQ が含まれます。出力先が既存なら上書きせず停止します。元の指示全文は JSON 文字列として読み込まれるため、ファイルパスだけを Agent の instructions に設定する必要はありません。

## 7. 新しい Agent を作成する

生成した本文と送信先を確認し、**新規 Agent の作成を承認した後だけ**実行します。PowerShell 7 の例です。対象テナントで Azure CLI にサインイン済みとします。トークンを表示・保存しません。[S1]

```powershell
$manifest = Get-Content -Raw artifacts/foundry-demo/manifest.json | ConvertFrom-Json
$request = Get-Content -Raw -Encoding utf8 artifacts/foundry-demo/agent-request.json
$token = az account get-access-token --scope https://ai.azure.com/.default --query accessToken -o tsv
if ($LASTEXITCODE -ne 0 -or -not $token) { throw 'Foundry authentication failed' }
$headers = @{ Authorization = "Bearer $token" }
try {
	$created = Invoke-RestMethod -Method Post -Uri $manifest.createUrl -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($request))
} finally {
	$headers.Clear()
	$token = $null
}
```

ポータルの **Agents** で作成された名前・版・モデル・全ツールを確認します。同名競合や結果不明では再送せず、既存 Agent を確認してください。本例は既存 Agent を上書きするための操作ではありません。新環境の版を記録し、元環境の `26` などの版番号を流用しません。

画面操作 function の実行担当は業務アプリです。Foundry プレイグラウンドや Teams から画面操作を要求しても React 側の実行担当はいません。文書検索はプレイグラウンド、画面操作を含む台本は業務アプリで実施します。

## 8. 業務アプリへ接続する

業務アプリの `.env` に `VITE_FOUNDRY_PROJECT_ENDPOINT`、`VITE_FOUNDRY_AGENT_NAME`、作成済みの `VITE_FOUNDRY_AGENT_VERSION` を設定します。Graph と共用する SPA 登録に `https://ai.azure.com/user_impersonation` の利用者委任権限を設定し、必要な同意を行います。公開ブラウザーにはクライアントシークレットを持たせません。

本ひな形の Fabric IQ は `require_approval=always` です。現在のアプリは `VITE_FOUNDRY_AUTO_APPROVE_MCP=true` のときに MCP 承認要求へ自動応答します。**この Agent の全接続が、承認済みデモデータに対する信頼済みの読取りツールだけであることを確認してから**有効にしてください。false のままでは承認が必要な照会を完了できません。自動承認はこの 2 接続だけに限定する機構ではないため、書込み・外部送信ツールを追加した Agent へ流用しません。

環境値を反映するため Rayfin の静的画面を再配備し、Fabric ポータル内で業務アプリを開きます。Fabric と同じ利用者で Foundry にサインインし、[デモ台本](../../scenarios/micro-coffee/demo/README.md) の IQ 場面へ進みます。WQ-001 の見送り理由、FQ-002 の変更後の条件、画面の在庫を区別して回答できることを確認します。回答に製品名が出るだけでは照会成功とは判定せず、ツール実行と原文引用を確認します。

## 9. 停止・再開

文書が見つからない場合は、SharePoint の発行・閲覧権限・検索反映、Blob indexer の成功、接続先 ID、利用者認証を順に確認します。認証エラーを Managed Identity への置換や架空の引用で回避しません。モデルや Agent の版を変更したら `.env` の版を更新して画面を再配備します。

終了時は作成記録を基に、不要な専用 Agent・接続・Search の knowledge base / source / index / indexer / skillset、Blob、SharePoint ページを整理します。共有資源は削除しません。Agent の削除だけでは Storage や Search の課金は停止しません。実データと同じ本文を維持しても、LLM の回答文字列まで決定的になるわけではありません。

## 公式資料

参照日: 2026-09-28。ポータルの表示差がある場合は、同じ資源・認証方式・入力値になることを以下で確認します。

- S1: https://learn.microsoft.com/azure/foundry/agents/how-to/foundry-iq-connect
- S2: https://learn.microsoft.com/azure/search/get-started-portal-agentic-retrieval
- S3: https://learn.microsoft.com/azure/foundry/agents/how-to/tools/work-iq
- S4: https://learn.microsoft.com/microsoft-365/copilot/extensibility/work-iq-api-quickstart?tabs=entra-admin
- S5: https://learn.microsoft.com/azure/foundry/agents/how-to/tools/fabric-iq

[S1]: https://learn.microsoft.com/azure/foundry/agents/how-to/foundry-iq-connect
[S2]: https://learn.microsoft.com/azure/search/get-started-portal-agentic-retrieval
[S3]: https://learn.microsoft.com/azure/foundry/agents/how-to/tools/work-iq
[S4]: https://learn.microsoft.com/microsoft-365/copilot/extensibility/work-iq-api-quickstart?tabs=entra-admin
[S5]: https://learn.microsoft.com/azure/foundry/agents/how-to/tools/fabric-iq

## 検索と操作

Fabric IQ には構造化された業務データ、Foundry IQ には規則やマニュアル、Work IQ には権限のある業務文脈を問い合わせます。各経路の認証方式と対応機能は個別に確認します。全経路を Managed Identity 一つで利用できるとは仮定しません。

検索索引に台本、期待回答、Agent 指示、画面条件の例を混入させません。古い文書と現在有効な文書を出典・版・有効期間で識別します。画面から渡した数値と検索結果を区別し、どちらが回答の根拠かを記録します。

業務画面で実行するツールを、Teams など実行担当のいないクライアントへそのまま公開しません。MCP の承認方針は、読み取り・書き込み・外部送信ごとに設計します。


## 参考

- [Microsoft IQ Solution Accelerator](https://github.com/microsoft/microsoft-iq-solution-accelerator)