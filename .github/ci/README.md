# CI の構成

`ci.yml` は `push(main)`、`pull_request`、手動実行を対象にします。GitHub 上の実行結果は Actions で確認してください。ローカル検証の成功は GitHub Hosted Runner 上の成功を意味しません。

| Job | 検証 | データ |
| --- | --- | --- |
| gate | 型・lint・依存境界・unit（Web含む）・DB・文書リンク、Web 型とビルド | job 専用 PostgreSQL 16、`daifuku_ci_test` |
| e2e | 3 業界の画面導入 → 会計/運営/スマホ従業員/給与などのブラウザ試験 | 別 job 専用 PostgreSQL 16、空の `daifuku_ci_e2e` |
| setup | 初回導入・再実行・0008 からの更新・復元検証・失敗と再開 | 一時ディレクトリに新規クラスタ、ランダム資格情報 |

権限は `contents: read` だけです。checkout の資格情報は保存しません。fork PR は `pull_request` で検証し、repository secrets、実環境、`pull_request_target` を使いません。依存は pnpm の固定バージョンと `--frozen-lockfile`、ブラウザは lockfile に対応する Playwright の Chromium を使います。

`databases.sql` の既知のパスワードは、job ごとに作る使い捨ての合成データ専用です。既存 role があると失敗し、権限変更・DB 削除は行いません。一般の導入には使わないでください。

E2E の準備コマンドはループバック上の許可された空 DB だけを受け入れます。`demo:industries` で事前適用せず、Playwright の `industry` project が実画面からサンプル付き導入を検証します。`chromium` project はそれに依存します。業務日付は Tokyo の実行日を一度だけ選び、準備と全テストで共用します。ローカルでのブラウザ試験の再現は [CONTRIBUTING.md](../../CONTRIBUTING.md) にあります。

失敗時のブラウザ診断は、合成データによる HTML レポート、スクリーンショット、trace、API/Web ログに限定して 7 日保持します。セットアップ用クラスタの env・資格情報・状態・バックアップは成果物に含めません。一般の開発環境のログや `review/` は収集しません。

## 固定した Action の確認元

2026-09-12 に公式リリースと `git ls-remote` のタグ参照を照合し、以下の完全な commit SHA を指定しました。注釈付きタグは `^{}` で参照先の commit を確認しています。更新は Dependabot の PR を確認して行い、浮動タグに戻しません。

| Action | リリース | commit |
| --- | --- | --- |
| actions/checkout | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | [v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) | `820762786026740c76f36085b0efc47a31fe5020` |
| actions/upload-artifact | [v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| pnpm/action-setup | [v6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0) | `ea17c68df8912ef543352723c149a84f56e3d413` |

これらの Action は Node 24 の runner runtime を使い、アプリの検証には Node 22.23.2 を指定します。[Ubuntu 24.04 Hosted Runner のツール一覧](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) で PostgreSQL 16 の同梱を確認しました。setup job はそのバイナリを明示確認し、OS の PostgreSQL サービスを変更せず別ポートに自分のクラスタを作成します。コンテナは PostgreSQL 16.15 の patch tag、runner は `ubuntu-24.04` で固定しますが、Hosted Runner の OS イメージそのものは更新されます。
