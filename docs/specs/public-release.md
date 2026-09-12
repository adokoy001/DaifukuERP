# Spec: GitHub初回公開の準備

- 作成: 2026-09-12
- 状態: approved（利用者の公開前準備指示。MIT公開・adokoy001表記を利用者が選択済み）
- branch: feat/public-release
- 起点: fd265f2
- 公開先: adokoy001/DaifukuERP（公開設定・初回空リポジトリ）

## 目的

初めて訪れた開発者が範囲と制約を理解して再現でき、秘密・私的データを誤配布せず、CIで継続検証できるソース公開を準備する。実運用サービスの公開は含まない。

## 受入基準

- AC-1: WHEN 公開候補を作る THE SYSTEM SHALL 追跡ファイル・全到達可能履歴・バイナリ/配布物・作者情報を検査し、秘密値を検査ログへ出さず、不要な個人情報や環境依存の配布物を公開候補から除く。原本履歴は保全する。
- AC-2: WHEN 初見の開発者がREADMEを読む THE SYSTEM SHALL 機能・実装範囲・必要環境・開発と導入の違い・手順・デモ限定資格情報・検証方法・文書索引を提供する。未検証の本番品質を断定しない。
- AC-3: WHEN 公開CIが実行される THE SYSTEM SHALL 読取最小権限、固定版依存、専用DBと安全なテストデータで型/lint/unit/DB/Web/build/E2Eを実施する。秘密不要でfork PRに対応し、危険なpull_request_target実行を追加しない。
- AC-4: WHEN 外部から変更や問題が報告される THE SYSTEM SHALL contribution/issue/PR手順、機密を公開Issueへ書かない脆弱性報告導線、保守対象を明示する。
- AC-5: WHEN ライセンスを付与する THE SYSTEM SHALL 利用者が選んだ条件と公開名で表記し、依存物や引用資産の帰属を確認する。未回答を許諾とみなさない。
- AC-6: WHEN GitHubへ初回公開する THE SYSTEM SHALL 点検済みの内容だけを指定リポジトリへ反映し、既存remote内容を強制上書きせず、到達したcommitとCI結果を確認する。実環境の秘密・DB・添付はアップロードしない。
- AC-7: WHEN APIを起動する THE SYSTEM SHALL HOST未指定を127.0.0.1とし、PORTを1〜65535の十進整数として検査する。productionまたは非loopback待受ではJWT_SECRETが32文字以上・8種類以上・既知開発値以外であることを要求し、改行・NULを含む秘密を拒否する。設定エラーと起動失敗のログに秘密値や接続URLを出さない。
- AC-8: WHEN ブラウザーがAPIへ接続する THE SYSTEM SHALL CORS_ORIGINSで明示したhttp(s) originだけを許可し、任意originの反射・ワイルドカードを許可しない。development/test未指定時のみlocalhost/127.0.0.1/[::1]の5173番を許可し、production未指定または明示空はcross-origin許可なしとする。設定の資格情報・path・query・fragmentは拒否する。CORSは認証を代替せず、同一originやCLIの既存JWT認証は維持する。

## 検証

現行/履歴のsecretと個人情報点検、依存監査・ライセンス一覧、README手順の専用環境再現、全pnpm gateとWeb/E2E、workflow静的検査、公開後GitHub commit/CI確認。修正は同一共有checkoutで担当ファイルを分離し、最終結果と制約をdocs/logへ残す。
