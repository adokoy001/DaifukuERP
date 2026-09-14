# Spec: release-finishing

- 状態: implemented（ローカル受入は作業記録、最終commitの全gate/CIは対象PRのChecksを参照）
- 対象: deploy / modules/accounting / ソース・公開文書
- 作成: 2026-09-14
- 関連: [配備](deployment-edge.md)、[認証補強](review-hardening.md)、[ソース一貫性](source-consistency.md)

## 目的

追加レビューを現在のソースと照合し、配布時のブラウザ保護と仕訳転記の不要な照会を補強する。
既に実装したパスワード方式を重複して作り直さず、業務規則・権限・監査を保つ。
多業種の共通基盤という方針と、本部・店舗運営で具体的に試せる範囲、未検証範囲を区別する。

## 受入基準（EARS）

- AC-1: WHEN cloud/onprem の参照profileを生成する THE SYSTEM SHALL CSPと関連するブラウザ保護ヘッダーを付与し、許可しないスクリプト実行・外部接続・埋込を拒否する。既存のTLS・転送元・キャッシュ契約は維持する。
- AC-2: WHEN 本番Webを当該profileで配信する THE SYSTEM SHALL ログイン、同一origin API、深いURL、Worker計算、添付/出力とSSOの必要な経路を維持する。ポリシーの例外は具体的な利用箇所と検証に対応させる。
- AC-3: WHEN 多明細の仕訳を転記する THE SYSTEM SHALL 同じ勘定の検証を不要に反復せず、照会増加を測定する。貸借・日付・会社/tenant境界・権限・取消・監査・原子性は従来と同じにする。行の作成と監査に必要なDB書込を、照会の削減と混同しない。
- AC-4: IF 管理対象のテキストソースに実NULバイトが存在する THEN THE SYSTEM SHALL 必要な実行時の文字を明示的なエスケープとして保ち、通常の検索・差分表示を可能にする。画像等のバイナリとNUL拒否テストの意味は変えない。
- AC-5: WHEN 既存のパスワード実装を評価する THE SYSTEM SHALL 非同期・コスト付き形式・旧形式検証/更新・負荷上限の現行実装と試験を確認し、未実装という古い指摘と区別する。
- AC-5a: IF setupに認証基盤の上限200文字を超えるパスワードを渡す THEN THE SYSTEM SHALL backup・migrationより前の入力検査で拒否する。setupの下限16文字と既存認証の最大200文字を保つ。
- AC-6: WHEN 公開文書を読む THE SYSTEM SHALL 対応する会社/店舗業務、業界拡張の目的、実運用・第三者による拡張の未検証範囲を判断できる。実施していない人間による引継ぎを検証済みとは記載しない。

## 実装範囲と境界

- 配備: `deploy/profile.mjs` と関連する配布・ブラウザ受入試験。開発用Viteの別origin構成を本番profileの許可リストへ混在させない。
- 会計: `modules/accounting/src` の実際の転記経路とDB回帰試験。最適化の具体的単位は現行の権限・lock・extension hookを確認して決める。
- テキスト: Git管理対象の実バイト検査で確認したファイルのみ。無意味な大量整形を行わない。
- 認証: `apps/api/src/setup/credentials.ts` の上限を既存認証契約へ揃える。ハッシュ方式・保存済みハッシュを変更しない。
- 説明: README / STATUS / 該当運用手順 / 作業記録 / AI_INDEX。

## スコープ外

- 新しい業界pack、製品方針のチェーン専用への変更、第三者が使えたという未実施の主張。
- Cookie認証への移行、IdPや銀行の本番接続、一般的な一括INSERT portの追加。
- AWS試用環境の更新、DBへの本番移行、既存PRのマージ。
- 負荷上限や本番容量の認定。照会数と限定した測定を、同時利用の性能保証にしない。

## 検証手順

1. CSP: 両profileの生成・実Caddy検証、ブラウザで許可経路と拒否経路を確認する。生成文字列だけを実配信の証拠にしない。
2. 会計: 修正前後の照会数を同一の合成入力で比較し、別会社・権限外・不正勘定、失敗時rollback、取消の既存試験を実行する。
3. NUL: 管理対象のテキストを再検査し、修正箇所の既存試験を実行する。
4. `pnpm gate` とAPI/Web/edgeのbuild、通常/認証ブラウザ、setup、既存の独立CIを最終commitで確認する。
5. 独立レビューで権限・CSPの必要な例外・テストの意味を確認する。測定と静的レビュー、未検証範囲を作業記録に分ける。

## 参考資料

- [Caddy header](https://caddyserver.com/docs/caddyfile/directives/header)（確認: 2026-09-14）
- [Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)（確認: 2026-09-14）
