# Daifuku LAN agent

Windows x64、Linux x64/arm64、macOS Intel/Apple Siliconを対象にした常駐中継です。[OS別セットアップ](../../docs/manual/edge-service-setup.md)はNode.js 22.23.2を同梱し、SCM/systemd/LaunchDaemonへ登録します。Linux/macOSは専用の非ログインアカウント、Windowsは組込LocalServiceを使用します。同じLocalServiceで動く別サービスとの秘密隔離は対象外です。ERPへ外向きHTTPS/WSSで接続し、設定で許可したIPP機器または明示したシミュレーターだけを扱います。受信portは開きません。

```sh
pnpm --filter @daifuku/edge build
node apps/edge/dist/edge.mjs --help
```

`dist/edge.mjs` は必要なJavaScript依存を含む単一bundleで、実行先にnode_modulesは不要です。配布時には同時生成される `dist/LICENSE` と `dist/THIRD_PARTY_NOTICES.txt` も必ず同送してください。第三者通知は実際にbundleへ含まれたnpm依存のmanifestとライセンス全文から生成します。この単独JS配布を直接動かす場合はNode.js 22を別途用意します。版付きOSセットアップ配布物にはNodeが同梱されます。Linuxだけutil-linuxのflockが必要で、macOSは標準zshの`zsh/system`、WindowsはWindows PowerShell 5.1/.NET Framework 4.8を使います。設定/秘密/journalはbundleへ含めません。

[運用手順](../../docs/operations/edge-agent.md)、[統合仕様](../../docs/specs/deployment-edge.md)、[設定例](config.example.json)、[systemd例](deploy/daifuku-edge.service)を参照してください。

`pair`, `session`, `rotate`, `run`, `once`, `inspect`, `service` が利用できます。`service`は未登録時も待機し、保護されたペアリングinboxと状態ファイルを使います。`--config` は所有者限定のJSON、`--state` は所有者限定の永続ディレクトリです。直接実行のpairだけ `--token-file` に単回pairing tokenのJSONを指定します。セットアップで管理する常駐サービスへの登録には、上記の直接pairコマンドではなく`setup pair --pairing-file <保護ファイル>`を使ってサービス本人に処理させます。トークンそのものを引数・URL・ログへ渡しません。設計は [エッジサービス構造](../../docs/architecture/edge-services.md) を参照してください。

5対象の配布生成と実OS受入の結果は別です。確認したOS/CPUとcommitは[エッジサービス作業記録](../../docs/log/2026-09-13-edge-installers.md)を参照してください。実店舗機器・本番ERP・全OS版での受入成功を意味しません。
