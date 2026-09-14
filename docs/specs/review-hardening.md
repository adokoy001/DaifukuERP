# Spec: review-hardening

- 状態: implemented
- 対象: kernel / API / Web / 配布
- 作成: 2026-09-14

## 目的

追加レビューで確認した認証のイベントループ阻害、拡張項目の検索索引不足、分析画面の非同期処理の検証不足、本番の実行時トランスパイルを改善する。既存アカウント・会社分離・安全な導入更新・クラウドとオンプレの同一配布物を保つ。

## 受入基準（EARS）

- AC-1: WHEN パスワードを登録・照合する THE SYSTEM SHALL 非同期scryptを使用し、処理並列数と待機数を制限し、保存形式に版と計算パラメーターを含める。
- AC-2: WHEN 旧形式の正しいパスワードで認証する THE SYSTEM SHALL 従来のsalt解釈で検証し、同時リセット・無効化を上書きしない条件付き更新で新形式へ移行する。誤ったパスワード、壊れた形式、過大パラメーターは拒否する。
- AC-3: WHEN packがextの完全一致索引を宣言する THE SYSTEM SHALL 全pack登録後のschemaからtenant/companyと内部生成列を使うB-tree索引を生成し、新規migrationに含める。検索値はバインドし、JANの先頭ゼロと既存データを保持する。
- AC-4: WHEN 分析の会社切替・応答順逆転・取得失敗からの復旧・保存待機中の選択変更が起きる THE SYSTEM SHALL 最新の対象と権限範囲だけを画面へ反映し、各重要分岐を回帰試験で検証する。
- AC-5: WHEN 本番用配布物を構築する THE SYSTEM SHALL APIをビルド済みJSで起動可能にし、スキーマ生成ツールを通常APIの依存グラフから分離する。既存のsetup、migration、readiness、制度JSON、manifestと復旧手順を維持する。

## 実装と検証

- 認証: kernelの認証・本人設定・MFA・招待・管理者・setup・MCPと全呼出箇所。旧形式互換、非同期呼出しの取りこぼし、競合、過負荷をunit/DBで検査する。
- ext: DSL/registry/table生成/pack/新migration。SQL生成とDBの索引定義・権限境界・実行計画を検査する。部分一致の高速化は実測と演算子に合う方式を別途選ぶ。
- Web: 既存のWorker単体と2タブ保存競合試験を維持し、実画面の重要な状態遷移を追加検査する。
- 配布: unit、生成profile、ビルド済みAPIとsetupのsmoke、固定manifestの配布物検査。
- 統合: `pnpm gate`、API/Web typecheckとbuild、対象Playwright、ドキュメントの更新。実施した検証と未検証を作業記録へ残す。

## スコープ外

- AWS試用環境の自動更新、実アカウントの一括リセット、業務データ変更。
- Cookie認証への全面切替。現在のタブ別アカウント契約を維持するサーバーセッション設計とCSRF/SSO/MFA横断検証が必要なため、移行設計をADRに記録する。
- 行数比率を目的とするテスト増量・ファイル分割、全extへの無差別GIN索引。

## 判断待ち

なし。ユーザーから価値と互換性に基づく自律判断の委任あり。
