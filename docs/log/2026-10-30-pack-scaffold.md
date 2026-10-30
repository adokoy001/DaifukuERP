# 作業記録: 2026-10-30 pack 雛形生成（B7）

- セッション: B7 実装（branch `wip/pack-scaffold`、開始 commit `c361ba5`） ／ 担当: agent ／ 対象: [docs/specs/pack-scaffold.md](../specs/pack-scaffold.md)
- 計測: tokens=null, agent_minutes=80 + レビュー後の修正 約55（fixer）, human_minutes=0, rework_lines=45 + 約100（レビュー後の修正で削除・置換した行）, gate_failures=1

## 決めたこと（と理由）

- spec 批評 10 件（major 4・minor 5・nit 1 の 4 項目）のうち、nit の AI_INDEX 以外をすべて採用した（spec 末尾「spec 批評への対応」）。主なもの:
  - 表示する手順を「登録 → `pnpm install` → `pnpm db:generate`」の順にした。`apps/runtime` の動的 import は `apps/runtime/package.json` の依存と install でしか解決しないため、install を先にすると link されない。両モードの順序を単体テストで固定した。
  - `--register` の編集を 4 つにした。`apps/web/e2e/workforce.spec.ts:485` の「利用できる業界テンプレート 15 種」は `example` 以外の登録済み pack を数えるので、登録すると gate:full のブラウザ試験が落ちる。完全一致の検査を弱めず、新しい pack を期待値に加える編集として扱った（D6）。テスト名の英語 `fifteen` は表示の検査ではないので編集しない。
  - ラベルは `.ts` に `JSON.stringify` の文字列リテラルだけで入れ（Prettier が引用符を直す）、コメントには入れない。Markdown では `\`・`` ` ``・`*`・`_`・`[`・`]`・`<`・`>`・`|`・`#` をエスケープする。ラベルの規則は 1〜40 コードポイント、前後の空白なし、`\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}` なし、`__PACK_` なし。
  - 生成 pack の振る舞いの契約（AC-13〜AC-18）は一回の実測だけでなく、`scripts/test/pack-new.db.test.ts`（AC-24）で DB tier のたびに実行する。批評の最小案（台帳と規約の規則）より強くした。生成物をリポジトリに置かず、一時 workspace に生成して子プロセスの vitest で生成テストを走らせ、生成 AC ごとに結果を照合する。kernel の変更は light で DB 全件に昇格するので、このテストも必ず走る。加えて台帳 `PV-PACK-SCAFFOLD-01` でテンプレートと kernel の適用・権限・meta・試験基盤のファイルをリンクした。
  - 作業用ディレクトリは `node_modules/.cache/pack-new/`（vitest・tsc・ESLint・git・pnpm の対象外）。書込順は「一時ディレクトリにそろえる → 直前に存在確認して `packs/<k>` へ rename → spec を `wx` で作成 → 各編集の直前に読み直して計画時の内容と照合」。失敗・SIGINT・SIGTERM ではその実行が作ったものを消し、編集を戻す（終了コード 1／130／143）。
  - 衝突の検査に、partner の ext key `<c>Note` と、既存 pack のディレクトリ名から導いた camelCase の一致（`x-1` と `x1`）を加えた。予約名に `packs`・`company`（kernel の会社設定の名前空間）を加えた。
  - ラベルの既定値（Q3）: `--label-en` 省略時は名前の title case、`--label-ja` 省略時は英語と同じ文字列にして警告と生成 spec の `TODO:` を出す（AC-23）。
  - 不採用: AI_INDEX の行（このラウンドの実装担当は `AI_INDEX.md` を編集しない取り決め。統合メモに変更案を書いた）。
- テンプレートは `packs/example` を写さず専用に持つ（D1。example の ext・ラベル上書き・設定と衝突するため）。`package.json` と `tsconfig.json` だけは生成のたびに example から作る。
- 生成器の単体テストは vitest の unit project に置いた（D8。`pnpm test`・gate・quick の関連選択にそのまま入る）。
- ADR は書かない（D9。kernel・DSL・権限・データ経路を変えない）。マニュアルの付録は作らない（D7。開発用ツールで、生成直後の pack には利用者の手順が無い）。

## やったこと

- `scripts/pack-new.mjs`（引数・名前・ラベルの検査、衝突の静的走査、テンプレートの描画と Prettier 整形、登録の 4 編集の計算、手順の表示、`--dry-run`、一時ディレクトリ経由の書込と巻戻し）と型 `scripts/pack-new.d.mts`。
- `scripts/pack-template/`（`src/index.ts`・`src/pack.ts`・`src/entities/tag.ts`・`src/actions/count-tags.ts`・`src/seed.ts`・`src/sample.ts`・`test/pack.db.test.ts`・`spec.md` の `.tmpl`）。生成 DB テストは生成 AC-1〜AC-7 の 11 件（登録、初回適用と 2 回目の書込ゼロ、force と sample、admin 限定の適用・viewer の読取・作成拒否・付与の無いロール・拠点限定文脈（レビュー後の修正で admin の action 経由の適用と、店舗・拠点限定での `list`・作成の拒否を追加）、適用済み 2 社の分離と未適用会社での拒否、ext の検証・where・search、`appMeta`）。
- `scripts/test/pack-new.test.ts`（unit 26 件、レビュー後の修正で 29 件。AC-1〜AC-12・AC-20・AC-23）と `scripts/test/pack-new.db.test.ts`（DB 7 件、AC-13〜AC-18・AC-24）。
- 文書: [pack の書き方](../conventions/packs.md)「雛形から始める」と「apps への追加」、[拡張手順](../architecture/extension-guide.md) の手順 5 と「引継ぎを確認する記録」、[検証根拠の台帳](../verification/invariants.md) `PV-PACK-SCAFFOLD-01`。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体 `scripts/test/pack-new.test.ts` 26 件成功（AC-1〜AC-12、AC-20、AC-23。11〜27 秒、AC-20 の tsc は 3.8 秒）。拒否の各ケースでは一時リポジトリ全体のスナップショットが変わらないこと、書込失敗・編集対象の変化・後から現れた pack ディレクトリと spec・SIGINT／SIGTERM で巻き戻ること（終了コード 130／143）を確かめた。
- [実測] DB `scripts/test/pack-new.db.test.ts` 7 件成功（AC-13〜AC-18、AC-24。6〜10 秒）。子プロセスの vitest が生成テスト 11 件を実行する。
- [実測] 変異の確認（コミットしない一時変更）: テンプレートの action を存在しない `.countAll()` にすると AC-20 が tsc のエラー（TS2339）で失敗。マスタのテンプレートで viewer に `create` を足すと AC-24・AC-15・AC-16 が失敗。どちらも元に戻した。
- [実測] worktree での登録経路の一巡（検証手順 4、生成物はコミットせず片付けた）:
  - `node scripts/pack-new.mjs scaffold-check --register --label-ja 雛形確認 --label-en "Scaffold check"` 0.8 秒。10 ファイルの作成と 4 ファイルの編集、表示された手順は spec AC-6 の順。
  - `pnpm install` 7.6 秒（lockfile に importer 1 件と runtime の依存 1 件）、`pnpm db:generate pack_scaffold_check` 10.5 秒（`0018_pack_scaffold_check.sql`：表・RLS・会社 scope の FK・索引・tenant 分離 policy）。
  - `pnpm --filter @daifuku/pack-scaffold-check typecheck` 7.4 秒成功、生成 DB テスト 11 件成功（5.5 秒）。
  - `pnpm gate:light`（DB 全件に昇格、1,593.5 秒、load average 4.8〜12.7）: format・docs・assurance・typecheck（root／API／Web）・lint と依存境界・deploy は成功。unit は 1,570 件成功・3 件失敗、DB は 840 件中 838 件成功・2 件失敗で、gate は失敗。unit の 3 件は自分の単体テストが現在のカタログを直書きしていたためで、修正後に登録状態で unit 全件 1,573 件が成功（105 秒）。DB の 2 件は `boolean-migration.db.test.ts`・`ext-index-migration.db.test.ts` の旧版からの更新の試験で、全 migration 適用後の public の制約をすべて比べるため、表を足す migration があれば pack に限らず落ちる。E2 の commit `8083d57`（このラウンドで並行、未統合）の修正を一時的に当てると `boolean-migration` 9 件、`ext-index-migration` 2 件が成功した（後者は 2 ファイル同時の実行で setup の `dropAll` が Postgres のエラーになり、単独の再実行で成功。共有サーバーの負荷によるものと見ているが、エラー文は記録していない）。一時的な修正は戻した。**したがって AC-19（登録して手を入れずに gate:light が通る）は、基準 `4afa6d1` 単独では満たさず、E2 の修正の統合が前提。** 生成物と生成器の側の失敗は無かった。
  - 画面（AC-21）: `e2e-run.sh`（slot 7）でコミットしない一時 spec を実行し 1 件成功（9.8 秒）。`/templates` に `scaffold_check` のカード（雛形確認）が出て、サンプル付きで適用（`pack.apply` に `{ name: 'scaffold_check', sample: true }`）、`/workspaces/other` に「雛形確認のタグ」、`/e/scaffold_check_tag` に seed の 3 件、英語で `Scaffold check tags`、1280px と 390px でページと `#screen-content` が横にはみ出さない。スクリーンショット 6 枚を目視で確認した。初回は言語切替ボタンの指定を誤って失敗し、`言語: en` に直して成功した。
  - 同じ登録状態で `apps/web/e2e/workforce.spec.ts`（業界テンプレートの件数は 16 に編集済み）を industry project 込みで実行し 6 件成功（2.0 分）。
  - 片付け: spec の検証手順 4.6 のとおり `git restore`、`git clean -nd`／`-fd -- apps/api/drizzle`（`0018_pack_scaffold_check.sql` と `meta/0018_snapshot.json` を削除）、`rm -rf`、`pnpm install --frozen-lockfile` で 1 秒。`git status --short` は B7 の変更だけで、`packs/`・`docs/specs/`・`apps/api/drizzle` に未追跡のパスは残らなかった。
- [実測] 未登録の一巡（検証手順 5）: `node scripts/pack-new.mjs scaffold-free`（`--label-ja` なしの警告と spec の `TODO:` を確認）→ `pnpm install` 3.9 秒 → `pnpm format:check` 32 秒、`pnpm typecheck` 13 秒、`pnpm lint`（依存境界を含む、既存の警告 5 件のみ）28 秒、pack の typecheck 9.4 秒、生成 DB テスト 11 件成功 9.7 秒 → 片付け。
- [実測] B7 の変更そのものの `pnpm gate:light`: `--base 4afa6d1` で成功（436.8 秒、load average 4.7〜9.8）。format 65.1 秒、docs 1.2 秒、assurance 0.2 秒（`PV-PACK-SCAFFOLD-01` の再確認を表示）、typecheck 32.3／API 32.8／Web 40.8 秒、lint 45.4 秒、unit 1,573 件 165.4 秒、DB 5/132 ファイル 31 件 30.8 秒（常時の 4 suite と、module graph で選ばれた `scripts/test/pack-new.db.test.ts`）、deploy 22.6 秒。自動で選ばれる基準（origin/main との merge-base `431dda5`）だとラウンド 1〜3 の kernel の変更が含まれて DB 全件に昇格するため、このラウンドの基準 commit を明示した。
- [レビュー] 生成 spec（`docs/specs/pack-scaffold-check.md`）を読み、`_template.md` の見出しの順、AC-1〜AC-7、`TODO:` 欄、相対リンク（ADR-0015・ADR-0016・pack-scaffold・pack の書き方）が実在することを確認した（docs:check の対象外のファイルのため目視）。
- [未検証] `pnpm gate:full`（統合担当）。人間の第三者による手順の完走。Windows など Linux 以外での実行（rename とシグナルの扱い）。生成した pack を他の pack と同じ会社に適用したときのメニュー表示の並び（order 90）は目視していない。

## レビュー後の修正（2026-10-30、fixer）

実装（`5f8814e`）への 3 観点（spec・safety・ux）のレビュー指摘 19 件（major 3・minor 8・nit 8）をコードと照合した。重複（AC-19 の 2 件）を含めすべて実際の挙動・記述として確認でき、却下は無い。spec 末尾「実装レビューへの対応」に一覧を置いた。主なもの:

- **途中で失敗した書込の巻戻し（spec・major）。** 編集は `io.writeFile` が返った後に巻戻しの対象へ入れていたので、`O_TRUNC` の後で ENOSPC などで失敗すると切り詰めたファイルが残った。spec も `wx` の作成後の失敗で途中までのファイルが残り、次の実行が「既にある」で拒否された。編集は書込の前に対象へ入れ（直前に `before` と照合済みなので戻すのは常に安全）、spec は `EEXIST` 以外の失敗でも削除の対象にした。巻戻しが一部失敗したときは「すべて戻した」と書かず、戻せなかったパスを出す。
- **AC-19 の前提（spec・major ×2）。** 状態行・AC-19・AC/試験の表に「E2 `8083d57` の統合が前提、基準 `4afa6d1` 単独では旧版更新試験 2 件で不成立」を明記した。状態は implemented のまま、前提を同じ行に書いた。
- **sample の取引先コードの衝突（safety・minor）。** `_` を落として 12 文字に切っていたため `bike-shop` と `bikeshop` が同じ `BIKESHOP-0001` になり、同じ会社に両方の sample を適用すると後の pack は何も作らずに `sampledAt` だけを記録した。コードを `<s>` の大文字（15 文字まで、超えたら先頭 10 文字＋`_`＋SHA-256 の 4 桁）にし、既存 pack のディレクトリ名から導いたコードの一致と、`<CODE>-` で始まるリテラルが `kernel/`・`modules/`・`l10n/`・`packs/`・`apps/` にあることを衝突として拒否する。ハッシュが一致する 2 つの名前（`industrial-mach-a493`・`industrial-mach-a649`）を総当たりで見つけて単体テストに使った。
- **生成テストの権限（spec・nit、safety・nit）。** AC-4 に admin が action `pack.apply` を実行できること（適用済みで書込なし）と、店舗限定・拠点限定の両方で `count_tags`・`<s>_tag.list`・admin の作成が拒否されることを加えた（`it` の数 11 は不変）。
- **手順と文言（ux）。** 未登録の手順から「`--register` を付けて再実行」をやめ（必ず拒否されるため）、後から登録するときは 4 編集を手で行うと書いた。`--dry-run --register` は「編集する予定」と出す。手順 5 に「完了と言う前に `pnpm gate:full`」を加えた（4 番目の編集の件数を確かめるのはブラウザ試験だけ）。`--label-ja` 省略時の警告に entity のファイルを加えた。規約の `db:generate` の記述の食い違い、`pack_<snake名>` の表記、spec 内の検証手順の参照番号、台帳のテンプレートのリンク（3 件 → 8 件）、拡張手順の記録の書き方（2 回の実行を分けて書く）、検証 4.5 の `e2e-run.sh` 依存を直した。
- **その他（nit）。** 作業用ディレクトリの親の削除を再帰しない `rmdir` にした。`workforce.spec.ts` の試験名の `fifteen` を件数を含まない形に一度だけ改めた（登録のたびに件数と食い違うため。検査は不変）。使われない export 17 件と型宣言を消し、spec が公開関数に挙げる `parsePackNewArgs` に直接の単体テストを足した。

検証（fixer、DB `daifuku_test_b7fx`、ブラウザ slot 6）:

- [実測] 単体 `scripts/test/pack-new.test.ts` 29 件成功（26 件 + 途中で失敗した書込、`parsePackNewArgs`、`bike-shop`／`bikeshop`。11 秒）。途中で失敗した書込の試験は、修正前の順序（書込の後に対象へ入れる）に戻すと `apps/runtime/package.json` の内容の不一致で失敗することを確かめてから戻した。
- [実測] DB `scripts/test/pack-new.db.test.ts` 7 件成功（7.1 秒）。子プロセスが新しいテンプレートの生成テスト 11 件を実行した。
- [実測] worktree での登録経路の一巡（検証手順 4。生成物はコミットせず片付けた）: `node scripts/pack-new.mjs scaffold-check --register --label-ja 雛形確認 --label-en "Scaffold check"` 0.7 秒（`--dry-run` を先に実行し「--register would edit」の表示を確認）、`pnpm install` 4.5 秒、`pnpm db:generate pack_scaffold_check` 5.1 秒（`0018_pack_scaffold_check.sql`）、pack の typecheck 7.9 秒成功、生成 DB テスト 11 件成功、`apps/runtime/test/` の unit 7 件成功、生成物の Prettier 検査と ESLint 成功、`migrations.db.test.ts`・`industry-templates.db.test.ts` 6 件成功。`boolean-migration.db.test.ts`（1 件失敗・8 件成功）と `ext-index-migration.db.test.ts`（1 件失敗・1 件成功）は実装時と同じく旧版更新試験で失敗し、E2 `8083d57` の 2 ファイルの差分を一時的に当てるとそれぞれ 9 件・2 件成功した（差分は戻した）。登録状態の `apps/web/e2e/workforce.spec.ts`（件数 16、改めた試験名）は industry project 込みで 6 件成功（2.1 分）。作業前に無かった `node_modules/.cache` は生成後に残っていなかった（`rmdir` の連鎖で消えた）。片付けは検証手順 4.6 のとおりで、`git status --short` は空。**登録状態の `gate:light` 全体は再実行していない**（基準 `4afa6d1` では上記 2 件で落ちることが分かっているため。統合担当が E2 の後に実行する）。
- [実測] コミットした状態の `apps/web/e2e/workforce.spec.ts`（件数 15、改めた試験名）を industry project 込みで実行し 6 件成功（3.0 分）。
- [実測] コミット `b3b6873` の `pnpm gate:light --base 4afa6d1` 成功（約 309 秒、load average 8.4〜10.6）: format 37.1 秒、docs・assurance（`PV-PACK-SCAFFOLD-01` の再確認を表示）、typecheck（root／API／Web）、lint、unit 155 ファイル 1,576 件 101.9 秒、DB 5/132 ファイル 31 件 43.5 秒（常時の 4 suite と `scripts/test/pack-new.db.test.ts`）、deploy 25.7 秒。

## 見つけた問題と修正（発見経路つき）

- 単体テストが現在のカタログの状態（`利用できる業界テンプレート 15 種`、配列の最後の `'beauty_salon'`）を直書きしていて、どれかの pack が登録されると落ちる状態だった — 発見: 実測（登録した状態での gate:light の unit で AC-6・AC-7・AC-11 の 3 件が失敗）。修正: 期待値を一時コピーした登録先ファイルの内容から導くようにした（この PR 内）。生成器そのものの不具合ではない。
- 子プロセスの vitest が `node_modules` のシンボリックリンク経由で `packs/example/node_modules/.vite` にキャッシュを書いていた（git 管理外だが一時 workspace の外への書込）— 発見: 実測（ディレクトリの確認）。修正: 一時 pack の `node_modules` を実ディレクトリにし、example の各項目へのリンクを並べた。作ってしまったキャッシュは削除した。
- `docs/specs` が無いリポジトリで書込先の検査が `ENOENT` の例外になった — 発見: レビュー。修正: `PackNewError`（終了コード 1）にして単体テストを足した。
- 書込が途中で失敗すると切り詰めた編集対象・途中までの spec が巻き戻されない、sample の取引先コードが別の名前と一致する、未登録の手順と `--dry-run` の表示が誤る、ほか 16 件 — 発見: 実装後のレビュー（spec・safety・ux の 3 観点、再現の probe つき）。修正: 上記「レビュー後の修正」（この PR 内）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- `pnpm gate:full`（統合担当が実行する）。
- E2（`8083d57`）を統合したブランチで検証手順 4（登録 → `pnpm install` → `pnpm db:generate` → `pnpm gate:light`）をやり直し、AC-19 の成立を記録する（統合担当。B7 は E2 の後か同時に統合する）。
- 第三者完走の記録（人間の第三者が業務台本つきで行う。下記「第三者完走の記録条件」）。
- B2 の kernel の会社作成が統合されたら、生成テストの追加会社（owner 接続の insert）を置き換える（D11）。

## 第三者完走の記録条件（拡張手順「引継ぎを確認する記録」）

満たしていない。今回の一巡はエージェント（実装担当）による生成・登録・検証であり、人間の第三者による導入ではない。業務台本も無く、生成した pack は雛形のまま（業種固有の業務を足していない）で、コミットもしていない。記録条件のうち、開始 commit（`c361ba5`）、変更した層（`scripts/`、`apps/runtime`、`apps/web/e2e`、`apps/api/drizzle`）、試験結果（権限外操作・再適用を含む生成テスト）は残したが、「第三者がこの手順だけで新しい pack を追加できる」ことの証拠にはならない。拡張手順にもそう書いた。

## 判断待ち（利用者）

- Q1 root `package.json` に `pnpm pack:new` の別名を足すか（推奨: 統合時に判断。足すなら CLAUDE.md の Commands と規約の例も合わせる）。
- Q4 生成する ext を partner 以外から選べるようにするか（推奨: 当面 partner 固定）。

## 次のセッションへ

- `AI_INDEX.md` に「新しい pack を足す → `node scripts/pack-new.mjs <name> --register`、[pack の書き方](../conventions/packs.md)「雛形から始める」」の行を足す（統合担当）。
- テンプレートや `PV-PACK-SCAFFOLD-01` にリンクした kernel のファイルを変えたときは、spec の検証手順 4（登録して gate:light と画面での適用）をやり直す。
