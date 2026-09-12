# 調査ノート03: AIエージェント主導の大規模開発 — 手法・スタック・計測（2025–2026）

調査日: 2026-09-10 ／ 調査者: Claude（リサーチ用サブエージェント）／ 統合: Claude（claude-fable-5-1）
凡例: 【確認済】一次情報・公式、【二次情報】ブログ・レポート、【推測】推論。

## 0. 要旨

- 2026年時点で「100万行規模をほぼ全てエージェントが書いた」事例は複数存在する（OpenAI Codexチーム、Cursor、Steve Yegge）。共通する成功要因は、**モデルの性能ではなく「ハーネス」（リポジトリ構造・機械的な制約・検証ループ・コンテキスト管理）の設計**である。
- 最大の制約はコンテキストウィンドウであり、失敗モードの大半（早期の「完了」宣言、一発で全部やろうとする、ドリフト、重複コード、自己評価バイアス）はそこから派生する。
- 言語別ベンチマークは結果がベンチマークごとに入れ替わり、言語選択の決定打にはならない。決め手は「コンパイラ/型/テストが数秒〜数分で返す高密度フィードバック」と「訓練データ量と規約の強さ」。
- 実験の指標としてLOCは弱い。受入テスト通過数、change failure rate、リワーク比率、人間レビュー時間、トークンコスト/マージ済み変更を組み合わせるのが2026年の標準的見解。

## 1. スケールするagentic codingのベストプラクティス

### 1.1 コンテキストが最重要制約
Claude Code公式ガイドは「ほとんどのベストプラクティスは一つの制約——コンテキストは急速に埋まり、埋まるほど性能が落ちる——に基づく」と明言し、`/clear`を無関係タスク間で頻用、調査はsubagentに隔離、同じ訂正を2回以上したら`/clear`して良いプロンプトで再開、を推奨【確認済】(https://code.claude.com/docs/en/best-practices)。Anthropicのcontext engineering記事は「context rot」を定義し、just-in-time retrieval・compaction・構造化ノート・sub-agentによる分離を長期タスクの基本技法として挙げる【確認済】(https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)。

### 1.2 CLAUDE.md / AGENTS.md の設計
- Claude Code公式：「短く、人間可読に」「各行について『これを消すとClaudeがミスするか？』と問い、Noなら削る」「肥大化したCLAUDE.mdは指示を無視させる」。含めるべきは推測不能なBashコマンド、デフォルトと異なるスタイル、テスト手順、リポジトリ作法、プロジェクト固有のアーキテクチャ決定。除くべきはコードから読めること、詳細API文書、ファイル単位の説明。時々しか要らない知識はskillsへ【確認済】(https://code.claude.com/docs/en/best-practices)。
- Boris Cherny（Claude Code責任者）のCLAUDE.mdは約2.5kトークン。ローカル5セッション＋リモート5〜10セッション並列、各セッションは独立git checkout、セッションの10〜20%は破棄【二次情報】(https://infoq.com/news/2026/01/claude-code-creator-workflow/)。
- OpenAI Codexチームの100万行プロジェクトでは「`AGENTS.md`は約100行で、主に地図として機能」し、知識本体は`docs/`ディレクトリをsystem of recordとして構造化。「巨大な指示ファイルはタスク・コード・関連docsを押し出し、エージェントが重要な制約を見落とすか誤った最適化を始める」【確認済】(https://openai.com/index/harness-engineering/)。
- AGENTS.mdはOpenAI Codex/Amp/Jules/Cursor/Factory発、現在Linux Foundation傘下のAgentic AI Foundationが管理。60k超のOSSが採用、monorepoではネストしたAGENTS.mdを「最も近いもの優先」で読む【確認済】(https://agents.md/)。

### 1.3 エージェントに優しいリポジトリ構造
- OpenAIチーム：「各ビジネスドメインを固定のレイヤに分割し、依存方向を厳密に検証」（Types → Config → Repo → Service → Runtime → UI、横断関心はProviders経由）。構造化ログ、命名規約、**ファイルサイズ上限**、信頼性要件をカスタムlintで静的に強制し、「lintがカスタムなので、エラーメッセージに修復手順を書いてエージェントのコンテキストに注入する」【確認済】(https://openai.com/index/harness-engineering/)。
- Factory.aiは「grep-ability / glob-ability / アーキテクチャ境界 / セキュリティ / テスト容易性 / 可観測性 / ドキュメント」の7分類でエージェント向けlintを提案し、「エージェントはlintルールに従うことで自己修復する」と主張【二次情報】(https://factory.ai/news/using-linters-to-direct-agents)。
- monorepo.toolsは、project graph・affected実行・境界lint・タグ付けが「ファイルを1つも読まずにアーキテクチャを理解」させる点でmonorepoがエージェントに向くと主張【二次情報】(https://monorepo.tools/ai)。

### 1.4 Spec-driven development（SDD）
- GitHub Spec Kit：constitution → specify → plan → tasks → implement → converge の段階を30以上のエージェントで実行。greenfieldに強く、要件が深く不確実な探索的作業には不向き【確認済】(https://github.com/github/spec-kit)。
- Kiro：`requirements.md`（EARS記法「WHEN … THE SYSTEM SHALL …」で受入基準をテストに直訳可能に）、`design.md`、`tasks.md`の3ファイル。独立タスクを並列「wave」で実行【確認済】(https://kiro.dev/docs/specs/feature-specs/, https://kiro.dev/docs/specs/)。
- 批判的評価（Thoughtworks Böckeler, martinfowler.com）：Kiroは小タスクを過剰にユーザーストーリー化、Spec Kitは大量のmarkdownでレビューが苦痛。「大きなコンテキストにもかかわらずエージェントはしばしば指示を無視し、重複を作り、仕様を過剰解釈した」。spec-anchored / spec-as-sourceは実績なく、MDD（モデル駆動開発）の失敗の再来を警告【二次情報】(https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)。
- Claude Code公式は軽量版として「AskUserQuestionでインタビューさせてSPEC.mdを書かせ、**新しいセッション**で実装」を推奨。良いspecは「関係ファイルとインターフェースを名指しし、スコープ外を明記し、end-to-end検証手順で終わる」【確認済】(https://code.claude.com/docs/en/best-practices)。

### 1.5 検証ループ（test-first）
- Claude Code公式：「Claudeは『完了に見えた』時点で止まる。pass/failを返すチェックを与えれば、ループは自動で閉じる」。Stop hook（決定論的ゲート、8回連続ブロックで打ち切り）、`/goal`、fresh contextのレビューsubagent（「作った側が採点しない」）の3段階【確認済】(https://code.claude.com/docs/en/best-practices)。
- Chernyは検証ループで結果が「2〜3倍」改善すると述べる【二次情報】(https://infoq.com/news/2026/01/claude-code-creator-workflow/)。
- 「AIは生成を速くしたが検証は速くしなかった」——型システム＞テスト＞linter/pre-commitの順にフィードバックの強度を評価し、変更→フィードバックを5分以内に、人間レビューを最後に置く【二次情報】(https://siddhantkhare.com/writing/why-your-ai-agent-keeps-failing)。

### 1.6 並列化
- Claude Code公式：worktree（`--worktree`）でセッション隔離、Writer/Reviewer分離、`/batch`で5〜30 subagentへファンアウト、agent teamsは実験的で「3〜5人から始める」「同一ファイルを2人が編集すると上書きが起きる」「トークンは線形に増える」【確認済】(https://code.claude.com/docs/en/worktrees, https://code.claude.com/docs/en/agent-teams)。
- Cursor：フラット構造ではロック競合で「20エージェントが実効2〜3エージェントに落ちた」。Planner / Worker / Judgeの階層で解決。「ハーネスとモデルも重要だがプロンプトがより重要」「最良のシステムは思ったより単純」【確認済】(https://cursor.com/blog/scaling-agents)。
- Anthropic harness研究：failure modeは「一発でアプリ全部を作ろうとする」と「後続のエージェントが進捗を見て完了と宣言する」。対策はInitializer/Coding agent分離、JSONのfeature list（「テストの削除・編集は許されない」）、progress file、1回1機能、git commit【確認済】(https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)。続報では Planner/Generator/Evaluator の3役で「自己評価バイアス（平凡でも自信満々に称賛）」を分離、Playwrightで実アプリを操作して採点。コストは単独$9/20分に対しハーネス$200/6時間【確認済】(https://www.anthropic.com/engineering/harness-design-long-running-apps)。

### 1.7 既知の失敗モード（まとめ）
| 失敗モード | 根拠 |
|---|---|
| 早期完了宣言・自己採点バイアス | Anthropic harness記事【確認済】 |
| 不完全リファクタ（周辺の呼出し・設定・fixtureまで伝播しない）と「読んで→編集→失敗→戻す」の無生産ループ | SWE-Bench ProMax【確認済】(https://arxiv.org/html/2608.09802v1) |
| 既存パターンの複製によるドリフト（「Codexは不揃いなパターンも複製する」） | OpenAI【確認済】 |
| 重複コード増加：コピペ行 8.3%→12.3%（2021→24）、リファクタ行 25%→10%未満 | GitClear【二次情報】(https://www.gitclear.com/ai_assistant_code_quality_2025_research) |
| パッケージ幻覚：商用モデル5.2%、OSSモデル21.7%（USENIX Security 2025） | 【確認済】(https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen) |
| 型不整合エラーはフィードバック後の修正率が低い（7.8%） | 【確認済】(https://arxiv.org/html/2608.00661) |
| 仕様無視・重複作成・過剰解釈 | Böckeler【二次情報】 |
| 「polite」すぎて作業再開しない、セッション終了で文脈喪失 | Yegge【二次情報】(https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) |

## 2. ケーススタディとメトリクス

- **OpenAI Codexチーム**：5か月で約100万行、3→7人、約1,500 PR、1人1日3.5 PR、「手書きの1/10の時間」。人間のPRレビューは任意で、ほぼagent-to-agentレビューに移行。Chrome DevTools Protocolとローカル可観測性スタックをエージェントに開放。エントロピー対策として定期的な「garbage collection」タスク。「数年単位でアーキテクチャの一貫性がどう進化するかはまだ分からない」【確認済】(https://openai.com/index/harness-engineering/)。
- **Cursor FastRender**：数百エージェント、約1週間、100万行超/1,000ファイル、数兆トークン。Simon Willisonが実ビルドし「動くが、タブ名の文字化け・スタイル欠落・背景画像の誤描画」と評価【確認済/二次情報】(https://cursor.com/blog/scaling-agents, https://simonwillison.net/2026/jan/19/scaling-long-running-autonomous-coding/)。
- **Yegge Gas Town**：Goで75,000行/17日/2,000コミット、通常12〜30エージェント。「バグを2〜3回直すことがある」「expensive as hell」【二次情報】(https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04)。
- **Anthropic社内**：会社全体で70〜90%、Claude Code自体は約90%がClaude生成（広報コメント）【二次情報】(https://fortune.com/2026/01/29/100-percent-of-code-at-anthropic-and-openai-is-now-ai-written-boris-cherny-roon/)。
- **生存分析**（201リポ、5,171 PR、21万行）：AI生成行の変更ハザード比0.842（人間より15.8%残存しやすい）が、Devinのような自律型は人間並み。「ボトルネックは生成品質でなく、長期進化を統治する組織的プラクティス」【確認済】(https://arxiv.org/html/2601.16809v1)。
- **DORA 2025**：AI採用はスループットと正の関係に転じたが、**安定性とは依然負の関係**。「AIは増幅器」【確認済】(https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)。
- **DX Q2 2026**：AI生成コード52.7%、PRスループット+37%、保守性+3.8%、change confidence −6.1%【二次情報】(https://getdx.com/news/dx-releases-q2-2026-state-of-ai-impact-in-engineering-report/)。
- **METR**：2025年初頭ツールで経験者は19%遅く、本人は20%速いと認識【確認済】(https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)。2026年更新では−4%〜−18%だが、強い選択バイアスで「真の効果はもっと高い可能性」【確認済】(https://metr.org/blog/2026-02-24-uplift-update/)。

## 3. 技術スタック適性：言語

### 3.1 ベンチマーク
| ベンチマーク | 結果 |
|---|---|
| SWE-bench Multilingual（300題、Claude 3.7 + SWE-agent） | Rust 58%、Java 53%、PHP 49%、Ruby 43%、JS/TS 35%、Go 31%、C/C++ 29%【確認済】(https://www.swebench.com/multilingual.html) |
| Multi-SWE-bench（ByteDance, NeurIPS 2025） | Javaが非Python中最良、TS/JSが最低。理由は「イベント駆動・非同期パラダイム」と訓練データ偏り【確認済】(https://arxiv.org/html/2504.02605v1) |
| SWE-PolyBench（Amazon、2026年上位） | Python 55–62%、TS 43–53%、Java 43–46%、JS 43–50%【確認済】(https://amazon-science.github.io/SWE-PolyBench/) |
| SWE-Bench ProMax（大規模多言語リファクタ、2026） | Rust 63.6%、TS 53.6%、Python 48.3%、Go 43.5%、Java 34.6%。最良モデルでも41.2%【確認済】(https://arxiv.org/html/2608.09802v1) |
| Aider polyglot | 言語別内訳は公開されない【確認済】(https://aider.chat/2024/12/21/polyglot.html) |

【推測】順位がベンチマーク間で入れ替わる（Javaが1位にも最下位にもなる）ため、**言語別の数ポイント差を根拠に言語を選ぶべきではない**。C#/Kotlinは主要ベンチマークに含まれず、証拠が薄い。

### 3.2 型・コンパイラ・規約
- InfoQは「LLMのコンパイルエラーの94%が型チェック失敗」という2025年研究を引き、Hejlsbergの「AIがある言語を書ける能力は、その言語をどれだけ見たかに比例する」を紹介。TypeScriptはGitHubで前年比+66%で首位【二次情報】(https://infoq.com/news/2026/03/ai-reshapes-language-choice/)。
- コインブラ大の86,726エラー分析：型不整合の修正率はimport漏れより顕著に低く、「反復プロンプトだけでは解決しない推論の限界」【確認済】(https://arxiv.org/html/2608.00661)。→ 型エラーを**早く・大量に**返す環境が重要。
- TypeScript 7.0（2026-07-08 GA、Go実装）：型チェック8.7〜11.9倍、`--checkers 8`で最大16.7倍、`strict`デフォルト【確認済】(https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)。
- Encore：「規約が強いフレームワークほどAIの出力が安定」（NestJS/Rails/Django/Laravelは規約で高評価、Expressは規約ゼロで最低）【二次情報・自社製品推し】(https://encore.dev/articles/best-frameworks-ai-assisted-development)。
- AppSignalの同一アプリ生成実験：Django 31kトークン/0反復、Rails 61k、Laravel 105k（44kがデバッグ）。全フレームワークでN+1が発生【二次情報】(https://blog.appsignal.com/2026/06/17/vibe-coding-economically-which-framework-is-the-cheapest-rails-vs-django-vs-laravel.html)。
- Go推し意見は「gofmt/go test/単一バイナリで標準化」を挙げるが著者自身「データは全くない」と明言【二次情報】(https://getbruin.com/blog/go-is-the-best-language-for-agents/)。

## 4. 具体的スタック候補（ERP的Webアプリ、2026）

- **バックエンド（TS）**：NestJS＝「3人以上・長寿命バックエンドに強制的構造」、Fastify＝JSON Schema内蔵で高速だが構造は自律規律、Hono＝軽量・edge向きで「200+エンドポイントのモノリスには不向き」【二次情報】(https://encore.dev/articles/nestjs-vs-fastify-vs-hono)。
- **ORM**：Prisma 7はRust-free化で3.4倍高速・バンドル90%減、Drizzle/TypeORMは自動マイグレーション、Kyselyはマイグレーション手書き。「`as`/`any`で型を曲げた瞬間に安全性は崩壊」「リポジトリ層で抽象化して乗換影響を局所化」【二次情報】(https://tomodahinata.com/en/blog/prisma-vs-drizzle-vs-typeorm-kysely-orm-comparison-guide)。
- **API層**：tRPC v11 / oRPC / ts-rest / Hono RPC / OpenAPI codegen【二次情報】(https://www.pkgpulse.com/guides/orpc-vs-trpc-v11-vs-ts-rest-2026)。【推測】ERPは外部連携が必須なので、OpenAPIを契約の正とし、TS内部はcodegenかcontract-firstが無難。
- **バリデーション**：Zod 4 / Valibot / ArkType / TypeBox【二次情報】(https://www.pkgpulse.com/guides/zod-v4-vs-arktype-vs-typebox-vs-valibot-2026)。【推測】訓練データ量からZodが最も幻覚が少ない。
- **業務UI**：AG Gridはvirtualization/編集/grouping/pivot/Excel出力が最も完備だがEnterpriseライセンスと330KB、TanStack Tableはheadless 15KBで自前実装、MUI Data GridはPro/Premium階層【二次情報】(https://www.pkgpulse.com/guides/tanstack-table-v8-vs-ag-grid-vs-mui-data-grid-2026)。Refineはheadlessで Ant Design/MUI/Mantine/Chakra対応、ACL/ABACが無償、react-adminはMUI固定で高度機能は有償【二次情報・Refine自社記事】(https://refine.dev/blog/react-admin-vs-refine/)。
- **代替**：Python/Django（トークン効率最良、ERPのOSS実装であるOdoo/ERPNextが訓練データに豊富【推測】）、Java/Spring・Kotlin（Javaはベンチマークで一貫して上位）、Go（規約とビルド速度）、.NET（ベンチマーク証拠が乏しい）。

## 5. Monorepoツール・CI・品質ゲート

- Nxのみが`@nx/enforce-module-boundaries`（タグ＋depConstraints）を一級で提供し、affectedは推移依存を含む完全グラフ。Turborepo/Moonは境界ルールを持たない【確認済/二次情報】(https://nx.dev/docs/features/enforce-module-boundaries, https://www.pkgpulse.com/guides/turborepo-vs-nx-vs-moon-2026)。
- 汎用ツール：`eslint-plugin-boundaries`【確認済】(https://github.com/javierbrea/eslint-plugin-boundaries)、dependency-cruiser、tsarch【二次情報】(https://www.angulararchitects.io/en/blog/architecture-beyond-layers-tsarch-for-ai-agents/)。
- Phoebeはより強い決定論性を求めBazelで`dependency_enforcement_test`を書き、「CIが境界を越えた経路を明示して失敗する」ことで「制約を弱める」誘惑を防ぐ【二次情報】(https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase)。
- 【推測】100万行級では TS7の`--checkers`並列＋project references＋affected＋remote cacheが型チェック時間の実質的なシャーディングになる。Hooksでlint/typecheckを編集毎に強制すると、CIに行く前に修復ループが閉じる。

## 6. テスト戦略

- **Property-based**：Generator/Tester 2エージェントでPBTを使うPGSは、TDD系手法比でpass@1が23〜37%相対改善、Wrong Answerが25.3%→10.5%。「LLMは正しいコードより検証アーティファクトを生成する方が得意」【確認済】(https://arxiv.org/html/2506.18315v1)。
- **Mutation testing**：エージェントが実装とテストの両方を書くと「同じ思い込みを共有する高カバレッジ」が生まれる。文カバレッジ100%でmutation強度61.29%の例。変更された高価値領域に限定して実行し、認証/認可/金額処理にはLLM生成の意味的mutantを1〜3個、スコア最適化は禁止【二次情報】(https://www.awesome-testing.com/2026/08/mutation-testing-for-agent-written-code)。
- **Characterization/golden master**：「テストのないコードを変えるエージェントは仕様のないコードを変えている」。エージェントが網羅的キャプチャを生成し、人間は「承認ではなく昇格（promote/flag/delete）」を行う【二次情報】(https://www.tddbuddy.com/blog/characterization-tests-are-the-on-ramp/)。【推測】帳票・仕訳・在庫評価など決定論的出力はgolden fileで固定するのがERPには特に有効。
- **E2E（Playwright）**：エージェントが犯しがちな誤り＝CSS/XPathセレクタ、`waitForTimeout`、テスト間の状態共有、UI経由のデータ準備、ログインの毎回実行、`if`/`try`で失敗を隠す。対策＝role-based locator、web-first assertion、API fixtureでのシード、`storageState`再利用、シャーディング、バージョン固定【二次情報】(https://www.anton.qa/blog/posts/playwright-best-practices)。
- **速度**：「テストが20分かかればエージェントは20分遊ぶ」——5分以内を目標【二次情報】(https://siddhantkhare.com/writing/why-your-ai-agent-keeps-failing)。

## 7. 実験メトリクス

- DX AI Measurement Framework：**Utilization**（AI関与PR比率、AI生成コード比率）、**Impact**（時間節約、PRスループット、保守性、change confidence、change fail %）、**Cost**（AI支出/開発者、net time gain）。「コード生成量を個人評価に使うな」「採用率は品質低下と共存し得る」【二次情報】(https://getdx.com/blog/ai-measurement-framework-guide/)。
- 「速度指標には必ず品質指標を対にする」「PRスループット単独は無指標より悪い」、cost per shipped change、7日以内revert率【二次情報】(https://www.notdiamond.ai/blog/how-to-measure-roi-in-coding-agents)。

## 推奨（※以下は本調査に基づく【推測】）

### 推奨スタック
**TypeScript monorepo（pnpm + Nx）/ PostgreSQL / Drizzle（またはPrisma 7）/ NestJS（Fastify adapter）/ OpenAPI contract-first + Zod / React + TanStack Router/Query + shadcn/ui + TanStack Table（高密度グリッドが必要な画面のみAG Grid）/ Playwright / fast-check / StrykerJS。**

理由：(1) TS7で型チェックが10倍速になり、strict型＋Zodランタイム検証＋lint境界の三重フィードバックを数秒で返せる。型不整合はLLMが自力修正しにくいので早期・大量検出の価値が高い。(2) TSはGitHub首位で幻覚率が低い。(3) 単一言語で1人のアーキテクトのレビュー負荷とCLAUDE.md/skillsの分岐が最小。(4) Nxのタグ制約はOpenAIの「固定レイヤ＋カスタムlint」パターンをそのまま実装できる。(5) NestJSは規約が強く「200+エンドポイントのモノリス」に耐える。

運用面：`AGENTS.md`/`CLAUDE.md`は100行程度の地図に留め、`docs/`をsystem of recordに。1機能＝1 spec（EARS受入基準＋E2E検証手順）＝1 worktree＝1 PR。実装者と別contextのレビューsubagent＋Stop hookでlint/typecheck/testを決定論的ゲートに。ファイルサイズ上限・重複検出・命名規約をカスタムlintで機械化し、週次の「garbage collection」タスクをエージェントに回す。

### 最強の反論
**Python/Django（＋Odoo/ERPNext的な設計知識）の方がERPには適する**。ベンチマークではPythonが一貫して最も解きやすく、Djangoは同一アプリ生成でトークン効率が良い可能性があり、ERPドメインのOSS実装が訓練データに豊富。反面、型フィードバックは弱く、フロントは結局TSになる。TS推奨は「ドメイン知識より検証ループの強さを取る」判断。

### 実験の推奨指標セット
| 分類 | 指標 |
|---|---|
| 成果 | 受入テスト（EARS由来のE2E/契約テスト）通過数・通過率、機能あたりのspec→マージ所要時間 |
| 品質 | change failure rate、7日以内revert率、escaped defect数、mutation score（変更領域限定）、重複コード率・ファイルサイズ超過数 |
| 人的コスト | アーキテクトのレビュー時間/PR、手動修正LOC比率（rework ratio）、破棄セッション率 |
| 経済 | トークン/USD per merged PR、per 受入テスト通過、失敗ターン比率 |
| 構造健全性 | 境界lint違反の発生数・修復までの時間、依存グラフのサイクル数 |

LOC/日は「生成量」として参考記録に留め、評価軸にしない。

## Sources
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/worktrees
- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://www.anthropic.com/engineering/harness-design-long-running-apps
- https://claude.com/blog/how-anthropic-teams-use-claude-code
- https://infoq.com/news/2026/01/claude-code-creator-workflow/
- https://fortune.com/2026/01/29/100-percent-of-code-at-anthropic-and-openai-is-now-ai-written-boris-cherny-roon/
- https://openai.com/index/harness-engineering/
- https://agents.md/
- https://github.com/github/spec-kit
- https://kiro.dev/docs/specs/ , https://kiro.dev/docs/specs/feature-specs/
- https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- https://cursor.com/blog/scaling-agents
- https://simonwillison.net/2026/jan/19/scaling-long-running-autonomous-coding/
- https://simonwillison.net/2025/Oct/7/vibe-engineering/
- https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04
- https://mikemason.ca/writing/ai-coding-agents-jan-2026/
- https://addyosmani.com/blog/long-running-agents/
- https://arxiv.org/html/2601.16809v1
- https://arxiv.org/html/2608.09802v1
- https://arxiv.org/html/2504.02605v1
- https://www.swebench.com/multilingual.html
- https://amazon-science.github.io/SWE-PolyBench/
- https://aider.chat/2024/12/21/polyglot.html
- https://arxiv.org/html/2608.00661
- https://arxiv.org/html/2506.18315v1
- https://www.usenix.org/conference/usenixsecurity25/presentation/spracklen
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://metr.org/blog/2026-02-24-uplift-update/
- https://www.gitclear.com/ai_assistant_code_quality_2025_research
- https://www.pagerly.io/blog/ai-generated-code-incidents-2026-data-2026-08-30
- https://getdx.com/blog/ai-measurement-framework-guide/
- https://getdx.com/news/dx-releases-q2-2026-state-of-ai-impact-in-engineering-report/
- https://www.notdiamond.ai/blog/how-to-measure-roi-in-coding-agents
- https://infoq.com/news/2026/03/ai-reshapes-language-choice/
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://siddhantkhare.com/writing/why-your-ai-agent-keeps-failing
- https://getbruin.com/blog/go-is-the-best-language-for-agents/
- https://encore.dev/articles/best-frameworks-ai-assisted-development
- https://encore.dev/articles/nestjs-vs-fastify-vs-hono
- https://blog.appsignal.com/2026/06/17/vibe-coding-economically-which-framework-is-the-cheapest-rails-vs-django-vs-laravel.html
- https://tomodahinata.com/en/blog/prisma-vs-drizzle-vs-typeorm-kysely-orm-comparison-guide
- https://www.pkgpulse.com/guides/orpc-vs-trpc-v11-vs-ts-rest-2026
- https://www.pkgpulse.com/guides/zod-v4-vs-arktype-vs-typebox-vs-valibot-2026
- https://www.pkgpulse.com/guides/tanstack-table-v8-vs-ag-grid-vs-mui-data-grid-2026
- https://www.pkgpulse.com/guides/turborepo-vs-nx-vs-moon-2026
- https://refine.dev/blog/react-admin-vs-refine/
- https://nx.dev/docs/features/enforce-module-boundaries
- https://github.com/javierbrea/eslint-plugin-boundaries
- https://www.angulararchitects.io/en/blog/architecture-beyond-layers-tsarch-for-ai-agents/
- https://factory.ai/news/using-linters-to-direct-agents
- https://www.phoebe.work/blog/enforcing-architecture-in-an-agent-driven-codebase
- https://monorepo.tools/ai
- https://www.awesome-testing.com/2026/08/mutation-testing-for-agent-written-code
- https://www.tddbuddy.com/blog/characterization-tests-are-the-on-ramp/
- https://www.anton.qa/blog/posts/playwright-best-practices
