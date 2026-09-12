# Daifuku LAN agent

Windows x64、Linux x64/arm64、macOS Intel/Apple Siliconで動く常駐中継です。[OS別セットアップ](../../docs/manual/edge-service-setup.md)はNode.js 22.23.2を同梱し、SCM/systemd/LaunchDaemonへ専用アカウントで登録します。ERPへ外向きHTTPS/WSSで接続し、設定で許可したIPP機器または明示したシミュレーターだけを扱います。受信portは開きません。

```sh
pnpm --filter @daifuku/edge build
node apps/edge/dist/edge.mjs --help
```

`dist/edge.mjs` は必要なJavaScript依存を含む単一bundleで、実行先にnode_modulesは不要です。配布時には同時生成される `dist/LICENSE` と `dist/THIRD_PARTY_NOTICES.txt` も必ず同送してください。第三者通知は実際にbundleへ含まれたnpm依存のmanifestとライセンス全文から生成します。NodeとflockはOSへ別途導入してください。設定/秘密/journalはbundleへ含めません。

[運用手順](../../docs/operations/edge-agent.md)、[統合仕様](../../docs/specs/deployment-edge.md)、[設定例](config.example.json)、[systemd例](deploy/daifuku-edge.service)を参照してください。

`pair`, `session`, `rotate`, `run`, `once`, `inspect`, `service` が利用できます。`service`は未登録時も待機し、保護されたペアリングinboxと状態ファイルを使います。`--config` は所有者限定のJSON、`--state` は所有者限定の永続ディレクトリです。pairのみ `--token-file` に単回pairing tokenのJSONを指定します。トークンそのものを引数・URL・ログへ渡しません。設計は [エッジサービス構造](../../docs/architecture/edge-services.md) を参照してください。
