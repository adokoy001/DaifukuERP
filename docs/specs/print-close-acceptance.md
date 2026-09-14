# Spec: print-close-acceptance

- 状態: implemented（局所受入済み、全体gateと公開CIを確認中）
- 対象: deploy/test/browser-security.test.mjs
- 作成: 2026-09-14

## 目的

mainへのマージ後に、印刷ポップアップの実Close操作とPlaywrightのクリック後の待機が競合した。実際のクリックと閉鎖の検証を維持し、閉じたページに対する不要な待機をなくす。

反復試験で、初期のabout:blankと印刷blobの遷移も区別する必要が見つかった。印刷先URLと読込みの完了を待ってから印刷画面を検証する。

## 受入基準（EARS）

- AC-1: WHEN 印刷ポップアップのCloseボタンを操作する THE TEST SHALL 実クリックと実closeイベントの両方を確認し、親ページが開いたままであることを確認する。
- AC-2: IF Close操作が無効である THEN THE TEST SHALL 制限時間内に失敗し、直接のページ閉鎖や例外の握りつぶしで成功させない。
- AC-3: WHEN 印刷ポップアップを開く THE TEST SHALL 印刷blobのURLと読込み完了を確認してから、CSPと印刷操作を検証する。

## 検証

1. cloud/onprem双方の実Caddy・TLS・Chromium受入を繰り返し、印刷・閉鎖・ダウンロード・CSP拒否の既存assertionを確認する。
2. 隔離したfixtureでCloseハンドラだけを無効化した場合、closeイベント待機が失敗することを確認する。
3. `pnpm gate` とGitHub Actionsを確認する。

## 判断の根拠

- [Playwright locator.click](https://playwright.dev/docs/api/class-locator#locator-click-option-no-wait-after)（2026-09-14確認）: `noWaitAfter` はクリック後の遷移待機だけを変更する。actionabilityと実クリックを維持する。
- 発見ログ: [main CI](https://github.com/adokoy001/DaifukuERP/actions/runs/34806627968/job/103859656253)。

## スコープ外

アプリケーション、CSP、権限、データベース、AWS環境の変更。
