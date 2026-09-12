# Third-party notices

DaifukuERP の独自コードは [MIT License](LICENSE) です。以下の第三者コード・データには、それぞれの権利者のライセンスが適用されます。本書は依存物を一括して MIT に変更するものではありません。

確認日: 2026-09-12。対象は `pnpm-lock.yaml` の公開準備版、pnpm 10.28.0、Linux x64 上のインストール結果です。`node_modules`・ブラウザバイナリ・ビルド成果物はソースリポジトリへ同梱していません。配布物に依存コードやバイナリを含める場合は、各パッケージの `LICENSE`、`NOTICE`、著作権表示も保持してください。

## ソースに含めたアイコン

[Feather Icons 4.29.2](https://github.com/feathericons/feather/tree/v4.29.2) の図形を `apps/web/src/components/icon.tsx` に取り込みました。Copyright (c) 2013-2023 Cole Bemis。MIT ライセンス全文は [vendor/feather/LICENSE](vendor/feather/LICENSE) に保持しています。

正式 npm 配布 `feather-icons@4.29.2` の `dist/icons/*.svg` を使用。図形座標は保持し、React JSX への変換、共通の線幅 1.7、サイズ指定、装飾用 `aria-hidden` を適用しています。npm パッケージ全体や JavaScript 実装は取り込んでいません。

| アプリ内名 | Feather 内名 |
| --- | --- |
| `calendar` | `calendar` |
| `home` | `home` |
| `document` | `file-text` |
| `chart` | `bar-chart-2` |
| `people` | `users` |
| `box` | `package` |
| `wallet` | `credit-card` |
| `settings` | `settings` |
| `arrow` | `arrow-right` |
| `plus` | `plus` |
| `check` | `check` |
| `clock` | `clock` |
| `menu` | `menu` |
| `close` | `x` |
| `search` | `search` |
| `logout` | `log-out` |

`appliance`、`leaf`、`dining`、`building`、`spark` はリポジトリ内の既存図形です。Feather からの取込対象ではありません。

## API ドキュメントの同梱資産

`@fastify/swagger-ui@6.1.1` 自体は MIT ですが、パッケージ内の Swagger UI は [swagger-ui-dist 5.32.6](https://github.com/swagger-api/swagger-ui/tree/v5.32.6)（Apache-2.0）です。Copyright 2020-2021 SmartBear Software Inc.。これらの静的資産は依存パッケージから `/docs` へ配信され、下記の pnpm 依存名一覧だけでは内包物を識別できません。

公式 `swagger-ui-dist@5.32.6` 配布の対応ファイルと、実際の plugin 内 `swagger-ui-bundle.js` / `swagger-ui-standalone-preset.js` が SHA-256 で一致することを確認しました。plugin 配布では省かれていた通知を、対応する上流配布からそのまま保存しています。

- [Apache-2.0 LICENSE](vendor/swagger-ui/LICENSE)
- [Swagger UI NOTICE](vendor/swagger-ui/NOTICE)
- [swagger-ui-bundle.js の第三者通知](vendor/swagger-ui/swagger-ui-bundle.js.LICENSE.txt)
- [swagger-ui-standalone-preset.js の第三者通知](vendor/swagger-ui/swagger-ui-standalone-preset.js.LICENSE.txt)

これらには React、DOMPurify、buffer、ieee754、js-yaml など内包コードの通知も含まれます。Swagger UI を単独で再配置するときも対応する通知を伴わせてください。名称・ロゴの記載は権利者による本プロジェクトへの推奨を示すものではありません。

## 画像・フォント・引用

確認した追跡対象の画像 48 点は `docs/manual/img` と `docs/log` 配下のアプリ操作スクリーンショットです。外部の写真素材・イラスト・アイコン画像ファイル、音声・動画、フォントバイナリは追跡対象にありません。CSS は OS のシステムフォントを参照しており、Web フォントのダウンロード設定はありません。フォント名の指定はフォントソフトウェアの同梱ではありません。

ドメイン文書の参照 URL は外部資料への参照です。リンク先の内容・商標・文書には各権利者の条件が適用されます。リンク先の全文をこのプロジェクトの MIT ライセンス対象とするものではありません。

## 依存ライセンスの確認方法と範囲

`pnpm licenses list --json`、`pnpm licenses list --prod --json`、`pnpm licenses list --dev --json` を公開準備版に対して実行しました。以下の件数はパッケージ名と宣言ライセンスの組の数です。同一ライセンスの異なる版・依存経路は合算され、版によってライセンスが異なる場合は別に数えます。prod と dev は重複します。これはブラウザへ取り込まれるコード量や運用中の到達可能性を表すものではありません。

| 宣言ライセンス | installed all | prod | dev |
| --- | ---: | ---: | ---: |
| MIT | 350 | 168 | 200 |
| Apache-2.0 | 22 | 4 | 19 |
| Python-2.0 | 1 | 0 | 1 |
| CC-BY-4.0 | 1 | 0 | 1 |
| ISC | 24 | 14 | 13 |
| BSD-2-Clause | 8 | 1 | 6 |
| BSD-3-Clause | 7 | 5 | 3 |
| BlueOak-1.0.0 | 5 | 5 | 1 |
| Unlicense | 2 | 2 | 0 |
| MPL-2.0 | 3 | 0 | 1 |

インストール一覧に出なかった lock 内のプラットフォーム別バイナリ等 139 件（名前と版の組）も、固定版の npm 公式レジストリメタデータで確認しました。宣言は MIT 100 件、Apache-2.0 21 件、MPL-2.0 18 件でした。下記一覧にはそれらも含みます。`tsc7` は `typescript@7.0.2` の npm alias です。第三者の宣言を収集したもので、全パッケージのソースを法務監査したものではありません。

個別に注意するデータ・ツール:

- `caniuse-lite` は [Can I use / Browserslist のデータ](https://github.com/browserslist/caniuse-lite)で、[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) です。ライブラリの独自 MIT コードと区別し、データを再配布する場合は出所・ライセンス・変更の表示を保持してください。本プロジェクトはデータを改変していません。
- `lightningcss` とその native パッケージは [MPL-2.0](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE) です。ビルドツールとして使用します。これらを再配布する際のソース提供条件・通知は [Mozilla の公式 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) を参照してください。
- `argparse` の `Python-2.0` はパッケージに [Python の歴史的なライセンス全文](https://github.com/nodeca/argparse/blob/master/LICENSE)を含みます。単に MIT として扱わず、その通知を保持してください。

以下は固定版の一覧です。`P` = prod 照会に含む、`D` = dev 照会に含む、`PD` = 両方、`A` = 無指定の installed 一覧だけ、`L` = lock から補完（この環境の照会では未掲載）。同じ名前・ライセンスで複数版があるときはまとめて表示し、P/D はその組に含まれる版のいずれかが該当する意味です。A/L は必ずしも本番未使用という意味ではありません。

`minimatch` と `lru-cache` は版によって MIT / BlueOak-1.0.0 が異なるため、両ライセンスの欄に掲載しています。

### Apache-2.0

- [@drizzle-team/brocli](https://github.com/drizzle-team/brocli) 0.10.2 (PD); [@eslint/config-array](https://github.com/eslint/rewrite/tree/main/packages/config-array#readme) 0.21.2 (D); [@eslint/config-helpers](https://github.com/eslint/rewrite/tree/main/packages/config-helpers#readme) 0.4.2 (D).
- [@eslint/core](https://github.com/eslint/rewrite/tree/main/packages/core#readme) 0.17.0 (D); [@eslint/object-schema](https://github.com/eslint/rewrite/tree/main/packages/object-schema#readme) 2.1.7 (D); [@eslint/plugin-kit](https://github.com/eslint/rewrite/tree/main/packages/plugin-kit#readme) 0.4.1 (D).
- [@humanfs/core](https://github.com/humanwhocodes/humanfs#readme) 0.19.2 (D); [@humanfs/node](https://github.com/humanwhocodes/humanfs#readme) 0.16.8 (D); [@humanfs/types](https://github.com/humanwhocodes/humanfs#readme) 0.15.0 (D).
- [@humanwhocodes/module-importer](https://github.com/humanwhocodes/module-importer#readme) 1.0.1 (D); [@humanwhocodes/retry](https://github.com/humanwhocodes/retry#readme) 0.4.3 (D); [@playwright/test](https://playwright.dev) 1.63.0 (D).
- [@typescript/typescript-aix-ppc64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-darwin-arm64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-darwin-x64](https://www.typescriptlang.org/) 7.0.2 (L).
- [@typescript/typescript-freebsd-arm64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-freebsd-x64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-linux-arm](https://www.typescriptlang.org/) 7.0.2 (L).
- [@typescript/typescript-linux-arm64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-linux-loong64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-linux-mips64el](https://www.typescriptlang.org/) 7.0.2 (L).
- [@typescript/typescript-linux-ppc64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-linux-riscv64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-linux-s390x](https://www.typescriptlang.org/) 7.0.2 (L).
- [@typescript/typescript-linux-x64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-netbsd-arm64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-netbsd-x64](https://www.typescriptlang.org/) 7.0.2 (L).
- [@typescript/typescript-openbsd-arm64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-openbsd-x64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-sunos-x64](https://www.typescriptlang.org/) 7.0.2 (L).
- [@typescript/typescript-win32-arm64](https://www.typescriptlang.org/) 7.0.2 (L); [@typescript/typescript-win32-x64](https://www.typescriptlang.org/) 7.0.2 (L); [baseline-browser-mapping](https://github.com/web-platform-dx/baseline-browser-mapping#readme) 2.11.21 (D).
- [detect-libc](https://github.com/lovell/detect-libc#readme) 2.1.2 (D); [drizzle-orm](https://orm.drizzle.team) 0.45.2 (P); [ecdsa-sig-formatter](https://github.com/Brightspace/node-ecdsa-sig-formatter#readme) 1.0.11 (P).
- [eslint-visitor-keys](https://github.com/eslint/js/blob/main/packages/eslint-visitor-keys/README.md) 3.4.3, 4.2.1, 5.0.1 (D); [expect-type](https://github.com/mmkal/expect-type#readme) 1.4.0 (D); [fast-jwt](https://github.com/nearform/fast-jwt) 6.3.3 (P).
- [playwright](https://playwright.dev) 1.63.0 (D); [playwright-core](https://playwright.dev) 1.63.0 (D); [typescript](https://www.typescriptlang.org/) 6.0.3, 7.0.2 (D).

### BSD-2-Clause

- [eslint-scope](https://github.com/eslint/js/blob/main/packages/eslint-scope/README.md) 8.4.0 (D); [espree](https://github.com/eslint/js/blob/main/packages/espree/README.md) 10.4.0 (D); [esrecurse](https://github.com/estools/esrecurse) 4.3.0 (D).
- [estraverse](https://github.com/estools/estraverse) 5.3.0 (D); [esutils](https://github.com/estools/esutils) 2.0.3 (D); [json-schema-typed](https://github.com/RemyRylan/json-schema-typed/tree/main/dist/node) 8.0.2 (P).
- [uglify-js](https://github.com/mishoo/UglifyJS#readme) 3.19.3 (A); [uri-js](https://github.com/garycourt/uri-js) 4.4.1 (D).

### BSD-3-Clause

- [esquery](https://github.com/estools/esquery/) 1.7.0 (D); [fast-uri](https://github.com/fastify/fast-uri) 3.1.7, 4.1.4 (P); [light-my-request](https://github.com/fastify/light-my-request#readme) 6.6.0 (P).
- [qs](https://github.com/ljharb/qs) 6.16.0 (P); [secure-json-parse](https://github.com/fastify/secure-json-parse#readme) 4.1.0 (P); [source-map](https://github.com/mozilla/source-map) 0.6.1 (PD).
- [source-map-js](https://github.com/7rulnik/source-map-js) 1.2.1 (D).

### BlueOak-1.0.0

- [glob](https://github.com/isaacs/node-glob#readme) 13.0.6 (P); [lru-cache](https://github.com/isaacs/node-lru-cache#readme) 11.5.2 (P); [minimatch](https://github.com/isaacs/minimatch#readme) 10.2.6 (PD).
- [minipass](https://github.com/isaacs/minipass#readme) 7.1.3 (P); [path-scurry](https://github.com/isaacs/path-scurry#readme) 2.0.2 (P).

### CC-BY-4.0

- [caniuse-lite](https://github.com/browserslist/caniuse-lite#readme) 1.0.30001810 (D).

### ISC

- [electron-to-chromium](https://github.com/Kilian/electron-to-chromium#readme) 1.5.426 (D); [fastparallel](https://github.com/mcollina/fastparallel) 2.4.1 (P); [fastq](https://github.com/mcollina/fastq#readme) 1.20.3 (P).
- [fastseries](https://github.com/mcollina/fastseries) 1.7.2 (P); [flatted](https://github.com/WebReflection/flatted#readme) 3.4.4 (D); [glob-parent](https://github.com/gulpjs/glob-parent#readme) 6.0.2 (D).
- [graceful-fs](https://github.com/isaacs/node-graceful-fs#readme) 4.2.11 (D); [inherits](https://github.com/isaacs/inherits#readme) 2.0.4 (P); [ini](https://github.com/npm/ini#readme) 4.1.1 (D).
- [isexe](https://github.com/isaacs/isexe#readme) 2.0.0 (PD); [lru-cache](https://github.com/isaacs/node-lru-cache#readme) 5.1.1 (D); [minimalistic-assert](https://github.com/calvinmetcalf/minimalistic-assert) 1.0.1 (P).
- [minimatch](https://github.com/isaacs/minimatch#readme) 3.1.5 (D); [once](https://github.com/isaacs/once#readme) 1.4.0 (P); [picocolors](https://github.com/alexeyraspopov/picocolors#readme) 1.1.1 (D).
- [semver](https://github.com/npm/node-semver#readme) 6.3.1, 7.8.5 (PD); [setprototypeof](https://github.com/wesleytodd/setprototypeof) 1.2.0 (P); [siginfo](https://github.com/emilbayes/siginfo#readme) 2.0.0 (D).
- [split2](https://github.com/mcollina/split2#readme) 4.2.0 (P); [which](https://github.com/isaacs/node-which#readme) 2.0.2 (PD); [wrappy](https://github.com/npm/wrappy) 1.0.2 (P).
- [yallist](https://github.com/isaacs/yallist#readme) 3.1.1 (D); [yaml](https://eemeli.org/yaml/) 2.9.0 (P); [zod-to-json-schema](https://github.com/StefanTerdell/zod-to-json-schema#readme) 3.25.2 (P).

### MIT

- [@babel/code-frame](https://babel.dev/docs/en/next/babel-code-frame) 7.29.7 (D); [@babel/compat-data](https://github.com/babel/babel#readme) 7.29.7 (D); [@babel/core](https://babel.dev/docs/en/next/babel-core) 7.29.7 (D).
- [@babel/generator](https://babel.dev/docs/en/next/babel-generator) 7.29.8 (D); [@babel/helper-compilation-targets](https://github.com/babel/babel#readme) 7.29.7 (D); [@babel/helper-globals](https://github.com/babel/babel#readme) 7.29.7 (D).
- [@babel/helper-module-imports](https://babel.dev/docs/en/next/babel-helper-module-imports) 7.29.7 (D); [@babel/helper-module-transforms](https://babel.dev/docs/en/next/babel-helper-module-transforms) 7.29.7 (D); [@babel/helper-plugin-utils](https://babel.dev/docs/en/next/babel-helper-plugin-utils) 7.29.7 (D).
- [@babel/helper-string-parser](https://babel.dev/docs/en/next/babel-helper-string-parser) 7.29.7 (D); [@babel/helper-validator-identifier](https://github.com/babel/babel#readme) 7.29.7 (D); [@babel/helper-validator-option](https://github.com/babel/babel#readme) 7.29.7 (D).
- [@babel/helpers](https://babel.dev/docs/en/next/babel-helpers) 7.29.7 (D); [@babel/parser](https://babel.dev/docs/en/next/babel-parser) 7.29.8 (D); [@babel/plugin-transform-react-jsx-self](https://babel.dev/docs/en/next/babel-plugin-transform-react-jsx-self) 7.29.7 (D).
- [@babel/plugin-transform-react-jsx-source](https://babel.dev/docs/en/next/babel-plugin-transform-react-jsx-source) 7.29.7 (D); [@babel/template](https://babel.dev/docs/en/next/babel-template) 7.29.7 (D); [@babel/traverse](https://babel.dev/docs/en/next/babel-traverse) 7.29.8 (D).
- [@babel/types](https://babel.dev/docs/en/next/babel-types) 7.29.8 (D); [@boundaries/elements](https://github.com/javierbrea/eslint-plugin-boundaries#readme) 3.1.1 (D); [@esbuild-kit/core-utils](https://github.com/esbuild-kit/core-utils#readme) 3.3.2 (PD).
- [@esbuild-kit/esm-loader](https://github.com/esbuild-kit/esm-loader#readme) 2.6.5 (PD); [@esbuild/aix-ppc64](https://github.com/evanw/esbuild#readme) 0.25.12, 0.28.2 (L); [@esbuild/android-arm](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@esbuild/android-arm64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/android-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/darwin-arm64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@esbuild/darwin-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/freebsd-arm64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/freebsd-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@esbuild/linux-arm](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/linux-arm64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/linux-ia32](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@esbuild/linux-loong64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/linux-mips64el](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/linux-ppc64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@esbuild/linux-riscv64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/linux-s390x](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/linux-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (P).
- [@esbuild/netbsd-arm64](https://github.com/evanw/esbuild#readme) 0.25.12, 0.28.2 (L); [@esbuild/netbsd-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/openbsd-arm64](https://github.com/evanw/esbuild#readme) 0.25.12, 0.28.2 (L).
- [@esbuild/openbsd-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/openharmony-arm64](https://github.com/evanw/esbuild#readme) 0.25.12, 0.28.2 (L); [@esbuild/sunos-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@esbuild/win32-arm64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/win32-ia32](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L); [@esbuild/win32-x64](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (L).
- [@eslint-community/eslint-utils](https://github.com/eslint-community/eslint-utils#readme) 4.10.1 (D); [@eslint-community/regexpp](https://github.com/eslint-community/regexpp#readme) 4.12.2 (D); [@eslint/eslintrc](https://github.com/eslint/eslintrc#readme) 3.3.7 (D).
- [@eslint/js](https://eslint.org) 9.39.5 (D); [@fastify/accept-negotiator](https://github.com/fastify/accept-negotiator#readme) 2.1.0 (P); [@fastify/ajv-compiler](https://github.com/fastify/ajv-compiler#readme) 4.0.6 (P).
- [@fastify/busboy](https://github.com/fastify/busboy#readme) 3.2.2 (P); [@fastify/cors](https://github.com/fastify/fastify-cors#readme) 11.3.0 (P); [@fastify/deepmerge](https://github.com/fastify/deepmerge#readme) 3.2.1 (P).
- [@fastify/error](https://github.com/fastify/fastify-error#readme) 4.2.0 (P); [@fastify/fast-json-stringify-compiler](https://github.com/fastify/fast-json-stringify-compiler#readme) 5.1.0 (P); [@fastify/forwarded](https://github.com/fastify/forwarded#readme) 3.0.2 (P).
- [@fastify/jwt](https://github.com/fastify/fastify-jwt#readme) 10.2.2 (P); [@fastify/merge-json-schemas](https://github.com/fastify/merge-json-schemas#readme) 0.2.1 (P); [@fastify/multipart](https://github.com/fastify/fastify-multipart#readme) 9.4.0 (P).
- [@fastify/proxy-addr](https://github.com/fastify/proxy-addr#readme) 5.1.0 (P); [@fastify/send](https://github.com/fastify/send#readme) 4.1.1 (P); [@fastify/static](https://github.com/fastify/fastify-static) 10.1.3 (P).
- [@fastify/swagger](https://github.com/fastify/fastify-swagger#readme) 9.8.1 (P); [@fastify/swagger-ui](https://github.com/fastify/fastify-swagger-ui#readme) 6.1.1 (P); [@hono/node-server](https://github.com/honojs/node-server) 2.1.1 (P).
- [@jridgewell/gen-mapping](https://github.com/jridgewell/sourcemaps/tree/main/packages/gen-mapping) 0.3.13 (D); [@jridgewell/remapping](https://github.com/jridgewell/sourcemaps/tree/main/packages/remapping) 2.3.5 (D); [@jridgewell/resolve-uri](https://github.com/jridgewell/resolve-uri#readme) 3.1.2 (D).
- [@jridgewell/sourcemap-codec](https://github.com/jridgewell/sourcemaps/tree/main/packages/sourcemap-codec) 1.6.0 (D); [@jridgewell/trace-mapping](https://github.com/jridgewell/sourcemaps/tree/main/packages/trace-mapping) 0.3.31 (D); [@lukeed/ms](https://github.com/lukeed/ms#readme) 2.0.2 (P).
- [@modelcontextprotocol/sdk](https://modelcontextprotocol.io) 1.30.0 (P); [@oxc-project/types](https://oxc.rs) 0.149.0 (D); [@pinojs/redact](https://github.com/pinojs/redact#readme) 0.4.0 (P).
- [@rolldown/binding-android-arm-eabi](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-android-arm64](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-darwin-arm64](https://rolldown.rs/) 1.2.8 (L).
- [@rolldown/binding-darwin-x64](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-freebsd-x64](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-linux-arm-gnueabihf](https://rolldown.rs/) 1.2.8 (L).
- [@rolldown/binding-linux-arm64-gnu](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-linux-arm64-musl](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-linux-ppc64-gnu](https://rolldown.rs/) 1.2.8 (L).
- [@rolldown/binding-linux-s390x-gnu](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-linux-x64-gnu](https://rolldown.rs/) 1.2.8 (A); [@rolldown/binding-linux-x64-musl](https://rolldown.rs/) 1.2.8 (A).
- [@rolldown/binding-openharmony-arm64](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-win32-arm64-msvc](https://rolldown.rs/) 1.2.8 (L); [@rolldown/binding-win32-x64-msvc](https://rolldown.rs/) 1.2.8 (L).
- [@rolldown/pluginutils](https://github.com/rolldown/plugins/tree/main/packages/pluginutils#readme) 1.0.0-rc.3, 1.0.1 (D); [@tailwindcss/node](https://tailwindcss.com) 4.3.3 (D); [@tailwindcss/oxide](https://github.com/tailwindlabs/tailwindcss#readme) 4.3.3 (D).
- [@tailwindcss/oxide-android-arm64](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-darwin-arm64](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-darwin-x64](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L).
- [@tailwindcss/oxide-freebsd-x64](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-linux-arm-gnueabihf](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-linux-arm64-gnu](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L).
- [@tailwindcss/oxide-linux-arm64-musl](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-linux-x64-gnu](https://github.com/tailwindlabs/tailwindcss#readme) 4.3.3 (A); [@tailwindcss/oxide-linux-x64-musl](https://github.com/tailwindlabs/tailwindcss#readme) 4.3.3 (A).
- [@tailwindcss/oxide-wasm32-wasi](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-win32-arm64-msvc](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L); [@tailwindcss/oxide-win32-x64-msvc](https://github.com/tailwindlabs/tailwindcss) 4.3.3 (L).
- [@tailwindcss/vite](https://tailwindcss.com) 4.3.3 (D); [@tanstack/history](https://tanstack.com/router) 1.162.3 (P); [@tanstack/query-core](https://tanstack.com/query) 5.102.8 (P).
- [@tanstack/react-query](https://tanstack.com/query) 5.102.8 (P); [@tanstack/react-router](https://tanstack.com/router) 1.170.34 (P); [@tanstack/react-store](https://tanstack.com/store) 0.11.1, 0.9.3 (P).
- [@tanstack/react-table](https://tanstack.com/table) 9.2.4 (P); [@tanstack/router-core](https://tanstack.com/router) 1.171.29 (P); [@tanstack/store](https://tanstack.com/store) 0.11.1, 0.9.3 (P).
- [@tanstack/table-core](https://tanstack.com/table) 9.2.4 (P); [@turbo/darwin-64](https://turborepo.dev) 2.10.12 (L); [@turbo/darwin-arm64](https://turborepo.dev) 2.10.12 (L).
- [@turbo/linux-64](https://turborepo.dev) 2.10.12 (A); [@turbo/linux-arm64](https://turborepo.dev) 2.10.12 (L); [@turbo/windows-64](https://turborepo.dev) 2.10.12 (L).
- [@turbo/windows-arm64](https://turborepo.dev) 2.10.12 (L); [@types/babel__core](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/babel__core) 7.20.5 (D); [@types/babel__generator](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/babel__generator) 7.27.0 (D).
- [@types/babel__template](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/babel__template) 7.4.4 (D); [@types/babel__traverse](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/babel__traverse) 7.28.0 (D); [@types/chai](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/chai) 5.2.3 (D).
- [@types/deep-eql](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/deep-eql) 4.0.2 (D); [@types/estree](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/estree) 1.0.9 (D); [@types/json-schema](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/json-schema) 7.0.15 (D).
- [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) 22.20.2 (D); [@types/react](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) 19.3.0 (D); [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) 19.3.0 (D).
- [@typescript-eslint/eslint-plugin](https://typescript-eslint.io/packages/eslint-plugin) 8.70.0 (D); [@typescript-eslint/parser](https://typescript-eslint.io/packages/parser) 8.70.0 (D); [@typescript-eslint/project-service](https://typescript-eslint.io) 8.70.0 (D).
- [@typescript-eslint/scope-manager](https://typescript-eslint.io/packages/scope-manager) 8.70.0 (D); [@typescript-eslint/tsconfig-utils](https://typescript-eslint.io) 8.70.0 (D); [@typescript-eslint/type-utils](https://typescript-eslint.io) 8.70.0 (D).
- [@typescript-eslint/types](https://typescript-eslint.io) 8.70.0 (D); [@typescript-eslint/typescript-estree](https://typescript-eslint.io/packages/typescript-estree) 8.70.0 (D); [@typescript-eslint/utils](https://typescript-eslint.io/packages/utils) 8.70.0 (D).
- [@typescript-eslint/visitor-keys](https://typescript-eslint.io) 8.70.0 (D); [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#readme) 5.2.0 (D); [@vitest/mocker](https://github.com/vitest-dev/vitest/tree/main/packages/mocker) 5.0.0 (D).
- [@vitest/spy](https://vitest.dev/api/mock) 5.0.0 (D); [abstract-logging](https://github.com/jsumners/abstract-logging#readme) 2.0.1 (P); [accepts](https://github.com/jshttp/accepts#readme) 2.0.0 (P).
- [acorn](https://github.com/acornjs/acorn) 8.18.0 (D); [acorn-jsx](https://github.com/acornjs/acorn-jsx) 5.3.2 (D); [acorn-jsx-walk](https://github.com/sderosiaux/acorn-jsx-walk#readme) 2.0.0 (D).
- [acorn-loose](https://github.com/acornjs/acorn) 8.5.2 (D); [acorn-walk](https://github.com/acornjs/acorn) 8.3.5 (D); [ajv](https://ajv.js.org) 6.15.0, 8.20.0 (PD).
- [ajv-formats](https://github.com/ajv-validator/ajv-formats#readme) 3.0.1 (P); [ansi-styles](https://github.com/chalk/ansi-styles#readme) 4.3.0 (D); [asn1.js](https://github.com/indutny/asn1.js) 5.4.1 (P).
- [assertion-error](https://github.com/chaijs/assertion-error#readme) 2.0.1 (D); [atomic-sleep](https://github.com/davidmarkclements/atomic-sleep#readme) 1.0.0 (P); [avvio](https://github.com/fastify/avvio#readme) 9.3.0 (P).
- [balanced-match](https://github.com/juliangruber/balanced-match#readme) 1.0.2, 4.0.4 (PD); [bn.js](https://github.com/indutny/bn.js) 4.12.5 (P); [body-parser](https://github.com/expressjs/body-parser#readme) 2.3.0 (P).
- [brace-expansion](https://github.com/juliangruber/brace-expansion#readme) 1.1.18, 5.0.9 (PD); [braces](https://github.com/micromatch/braces) 3.0.3 (D); [browserslist](https://github.com/browserslist/browserslist#readme) 4.28.9 (D).
- [buffer-from](https://github.com/LinusU/buffer-from#readme) 1.1.2 (PD); [bytes](https://github.com/visionmedia/bytes.js#readme) 3.1.2 (P); [call-bind-apply-helpers](https://github.com/ljharb/call-bind-apply-helpers#readme) 1.0.2 (P).
- [call-bound](https://github.com/ljharb/call-bound#readme) 1.0.4 (P); [callsites](https://github.com/sindresorhus/callsites#readme) 3.1.0 (D); [chai](http://chaijs.com) 6.2.2 (D).
- [chalk](https://github.com/chalk/chalk#readme) 4.1.2 (D); [color-convert](https://github.com/Qix-/color-convert#readme) 2.0.1 (D); [color-name](https://github.com/colorjs/color-name) 1.1.4 (D).
- [commander](https://github.com/tj/commander.js#readme) 15.0.0 (D); [concat-map](https://github.com/substack/node-concat-map#readme) 0.0.1 (D); [content-disposition](https://github.com/jshttp/content-disposition#readme) 1.1.0, 2.0.1 (P).
- [content-type](https://github.com/jshttp/content-type#readme) 1.0.5, 2.1.0 (P); [convert-source-map](https://github.com/thlorenz/convert-source-map) 2.0.0 (D); [cookie](https://github.com/jshttp/cookie#readme) 0.7.2, 1.1.1 (P).
- [cookie-es](https://github.com/unjs/cookie-es#readme) 3.1.1 (P); [cookie-signature](https://github.com/visionmedia/node-cookie-signature#readme) 1.2.2 (P); [cors](https://github.com/expressjs/cors#readme) 2.8.6 (P).
- [cross-spawn](https://github.com/moxystudio/node-cross-spawn) 7.0.6 (PD); [csstype](https://github.com/frenic/csstype#readme) 3.2.3 (D); [debug](https://github.com/debug-js/debug#readme) 3.2.7, 4.4.3 (PD).
- [decimal.js](https://github.com/MikeMcl/decimal.js#readme) 10.6.0 (P); [deep-is](https://github.com/thlorenz/deep-is#readme) 0.1.4 (D); [depd](https://github.com/dougwilson/nodejs-depd#readme) 2.0.0 (P).
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 18.2.0 (D); [dequal](https://github.com/lukeed/dequal#readme) 2.0.3 (P); [drizzle-kit](https://orm.drizzle.team) 0.31.10 (PD).
- [dunder-proto](https://github.com/es-shims/dunder-proto#readme) 1.0.1 (P); [ee-first](https://github.com/jonathanong/ee-first#readme) 1.1.1 (P); [encodeurl](https://github.com/pillarjs/encodeurl#readme) 2.0.0 (P).
- [enhanced-resolve](https://github.com/webpack/enhanced-resolve#readme) 5.24.5 (D); [es-define-property](https://github.com/ljharb/es-define-property#readme) 1.0.1 (P); [es-errors](https://github.com/ljharb/es-errors#readme) 1.3.0 (PD).
- [es-module-lexer](https://github.com/guybedford/es-module-lexer#readme) 2.3.2 (D); [es-object-atoms](https://github.com/ljharb/es-object-atoms#readme) 1.1.2 (P); [esbuild](https://github.com/evanw/esbuild#readme) 0.18.20, 0.25.12, 0.28.2 (PD).
- [escalade](https://github.com/lukeed/escalade#readme) 3.2.0 (D); [escape-html](https://github.com/component/escape-html#readme) 1.0.3 (P); [escape-string-regexp](https://github.com/sindresorhus/escape-string-regexp#readme) 4.0.0 (D).
- [eslint](https://eslint.org) 9.39.5 (D); [eslint-import-resolver-node](https://github.com/import-js/eslint-plugin-import) 0.3.9 (D); [eslint-module-utils](https://github.com/import-js/eslint-plugin-import#readme) 2.12.1 (D).
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries#readme) 7.2.0 (D); [estree-walker](https://github.com/Rich-Harris/estree-walker#readme) 3.0.3 (D); [etag](https://github.com/jshttp/etag#readme) 1.8.1 (P).
- [eventsource](https://github.com/EventSource/eventsource#readme) 3.0.7 (P); [eventsource-parser](https://github.com/rexxars/eventsource-parser#readme) 3.1.1 (P); [express](https://expressjs.com/) 5.2.1 (P).
- [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) 8.7.0 (P); [fast-check](https://fast-check.dev/) 4.9.0 (D); [fast-decode-uri-component](https://github.com/delvedor/fast-decode-uri-component#readme) 1.0.1 (P).
- [fast-deep-equal](https://github.com/epoberezkin/fast-deep-equal#readme) 3.1.3 (PD); [fast-json-stable-stringify](https://github.com/epoberezkin/fast-json-stable-stringify) 2.1.0 (D); [fast-json-stringify](https://github.com/fastify/fast-json-stringify#readme) 7.0.1 (P).
- [fast-levenshtein](https://github.com/hiddentao/fast-levenshtein#readme) 2.0.6 (D); [fast-querystring](https://github.com/anonrig/fast-querystring#readme) 1.1.2 (P); [fastfall](https://github.com/mcollina/fastfall#readme) 1.5.1 (P).
- [fastify](https://fastify.dev/) 5.12.3 (P); [fastify-plugin](https://github.com/fastify/fastify-plugin#readme) 5.1.0, 6.0.0 (P); [fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod) 7.0.0 (P).
- [fdir](https://github.com/thecodrr/fdir#readme) 6.5.0 (D); [file-entry-cache](https://github.com/jaredwray/file-entry-cache#readme) 8.0.0 (D); [fill-range](https://github.com/jonschlinkert/fill-range) 7.1.1 (D).
- [finalhandler](https://github.com/pillarjs/finalhandler#readme) 2.1.1 (P); [find-my-way](https://github.com/delvedor/find-my-way#readme) 9.9.0 (P); [find-up](https://github.com/sindresorhus/find-up#readme) 5.0.0 (D).
- [flat-cache](https://github.com/jaredwray/flat-cache#readme) 4.0.1 (D); [forwarded](https://github.com/jshttp/forwarded#readme) 0.2.0 (P); [fresh](https://github.com/jshttp/fresh#readme) 2.0.0 (P).
- [fsevents](https://github.com/fsevents/fsevents) 2.3.3 (L); [function-bind](https://github.com/Raynos/function-bind) 1.1.2 (PD); [gensync](https://github.com/loganfsmyth/gensync) 1.0.0-beta.2 (D).
- [get-intrinsic](https://github.com/ljharb/get-intrinsic#readme) 1.3.0 (P); [get-proto](https://github.com/ljharb/get-proto#readme) 1.0.1 (P); [get-tsconfig](https://github.com/privatenumber/get-tsconfig#readme) 4.14.3 (PD).
- [global-directory](https://github.com/sindresorhus/global-directory#readme) 4.0.1 (D); [globals](https://github.com/sindresorhus/globals#readme) 14.0.0 (D); [gopd](https://github.com/ljharb/gopd#readme) 1.2.0 (P).
- [handlebars](https://handlebarsjs.com/) 4.7.9 (D); [has-flag](https://github.com/sindresorhus/has-flag#readme) 4.0.0 (D); [has-symbols](https://github.com/ljharb/has-symbols#readme) 1.1.0 (P).
- [hasown](https://github.com/inspect-js/hasOwn#readme) 2.0.4 (PD); [hono](https://hono.dev) 4.13.7 (P); [http-errors](https://github.com/jshttp/http-errors#readme) 2.0.1 (P).
- [iconv-lite](https://github.com/pillarjs/iconv-lite) 0.7.3 (P); [ignore](https://github.com/kaelzhang/node-ignore#readme) 5.3.2, 7.0.6, 7.0.9 (D); [import-fresh](https://github.com/sindresorhus/import-fresh#readme) 3.3.1 (D).
- [imurmurhash](https://github.com/jensyt/imurmurhash-js) 0.1.4 (D); [interpret](https://github.com/gulpjs/interpret#readme) 3.1.1 (D); [ip-address](https://github.com/beaugunderson/ip-address#readme) 10.7.0 (P).
- [ipaddr.js](https://github.com/whitequark/ipaddr.js#readme) 1.9.1, 2.5.0 (P); [is-core-module](https://github.com/inspect-js/is-core-module) 2.16.1, 2.16.2 (D); [is-extglob](https://github.com/jonschlinkert/is-extglob) 2.1.1 (D).
- [is-glob](https://github.com/micromatch/is-glob) 4.0.3 (D); [is-installed-globally](https://github.com/sindresorhus/is-installed-globally#readme) 1.0.0 (D); [is-number](https://github.com/jonschlinkert/is-number) 7.0.0 (D).
- [is-path-inside](https://github.com/sindresorhus/is-path-inside#readme) 4.0.0 (D); [is-promise](https://github.com/then/is-promise#readme) 4.0.0 (P); [jiti](https://github.com/unjs/jiti#readme) 2.7.0 (D).
- [jose](https://github.com/panva/jose) 6.2.12 (P); [js-tokens](https://github.com/lydell/js-tokens#readme) 4.0.0 (D); [js-yaml](https://github.com/nodeca/js-yaml#readme) 4.3.2 (D).
- [jsesc](https://mths.be/jsesc) 3.1.0 (D); [json-buffer](https://github.com/dominictarr/json-buffer) 3.0.1 (D); [json-schema-ref-resolver](https://github.com/fastify/json-schema-ref-resolver#readme) 3.0.0 (P).
- [json-schema-resolver](https://github.com/Eomm/json-schema-resolver#readme) 3.0.0 (P); [json-schema-traverse](https://github.com/epoberezkin/json-schema-traverse#readme) 0.4.1, 1.0.0 (PD); [json-stable-stringify-without-jsonify](https://github.com/samn/json-stable-stringify) 1.0.1 (D).
- [json5](http://json5.org/) 2.2.3 (D); [keyv](https://github.com/jaredwray/keyv) 4.5.4 (D); [kleur](https://github.com/lukeed/kleur#readme) 3.0.3 (D).
- [levn](https://github.com/gkz/levn) 0.4.1 (D); [locate-path](https://github.com/sindresorhus/locate-path#readme) 6.0.0 (D); [lodash.merge](https://lodash.com/) 4.6.2 (D).
- [magic-string](https://github.com/Rich-Harris/magic-string#readme) 0.30.21, 1.3.1 (D); [math-intrinsics](https://github.com/es-shims/math-intrinsics#readme) 1.1.0 (P); [media-typer](https://github.com/jshttp/media-typer#readme) 1.1.1 (P).
- [merge-descriptors](https://github.com/sindresorhus/merge-descriptors#readme) 2.0.0 (P); [micromatch](https://github.com/micromatch/micromatch) 4.0.8 (D); [mime](https://github.com/broofa/mime#readme) 3.0.0 (P).
- [mime-db](https://github.com/jshttp/mime-db#readme) 1.54.0 (P); [mime-types](https://github.com/jshttp/mime-types#readme) 3.0.2 (P); [minimist](https://github.com/minimistjs/minimist) 1.2.8 (D).
- [mnemonist](https://github.com/yomguithereal/mnemonist#readme) 0.40.4 (P); [ms](https://github.com/vercel/ms#readme) 2.1.3 (PD); [nanoid](https://github.com/ai/nanoid#readme) 3.3.18 (D).
- [natural-compare](https://github.com/litejs/natural-compare-lite#readme) 1.4.0 (D); [negotiator](https://github.com/jshttp/negotiator#readme) 1.1.0 (P); [neo-async](https://github.com/suguru03/neo-async) 2.6.2 (D).
- [node-releases](https://github.com/chicoxyzzy/node-releases#readme) 2.0.55 (D); [object-assign](https://github.com/sindresorhus/object-assign#readme) 4.1.1 (P); [object-inspect](https://github.com/inspect-js/object-inspect) 1.13.4 (P).
- [obliterator](https://github.com/yomguithereal/obliterator#readme) 2.0.5 (P); [obug](https://github.com/sxzz/obug#readme) 2.2.1 (D); [on-exit-leak-free](https://github.com/mcollina/on-exit-or-gc#readme) 2.1.2 (P).
- [on-finished](https://github.com/jshttp/on-finished#readme) 2.4.1 (P); [openapi-types](https://github.com/kogosoftwarellc/open-api/tree/master/packages/openapi-types#readme) 12.1.3 (P); [optionator](https://github.com/gkz/optionator) 0.9.4 (D).
- [p-limit](https://github.com/sindresorhus/p-limit#readme) 3.1.0 (D); [p-locate](https://github.com/sindresorhus/p-locate#readme) 5.0.0 (D); [parent-module](https://github.com/sindresorhus/parent-module#readme) 1.0.1 (D).
- [parseurl](https://github.com/pillarjs/parseurl#readme) 1.3.3 (P); [path-exists](https://github.com/sindresorhus/path-exists#readme) 4.0.0 (D); [path-key](https://github.com/sindresorhus/path-key#readme) 3.1.1 (PD).
- [path-parse](https://github.com/jbgutierrez/path-parse#readme) 1.0.7 (D); [path-to-regexp](https://github.com/pillarjs/path-to-regexp#readme) 8.4.2 (P); [picomatch](https://github.com/micromatch/picomatch) 2.3.2, 4.0.5, 4.0.7 (D).
- [pino](https://getpino.io) 10.3.1 (P); [pino-abstract-transport](https://github.com/pinojs/pino-abstract-transport#readme) 3.0.0 (P); [pino-std-serializers](https://github.com/pinojs/pino-std-serializers#readme) 7.1.0 (P).
- [pkce-challenge](https://github.com/crouchcd/pkce-challenge#readme) 5.0.1 (P); [postcss](https://postcss.org/) 8.5.28 (D); [prelude-ls](http://preludels.com) 1.2.1 (D).
- [process-warning](https://github.com/fastify/fastify-warning#readme) 4.0.1, 5.1.0 (P); [prompts](https://github.com/terkelg/prompts#readme) 2.4.2 (D); [proxy-addr](https://github.com/jshttp/proxy-addr#readme) 2.0.7 (P).
- [punycode](https://mths.be/punycode) 2.3.1 (D); [pure-rand](https://github.com/dubzzz/pure-rand#readme) 8.4.2 (D); [quick-format-unescaped](https://github.com/davidmarkclements/quick-format#readme) 4.0.4 (P).
- [range-parser](https://github.com/jshttp/range-parser#readme) 1.3.0 (P); [raw-body](https://github.com/stream-utils/raw-body#readme) 3.0.2 (P); [react](https://react.dev/) 19.3.0 (P).
- [react-dom](https://react.dev/) 19.3.0 (P); [react-refresh](https://react.dev/) 0.18.0 (D); [real-require](https://github.com/pinojs/real-require) 0.2.0, 1.0.0 (P).
- [rechoir](https://github.com/gulpjs/rechoir#readme) 0.8.0 (D); [regexp-tree](https://github.com/DmitrySoshnikov/regexp-tree) 0.1.27 (D); [require-from-string](https://github.com/floatdrop/require-from-string#readme) 2.0.2 (P).
- [resolve](https://github.com/browserify/resolve#readme) 1.22.12 (D); [resolve-from](https://github.com/sindresorhus/resolve-from#readme) 4.0.0 (D); [resolve-pkg-maps](https://github.com/privatenumber/resolve-pkg-maps#readme) 1.0.0 (PD).
- [ret](https://github.com/fent/ret.js#readme) 0.5.0 (P); [reusify](https://github.com/mcollina/reusify#readme) 1.1.0 (P); [rfdc](https://github.com/davidmarkclements/rfdc#readme) 1.4.1 (P).
- [rolldown](https://rolldown.rs/) 1.2.8 (D); [router](https://github.com/pillarjs/router#readme) 2.2.0 (P); [safe-buffer](https://github.com/feross/safe-buffer) 5.2.1 (P).
- [safe-regex](https://github.com/davisjam/safe-regex) 2.1.1 (D); [safe-regex2](https://github.com/fastify/safe-regex2) 5.1.1 (P); [safe-stable-stringify](https://github.com/BridgeAR/safe-stable-stringify#readme) 2.5.0 (P).
- [safer-buffer](https://github.com/ChALkeR/safer-buffer#readme) 2.1.2 (P); [scheduler](https://react.dev/) 0.28.0 (P); [send](https://github.com/pillarjs/send#readme) 1.2.1 (P).
- [seroval](https://github.com/lxsmnsyc/seroval/tree/main/packages/seroval) 1.6.7 (P); [seroval-plugins](https://github.com/lxsmnsyc/seroval/tree/main/packages/plugins) 1.6.7 (P); [serve-static](https://github.com/expressjs/serve-static#readme) 2.2.1 (P).
- [set-cookie-parser](https://github.com/nfriedly/set-cookie-parser) 2.7.2 (P); [shebang-command](https://github.com/kevva/shebang-command#readme) 2.0.0 (PD); [shebang-regex](https://github.com/sindresorhus/shebang-regex#readme) 3.0.0 (PD).
- [side-channel](https://github.com/ljharb/side-channel#readme) 1.1.1 (P); [side-channel-list](https://github.com/ljharb/side-channel-list#readme) 1.0.1 (P); [side-channel-map](https://github.com/ljharb/side-channel-map#readme) 1.0.1 (P).
- [side-channel-weakmap](https://github.com/ljharb/side-channel-weakmap#readme) 1.0.2 (P); [sisteransi](https://github.com/terkelg/sisteransi#readme) 1.0.5 (D); [sonic-boom](https://github.com/pinojs/sonic-boom#readme) 4.2.1 (P).
- [source-map-support](https://github.com/evanw/node-source-map-support#readme) 0.5.21 (PD); [stackback](https://github.com/shtylman/node-stackback#readme) 0.0.2 (D); [statuses](https://github.com/jshttp/statuses#readme) 2.0.2 (P).
- [std-env](https://github.com/unjs/std-env#readme) 4.2.0 (D); [steed](https://github.com/mcollina/steed#readme) 1.1.3 (P); [strip-bom](https://github.com/sindresorhus/strip-bom#readme) 3.0.0 (D).
- [strip-json-comments](https://github.com/sindresorhus/strip-json-comments#readme) 3.1.1 (D); [supports-color](https://github.com/chalk/supports-color#readme) 7.2.0 (D); [supports-preserve-symlinks-flag](https://github.com/inspect-js/node-supports-preserve-symlinks-flag#readme) 1.0.0 (D).
- [tailwindcss](https://tailwindcss.com) 4.3.3 (D); [tapable](https://github.com/webpack/tapable) 2.3.3 (D); [thread-stream](https://github.com/mcollina/thread-stream#readme) 4.2.0 (P).
- [tinybench](https://github.com/tinylibs/tinybench#readme) 6.1.4 (D); [tinyexec](https://github.com/tinylibs/tinyexec#readme) 1.3.0 (D); [tinyglobby](https://superchupu.dev/tinyglobby) 0.2.17 (D).
- [to-regex-range](https://github.com/micromatch/to-regex-range) 5.0.1 (D); [toad-cache](https://github.com/kibertoad/toad-cache) 3.7.4 (P); [toidentifier](https://github.com/component/toidentifier#readme) 1.0.1 (P).
- [ts-api-utils](https://github.com/JoshuaKGoldberg/ts-api-utils#readme) 2.5.0 (D); [tsconfig-paths](https://github.com/dividab/tsconfig-paths#readme) 4.2.0 (D); [tsconfig-paths-webpack-plugin](https://github.com/dividab/tsconfig-paths-webpack-plugin#readme) 4.2.0 (D).
- [tsx](https://tsx.hirok.io) 4.23.13 (PD); [turbo](https://turborepo.dev) 2.10.12 (D); [type-check](https://github.com/gkz/type-check) 0.4.0 (D).
- [type-is](https://github.com/jshttp/type-is#readme) 2.1.0 (P); [typescript-eslint](https://typescript-eslint.io/packages/typescript-eslint) 8.70.0 (D); [undici-types](https://undici.nodejs.org) 6.21.0 (D).
- [unpipe](https://github.com/stream-utils/unpipe#readme) 1.0.0 (P); [update-browserslist-db](https://github.com/browserslist/update-db#readme) 1.3.2 (D); [use-sync-external-store](https://github.com/react/react#readme) 1.7.0 (P).
- [uuid](https://github.com/uuidjs/uuid#readme) 14.0.2 (P); [vary](https://github.com/jshttp/vary#readme) 1.1.2 (P); [vite](https://vite.dev) 8.3.0 (D).
- [vitest](https://vitest.dev) 5.0.0 (D); [watskeburt](https://github.com/sverweij/watskeburt) 6.0.0 (D); [why-is-node-running](https://github.com/mafintosh/why-is-node-running) 2.3.0 (D).
- [word-wrap](https://github.com/jonschlinkert/word-wrap) 1.2.5 (D); [wordwrap](https://github.com/substack/node-wordwrap#readme) 1.0.0 (D); [xtend](https://github.com/Raynos/xtend) 4.0.2 (P).
- [yocto-queue](https://github.com/sindresorhus/yocto-queue#readme) 0.1.0 (D); [zod](https://zod.dev) 4.6.1 (P).

### MPL-2.0

- [lightningcss](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (D); [lightningcss-android-arm64](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L); [lightningcss-darwin-arm64](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L).
- [lightningcss-darwin-x64](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L); [lightningcss-freebsd-x64](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L); [lightningcss-linux-arm-gnueabihf](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L).
- [lightningcss-linux-arm64-gnu](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L); [lightningcss-linux-arm64-musl](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L); [lightningcss-linux-x64-gnu](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (A).
- [lightningcss-linux-x64-musl](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (A); [lightningcss-win32-arm64-msvc](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L); [lightningcss-win32-x64-msvc](https://github.com/parcel-bundler/lightningcss#readme) 1.32.0, 1.33.0 (L).

### Python-2.0

- [argparse](https://github.com/nodeca/argparse#readme) 2.0.1 (D).

### Unlicense

- [isbot](https://isbot.js.org) 5.2.2 (P); [postgres](https://github.com/porsager/postgres) 3.4.9 (P).
