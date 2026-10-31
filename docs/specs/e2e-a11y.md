# Spec: e2e-a11y（主要画面のアクセシビリティ自動検査）

- 状態: implemented
- モジュール: `apps/web/e2e`（`a11y.spec.ts`、`a11y-policy.ts`、`a11y-exceptions.json`）、違反を直した `apps/web/src`（CSS 5 ファイル、`components/line-grid.tsx`、`components/analytics-result.tsx`）、Web unit `apps/web/src/a11y-policy.test.ts` ／ 依存: [test-tiers](test-tiers.md)（A1 の `@smoke` と階層）、[ui-kit](ui-kit.md)（D1）
- ADR: 不要（devDependency 1 件の追加のみ。実行時の構成・API は変えない）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) A2。実装: agent（ブランチ `wip/e2e-a11y`）

## 目的（1段落）

画面には aria 属性・スキップリンク・経路変更時の焦点移動などの配慮があるが、自動検査が無いため、変更で崩れても気づけない。主要画面を日本語・英語、デスクトップ・390px で axe により検査し、重大な違反を CI で止める。既に存在する違反は直すか、理由付きの例外として記録する。

## 受入基準（EARS）

- AC-1 WHEN `apps/web/e2e/a11y.spec.ts` が実行された THE SYSTEM SHALL ログイン（`/login`）、ホーム（`/`）、取引先一覧（`/e/partner`）、売上請求書フォーム（新規、`/e/sales_invoice/new`）、会社設定（`/settings`）、`/me`、`/workforce`、`/analytics` の 8 画面を、日本語・英語 × 1280px・390px の 4 条件（計 32 件）で axe（WCAG 2.1 A/AA のタグ `wcag2a` / `wcag2aa` / `wcag21a` / `wcag21aa`）により検査する。検査は、画面の `h1` が表示され、読込の失敗表示（`meta-error`）・`aria-busy="true"`・`loading-view` が無く、通信が落ち着いた後に行う。ログイン以外は標準会社の管理者（fixture の `admin@example.com`）で表示する。
- AC-2 IF `serious` または `critical` の違反があり、`apps/web/e2e/a11y-exceptions.json` に一致する例外（rule id と画面と対象 selector の組、理由、期限または追跡先）が無い THEN THE SYSTEM SHALL 試験を失敗させ、違反の rule・影響度・対象（axe の node target）・説明（help、failureSummary、help URL）を出力する。例外の一致は rule・画面・target の完全一致で判定し、`locales` / `widths` を書いた例外はその条件の実行にだけ適用する。axe が影響度を返さない違反は失敗として扱う。axe が判定できなかった node（`incomplete`。グラデーション上の文字のコントラストなど）は rule ごとの件数と対象を報告に出し、結果ファイルにも残すが、失敗にはしない。
- AC-3 THE SYSTEM SHALL 例外ファイルの各項目に `reason`（理由）と `followUp`（追跡先の spec・計画項目＝存在する `docs/…/*.md`（`#anchor` 可）、または実在する日付の期限 `YYYY-MM-DD`）を必須とし、未知の画面・条件・項目名と、同じ rule・画面・target で言語 × 幅の条件が重なる項目を拒否する（条件が重ならなければ同じ組を複数の項目に分けてよい。Web unit と a11y spec の両方で検査）。期限を過ぎた例外は a11y spec が警告として出す（失敗にはしない）。WHEN ある実行に適用される例外がその実行で 1 件の違反にも一致しなかった THE SYSTEM SHALL その実行を失敗させ、古い例外として報告する（実行ごとに判定するので、`--grep` で一部だけ実行しても誤判定しない）。
- AC-4 THE SYSTEM SHALL 検査開始時に既存の違反を修正し、修正できないものだけを例外に登録する。修正は UI キットとトークン（D1）の範囲で行い、見た目の大きな変更は伴わない。横に流れる枠を Tab で止める修正（`scrollable-region-focusable`）は、枠の中に焦点を受ける要素が無いときだけ止め、入力欄やリンクがあるときは Tab の止まりを増やさない（明細表は行の追加後・確定後も、a11y spec の AC-4 試験で確かめる）。
- AC-5 THE SYSTEM SHALL a11y 試験のうち日本語・1280px の 8 件に `@smoke` を付け、`pnpm e2e:smoke` で実行されるようにする。
- AC-6 THE SYSTEM SHALL 依存の追加を `@axe-core/playwright`（devDependency、固定版 `4.13.0`。推移的に `axe-core@4.13.0`）に限り、`pnpm-lock.yaml` を更新して `THIRD_PARTY_NOTICES.md` の規約に従う。

## 関係するファイル・インターフェース（名指し）

- `apps/web/e2e/a11y.spec.ts`（新規）: 32 件の検査、例外ファイルの形式検査、明細表の横スクロール枠の焦点の検査（AC-4）。各実行の axe の `violations` と `incomplete` を `test-results/<試験>/axe.json` に、判定の報告を添付 `axe-report.txt` に残す
- `apps/web/e2e/a11y-policy.ts`（新規、Playwright を import しない純粋関数）: 画面一覧 `A11Y_SCREENS`、`a11yRuns`、`a11yTitle`、`isSmokeRun`、`parseExceptions`（文書の存在確認は呼出し側が `documentExists` で渡す）、`expiredDeadlines`、`isIsoDate`、`followUpDocument`、`judge`、`formatJudgement`、`targetOf`
- `apps/web/e2e/a11y-exceptions.json`（新規）: `{ "about": "...", "exceptions": [{ rule, screen, target, reason, followUp, locales?, widths? }] }`。実装時点では 0 件
- `apps/web/src/a11y-policy.test.ts`（新規、Web unit）: AC-1/2/3/5 の規則と、チェックイン済み例外ファイルの形式
- `apps/web/package.json`、`pnpm-lock.yaml`
- 違反の修正: `styles.css`（`.topbar-right`、`.eyebrow`、`.welcome-header p`）、`navigation.css`（`.home-intro p`）、`identity.css`（`.auth-language`）、`operations.css`（`.muted`、`.control-back`）、`workforce.css`（`.workforce-metric small`）、`components/line-grid.tsx`（補助文字の色と、横に流れる枠の焦点）、`components/analytics-result.tsx`（ページ送りの `role="group"`。axe の `incomplete` に出ていた `aria-prohibited-attr`）
- `docs/conventions/testing.md`、`docs/conventions/ui.md`、`docs/architecture/verification-and-release.md`（E2E の行）、`docs/specs/test-tiers.md`（AC-11 の `@smoke` 件数の注記）、`THIRD_PARTY_NOTICES.md`

## データ・業務ルール（出典）

- WCAG 2.1（W3C 勧告）の A/AA 達成基準を axe の rule tag で参照する。法令上の適合認定は主張しない。axe はすべての達成基準を自動判定できるわけではなく、この検査の成功は「axe が検出できる serious / critical の違反が 8 画面 × 4 条件の表示時点で無い」ことだけを意味する。

## スコープ外（明記）

- 全画面・全業界の網羅、手動の支援技術による検証、色覚シミュレーション
- axe が判定できなかった node（`incomplete`）の手動判定。報告と `axe.json` に残すだけ
- `moderate` / `minor` の違反の失敗化（出力はするが失敗にしない）
- axe の best-practice タグ（`best-practice`、`region` など）。WCAG のタグだけを対象にする
- 操作後の状態（ダイアログを開いた状態、390px のメニューを開いた状態、明細行がある請求書、確定後の読取専用表示）の axe 全規則での検査。全規則は初期表示だけを検査する（明細表の枠の焦点だけは AC-4 の試験が `scrollable-region-focusable` で確かめる）

## 検証手順（E2E、実行して記録する）

1. 例外なしで一度実行し、検出された違反を一覧にして log に残す。
2. 違反を修正し、残りを理由付きで例外に登録して成功させる。
3. 例外を 1 件削除すると失敗すること、存在しない例外を足すと失敗することを確認する（AC-2、AC-3）。実装時点で例外が 0 件のため、修正を 1 か所一時的に戻して例外を登録し、成功 → 例外を削除して失敗、一致しない例外を足して失敗、を確かめる。
4. `pnpm e2e:smoke` に 8 件が含まれることを確認する（`playwright test --list --grep @smoke`）。
5. `pnpm gate:full`（統合担当が実行する。作業項目では `gate:quick` / `gate:light` と、触った画面のブラウザ試験）
6. 明細表の横スクロール枠（AC-4）: a11y spec の AC-4 試験（新規の請求書の 0 行 → 行の追加、確定済みの請求書、確定済みの支払）が成功し、枠の条件を以前の「0 行または読取専用」に戻すと確定済みの支払で失敗することを確かめる。

## 実装時に確認・変更したこと（2026-10-29）

- 計画の下書きからの変更: 例外の照合を「実行ごと」にした（AC-3）。ファイル全体で「どこでも使われなかった」と判定すると、`--grep @smoke` などの部分実行で誤って古い例外と判定されるため。そのぶん例外は `locales` / `widths` で条件を絞れるようにした（AC-2）。
- 実装時点の serious / critical は 13 件（`color-contrast` 12、`scrollable-region-focusable` 1）で、すべて共有の CSS と明細表の部品で直せた。会社設定画面の違反は共有の上部バー（利用者名）だけで、`settings-page.tsx` は触らずに解消した。このため B1 を追跡先とする例外も不要になった。一覧は [作業記録](../log/2026-10-29-e2e-a11y.md)。
- `@smoke` の件数: A1 の `scripts/test/gate.test.ts` は試験名を直書きした代表試験（6〜8 件、実装時点で 7 件）を数え、ループで作る a11y の 8 件は数えない。a11y の 8 件は `apps/web/src/a11y-policy.test.ts` が数える。`pnpm e2e:smoke` は合計 15 件（と依存 project の industry 3 件）を実行する。[test-tiers](test-tiers.md) の AC-11 に、この内訳を注記した。
- `@axe-core/playwright` は 4.14.0（2026-10-15 公開）ではなく、公開から 2 か月以上経った 4.13.0（2026-08-11）に固定した。

### レビュー後の変更（2026-10-30）

- 重複の判定を「rule・画面・target が同じ」から「同じ組で言語 × 幅の条件が 1 つでも重なる」に改めた。条件は直積なので、例えば ja/1280 と en/390 だけで出る違反は、条件の重ならない 2 項目でしか表せないため（1 項目にすると ja/390・en/1280 で古い例外として失敗する）。
- `followUp` は形だけの必須から、存在する `docs/…/*.md`（`#anchor` 可）か実在する日付に限定した。文書の存在は Web unit と a11y spec が確かめる。期限切れは警告だけにした（同じコミットの結果が日付で変わらないようにするため。判断は作業記録）。
- axe の `incomplete`（判定不能）を捨てずに `axe.json` と報告へ残すようにした。実測で 32 件の実行に延べ 475 node あり、ほとんどがグラデーション背景（左メニュー、専用画面の hero）上のコントラストである。失敗にはしない（AC の範囲は変えない）。その中にあった `/analytics` のページ送りの `aria-prohibited-attr`（役割の無い `div` の `aria-label`）は `role="group"` で直した。
- 明細表の横スクロール枠に焦点を持たせる条件を「0 行または読取専用」から「枠の中に焦点を受ける要素が無いとき」（DOM を読み、変化を `MutationObserver` で追う）に改めた。確定済みの支払の消込明細のように、読取専用でも伝票へのリンクがある表で Tab の止まりが増えていたため。a11y spec に検査（AC-4）を足した。
- 検査前の待ちの順序を、`h1` → `networkidle` → 読込失敗・読込中の表示が無いこと、に改めた（`networkidle` は 1 回の遷移で 1 度しか起きないため）。

## 未決事項（利用者の判断待ち）

- `moderate` 以下の違反をいつ失敗化するか（実装時点の 32 件の実行では WCAG タグの moderate / minor は 0 件）。
- 検査する状態を増やすか（ダイアログ、390px のメニュー、明細行のある伝票、確定後の読取専用表示など。スコープ外に記載）。
- 期限切れの例外を警告から失敗に変えるか（実装は警告のみ。同じコミットの結果を日付で変えないため）。
- axe が判定できなかった node（`incomplete`、主にグラデーション上の文字のコントラスト）を手で判定するか、背景を単色にして axe に判定させるか。
