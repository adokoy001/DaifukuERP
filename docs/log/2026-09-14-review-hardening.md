# 作業記録: 2026-09-14 追加レビューへの対応

- 対象: [仕様](../specs/review-hardening.md)
- 計測: tokens=null, agent_minutes=null, human_minutes=null, rework_lines=null

## 決定と実装

- scryptを非同期化し、版と計算パラメーターを保存する。旧形式は従来のsalt文字列として検証し、成功時に条件付き更新する。reset/失効/無効化との競合では古い資格情報を発行しない。計算同時数と待機数を制限し、過負荷503を認証失敗の回数に数えない。
- extの完全一致検索を `equalityIndex: true` で宣言する。まずJANへ適用し、内部STORED生成列の128文字候補とtenant/company付きB-treeを使う。候補の後で全文比較し、先頭ゼロ・長文・多バイト・重複を保持する。runtimeの公開列とmetaには内部列を含めない。
- analyticsの既存E2E6件を維持し、会社切替、逆順HTTP応答、scope不一致/障害からの復旧、実Web Lock待機中の選択と未保存編集を4件追加する。既存のカタログ権限失効試験には再試行復帰も加える。行数比率をカバレッジとして扱わず、行数だけの分割はしない。
- APIとsetupをビルド済みJSで配布する。frozen source自身のTypeScriptで相対importを書き換え、workspace exportsとJSON/ファイル配置を保つ。通常APIのmodule graphからスキーマ生成を分離し、setup用の生成器は保持する。
- [Cookie移行ADR](../adr/0025-browser-session-migration.md)を作成する。別タブの主体と未保存入力を維持するサーバーセッション・CSRF/SSO/MFA横断検証が揃うまで現行方式を切り替えない。

## 検証

- [実測] 新規のローカルPostgreSQL 16に認証・索引・gate・ブラウザ・成果物の専用DBを分けた。実運用DB/AWSを検証先に使っていない。
- [実測] 業界fixtureの実画面3件、分析・帳票10件、SSO/MFA/招待・メール再設定・機器認証のブラウザ3件が成功（retry 0）。追加した分析の状態遷移で本体修正が必要な不具合は検出しなかった。
- [実測] JSのstatic/dynamic import、JSON/ファイルURL、public subpath、通常APIの実module graph、独立したsetup helpを検査した。ソースからのAPI buildとWeb buildは成功した。
- [実測] format、全体/API/Webの型、lint/依存境界、単体123ファイル1,019件、配布16件、文書110件1,044リンク、assurance15条件が成功。API/Web/edge buildも成功した。
- [実測] 一括 `pnpm gate` のDB段階は113ファイル680件が成功し、エッジ実APIの準備1ファイルで停止した。専用DB名が安全確認に必要な `test` を含まなかった環境設定が原因で、アプリ修正は不要だった。所有するDB名とprivate接続設定だけを直した後、同じエッジ試験の4件が成功した。合計114ファイル684件のDB試験と残りのgate項目を確認したが、この初回コマンド自体をexit0とは記録しない。完全な一括gateは公開CIの当該commitで確認する。
- [実測] 実装checkpoint `16f06ead7303e9d83713791f7c97ecca6f19efa3` からoffline/frozenのLinux x64候補配布物を作成し、別ディレクトリへ展開した。新しい空DBへ同梱17 migrationを適用し、JAN索引の有効性、`--env-file` とビルド済みJSだけでのAPI起動、health/ready200、誤パスワード401、正しいログイン200、認証付き本人取得200、SIGTERM終了0を確認した。検査前後のmanifestは同一。後続コミットは検証記録とCIの起動順の修正で、配布するアプリ本体は同一である。
- [公開CI] 一括 `pnpm gate` を含む公開チェックの成否は、この変更のPRのChecksと対象head commitを証拠とする。ローカルの環境修正前の失敗を消したり、CI実行前に成功と記録したりしない。

## 検査で発見した問題

- [実測] RLS下のgeneric planではJSONB/leftの式索引が検索条件に使われず、約2万行を候補にしていた。RLSや組込関数の安全性を変えず、内部生成列と通常の比較索引へ修正した。新方式はapp role/FORCE RLSの実行計画で索引利用を検査する。
- [レビュー] 別checkoutを `--source` にした配布では、実行器側のTypeScriptを使うと指定sourceのlockとコンパイラがずれる。source内の固定installから明示解決し、別sourceの選択を回帰試験にした。
- [実測] 新しい `.runtime/api` のコピーがテスト探索に含まれた。生成成果物だけをVitest/ESLint/Prettierの探索から除外し、元ソースの検査は維持した。
- [実測] 100回の実パスワード失敗を検査する既存試験は、強化した計算量で旧30秒の試験予算を超え、5分窓をまたぐ揺らぎも顕在化した。その1ケースだけ予算を120秒にし、Dateだけ固定した。暗号処理・HTTP・タイマーは実時間、100回の401と101回目の429という期待は維持した。
- [CIで発見] ブラウザ用の独立jobはソース起動からコンパイル済み起動へ変わった後のbuild工程が不足し、起動前に終了した。そのjobにも `pnpm build:api` を先行させ、以後の通常ブラウザ試験はコンパイル済みAPIに対して実行する。
- [レビュー] 配布物のメール配送workerはソース用npm scriptでは起動できないため、同梱JSと保護された環境設定ファイルで起動する手順を運用文書に明記した。

## 未実施

- Cookie方式の実装、部分一致検索向けの索引、実運用規模の負荷・メモリ・起動時間の測定。
- AWSの試用環境の更新。公開ソースと配布物の検証を今回の範囲とする。

## 判断待ち

なし。
