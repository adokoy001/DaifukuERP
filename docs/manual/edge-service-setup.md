# 付録 K 店舗エッジサービスのセットアップ

店舗LAN内の1台を常駐中継にします。ERPの設置先はクラウドでもオンプレミスでも同じです。
端末からERPへHTTPS/WSS接続を開始するため、店舗ルーターのポート開放は不要です。
通知は仕事があることだけを伝え、仕事本体は認証付きHTTPSで取得します。

## 配布物と動作環境

| 配布対象 | サービス管理 | 専用実行アカウント | 既定のプログラム / データ保存先 |
|---|---|---|---|
| Windows x64 | SCM + WinSW 2.12.0 | LocalService | `C:\Program Files\DaifukuEdge` / `C:\ProgramData\DaifukuEdge` |
| Linux x64 / arm64 | systemd | `daifuku-edge` | `/opt/daifuku-edge` / `/var/lib/daifuku-edge` |
| macOS Intel / Apple Silicon | LaunchDaemon | `_daifukuedge` | `/Library/Application Support/DaifukuEdge` / `/Library/Application Support/DaifukuEdgeData` |

Windowsは.NET Framework 4.8とWindows PowerShell 5.1、Linuxはsystemdとutil-linuxのflock、macOSは標準zshの`zsh/system`を使用します。
OSがサポートするNode.js 22実行環境を前提とします。Node.js 22.23.2は配布物へ同梱し、端末でnpmのインストールやビルドは行いません。
NAS・ネットワーク共有・FAT等への状態保存は対象外です。ローカルの権限制御と原子的ファイル置換ができるファイルシステムを使ってください。
本セットアップは管理用CLIです。署名済みMSI/PKG、Apple notarization、MDM配布、自動更新には対応していません。

## 配布物の用意と確認

ソースから作る場合はリポジトリのルートで実行します（Node.js、pnpm、Python 3が必要です）。

```sh
pnpm install --frozen-lockfile
pnpm --filter @daifuku/edge build
python3 apps/edge/scripts/package.py --target all --release-id YOUR_COMMIT_ID --output /absolute/output --cache /absolute/build-cache
```

ビルド時だけ、版とSHA-256を固定した公式Node.js・WinSWを取得します。更新時も同じ手順で新しい配布物を作ります。
5種類のアーカイブと、それぞれのアーカイブ・manifestのSHA-256を出力します。既存の配布ディレクトリへ上書きしません。
配布元で検証したチェックサムを別経路で入手し、**展開・実行前**にアーカイブを照合してください。
同じダウンロード先にあるハッシュだけでは配布元の真正性を証明できません。実行後のmanifest検証も、実行開始したコード自体の真正性を遡って保証するものではありません。

```powershell
Get-FileHash -Algorithm SHA256 .\DaifukuEdge-RELEASE-win32-x64.zip
Expand-Archive -LiteralPath .\DaifukuEdge-RELEASE-win32-x64.zip -DestinationPath .\edge-release
```

```sh
# Linux: sha256sum、macOS: shasum -a 256
sha256sum DaifukuEdge-RELEASE-linux-x64.tar.gz
tar -xzf DaifukuEdge-RELEASE-linux-x64.tar.gz
```

## 初回導入

ERPで店舗の中継端末と機器を登録し、`config.example.json`をコピーして編集します。
`apiBaseUrl`は到達可能なERPのAPI入口（例 `https://erp.example.com/api`）、`devices`はERPの機器IDとLAN内の接続先です。
実プリンターは`ipp_text`、検証用端末だけ`simulator`を指定します。釣銭機の実機ドライバーは機種別の実装と確認が必要です。
設定ファイルを一般ユーザーから読めない場所に保存してください。秘密情報は引数に渡しません。

管理者PowerShellを開き、展開した配布ディレクトリでまず変更計画を確認します。
ExecutionPolicyを組織のルールに従って扱い、このスクリプトのためにOS全体の実行制限を無効化しないでください。

```powershell
$manifestHash = '配布元で照合した64桁のmanifest SHA-256'
.\setup.ps1 install --config C:\Private\edge-config.json --manifest-sha256 $manifestHash
.\setup.ps1 install --config C:\Private\edge-config.json --manifest-sha256 $manifestHash --execute
.\setup.ps1 status
```

Linux/macOSは同じオプションです。計画表示にも、既存サービスの所有者を調べるため管理者権限が必要です。

```sh
sudo ./setup.sh install --config /private/edge-config.json --manifest-sha256 TRUSTED_MANIFEST_SHA256
sudo ./setup.sh install --config /private/edge-config.json --manifest-sha256 TRUSTED_MANIFEST_SHA256 --execute
sudo ./setup.sh status
```

導入後はログインしていなくてもサービスが動作します。未登録時は`pairing_required`で待機します。
ERPで発行した一回限りのペアリング情報を、次の形式の保護されたファイルに保存します。

```json
{ "pairingToken": "ERPで発行された一回限りのトークン" }
```

```powershell
.\setup.ps1 pair --pairing-file C:\Private\pairing.json --execute
.\setup.ps1 status
```

```sh
sudo ./setup.sh pair --pairing-file /private/pairing.json --execute
sudo ./setup.sh status
```

セットアップは専用の受信ファイルへコピーし、サービス自身が最大約30秒間隔で登録を処理します。
`pairing_queued_check_status`は受付結果です。`status`で`runtime.phase`が`running`になることを確認してください。
確認後、元のペアリングファイルは管理者が削除します。コピーは登録成功確認後に消えます。
応答が失われた場合は保存済み資格情報から回復します。失敗した処理ファイルは調査・再試行用に残り、新しいトークンを入れると最大10世代まで退避します。
`credential_rejected`ではERP側の失効状況を確認して再発行します。同じ端末を別店舗へ無断で付け替えません。

## 更新・再開・停止・削除

新しい配布物を別ディレクトリへ展開し、そのセットアップを使います。

```sh
sudo ./setup.sh update --manifest-sha256 NEW_TRUSTED_SHA256
sudo ./setup.sh update --manifest-sha256 NEW_TRUSTED_SHA256 --execute
sudo ./setup.sh status
sudo ./setup.sh stop --execute
sudo ./setup.sh start --execute
sudo ./setup.sh uninstall --execute
```

Windowsは`sudo ./setup.sh`を管理者PowerShellの`.\setup.ps1`へ置き換えます。
`--execute`を省くと変更計画だけを表示します。更新は旧サービスの停止を確認してから、新しい固定版へ切り替えます。
既存の設定・CA・資格情報・処理履歴を引き継ぎます。更新時に`--config`を指定してERP接続先を切り替える操作は受け付けません。
失敗した途中状態は`installation.json`へ残します。同じ配布物・同じ初回設定ファイルで、元のコマンドに`--resume --execute`を追加して再開します。
推測によるロールバックや処理履歴の削除はしません。旧版も保存するので、障害調査後に管理者が保管容量を管理してください。
初回の導入記録を書き終える前にOSが停止した場合は、サービス/専用アカウントを作る前の段階です。残った一時ファイルを自動で採用せず停止します。管理者が所有者と内容を確認してから初回導入をやり直してください。

アンインストールはサービス登録を解除します。データ・ログ・専用アカウント・プログラム各版は保持します。
データを保持した再導入は`install`を使い、元の保存先を指定します。複数インスタンスの同居は対象外です。
独自の保存先を使った場合は`--install-root`を全操作に、`--state`をinstall/updateに毎回指定します。
プログラムとデータは別ディレクトリに置き、祖先も管理者が管理する場所を使用します。

## 接続・監視・障害対応

オンプレミスの社内CAは設定の`caFile`へPEMを指定できます。初回に保護された状態ディレクトリへコピーし、サービスだけに適用します。
HTTPS検証、OSファイアウォール、OS全体の信頼ストアは緩めません。WSSを中継するリバースプロキシではUpgrade転送を許可してください。
WSが切れた場合は再接続とHTTPSポーリングで回復します。端末のインターネット公開は不要です。

`status`はOSサービスの状態と、秘密を含まない`service-status.json`の鮮度を表示します。
サービスの停止・接続エラー・ペアリング待ちを区別します。`running`だけでプリンターの紙切れや釣銭機の正常動作までは保証しません。
ログはLinuxのjournal、macOS/Windowsのデータ保存先`logs`を確認します。macOSのファイルログとWinSW wrapperログの保管・ローテーションは運用で設定してください。
物理処理の結果が不明な仕事は自動で再実行しません。ERP側の履歴と実機を確認し、手動で扱ってください。
導入先に同名の他サービス、別所有者のファイル、シンボリックリンクや不安全なACLを見つけたらセットアップは停止します。エラーを避けるために既存ファイルを一括削除しないでください。
