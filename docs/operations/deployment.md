# クラウド VM / オンプレミスへの共通配備

この手順は Linux の単一 API・ローカル添付保存構成を対象とする。[構成と境界](../architecture/deployment.md)、[安全な setup](setup.md)、[受入仕様](../specs/deployment-edge.md) を先に確認する。スクリプトは本番サービスや OS package を勝手に変更しない。ここで示す path・DNS 名は例であり、実環境に合わせる。

## 1. 配布物を作る

レビュー済み commit の clean checkout と、同じ architecture の Linux、Node.js 22、package.json 指定版 pnpm を用いる。先に通常の依存導入と gate を済ませ、pnpm store を用意する。生成は外部接続なしの frozen/offline install、Web build、固定済み API dependency graph のコピー、edge agent build を一時領域で行う。依存 package の install lifecycle script は実行しない。初回に store が空の場合は、通常の依存導入を先に行い、生成コマンドを再実行する。

```bash
node scripts/build-release.mjs   --source /home/builder/DaifukuERP   --output /home/builder/releases/release-001
```

出力先は未作成ディレクトリに限る。実行者の環境から DB URL、JWT、SMTP、OIDC、Square、機器 token 等は build 子プロセスへ渡さない。個人の npm 設定を読み込まず、公開 registry を指定する。tracked の `.env`・秘密鍵・DB dump・運用ディレクトリ・外部へ出る symlink は拒否する。ただし名前による拒否は内容の秘密検査の代替ではなく、公開前の source/履歴 scan が必要である。build 自体は OS sandbox ではないため、実行する source をレビューし、秘密を置かない専用 build ユーザー/環境を用いる。

生成される archive は `bundle/source`（source + lockfile + docs/license）、`bundle/web`（Web成果物 + LICENSE + THIRD_PARTY_NOTICES.txt + 依存版一覧）、`bundle/runtime`（API と実行依存）、`bundle/edge/`（edge.mjs とライセンス通知）、`bundle/manifest.json` を持つ。`SHA256SUMS` と `manifest.sha256` を別の信頼できる経路でも確認する。`--candidate` は検証用の未公開候補であることを manifest とファイル名に明示し、通常の配備計画では拒否する。候補の許可は受入環境だけで行う。

Node 本体・Caddy・PostgreSQL・systemd は含まない。同じ CPU architecture の両配備先へ**同じ archive**を持ち込み、接続先の違いを秘密設定と profile で表す。archive の SHA256 を確認してから、新しい空ディレクトリへ一般ユーザーで展開し、直後に manifest を確認する。既存 release へ上書き展開しない。

```bash
sha256sum -c SHA256SUMS
# 確認済み archive 名を指定。展開先は新しい空ディレクトリ。
tar --no-same-owner -xzf DaifukuERP-<commit>-x64.tar.gz -C /opt/daifuku/releases/release-001
node /opt/daifuku/releases/release-001/bundle/source/scripts/verify-release.mjs   --release /opt/daifuku/releases/release-001/bundle   --manifest-sha256 <別途確認した64桁SHA256>
```

実ファイル・permission・リンクが manifest と違う場合は停止する。検証後は release に書き込まず、deploy/service の切替時も同じ検証を行う。配布元の真正性確認は運用側の責任であり、同じ場所から取得した checksum だけを発行者署名とは扱わない。

## 2. DB と私有設定を用意する

専用サービスユーザー（例 `daifuku`）、DB owner/app role、専用 PostgreSQL 16 DB、今回用の空の復元確認 DB を管理者が事前に準備する。Node22 と、DB サーバーと同じ major の PostgreSQL client が必要。DB については [setup の前提と role 制約](setup.md#1-導入先を準備する) を守る。release の runtime は依存を同梱しているため、配備先で pnpm install は不要。

サービスユーザーとして次を実行する。install/upgrade の入力・実行確認・backup・再開契約は従来と同じで、コマンド入口だけ同梱 runtime に変わる。

```bash
cd /opt/daifuku/releases/release-001/bundle/runtime/apps/api
/opt/node22/bin/node dist/setup/cli.js install   --env /home/daifuku/setup-source.env   --state-dir /home/daifuku/operations   --tenant-name '運営組織' --company-code MAIN --company-name '運営会社'   --admin-email '実際の管理者メール' --admin-name '初回管理者'   --generate-admin-password
```

最初は plan のみ。対象を確認し、全 API/MCP/worker/外部 writer を停止してから同じコマンドへ `--execute --confirm-target <target.id> --maintenance-confirmed` を付ける。成功後、既存 `operations/runtime.env` を0600のまま保護されたエディターで編集し、次を明示する。内容を shell の引数へ貼り付けたり `source` したりしない。

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
TRUSTED_PROXY_CIDRS=127.0.0.1/32
DAIFUKU_STORAGE_DIR=/home/daifuku/operations/evidence
PUBLIC_WEB_URL=https://erp.example.jp
IDENTITY_ENCRYPTION_KEY=<別途生成した32バイト乱数の標準Base64>
```

`PUBLIC_WEB_URL` を設定する場合は `IDENTITY_ENCRYPTION_KEY` も同時に必須です。上の鍵プレースホルダーを、JWT とは別に生成した暗号学的乱数32バイトの標準 Base64 表現に置き換えてください。URL だけの設定、不正な鍵、path/query 付きの URL は API 起動時に拒否されます。鍵を Git・ログ・shell 引数に残さず、0600 の runtime.env と秘密保管先で保護します。暗号化した MFA 等の情報と対応するため、更新・復元時にも同じ鍵を保持し、既存 DB に対して無条件に生成し直さないでください。詳細は [認証運用](enterprise-identity.md) を参照してください。

生成済みの DB URL と JWT を保持する。Node の環境変数は env-file より優先されるため、手動起動時には同名の古い shell 変数を残さない。systemd の専用 service はログイン shell の env を読み込まない。必要に応じ SMTP/OIDC/Square 設定を同じ保護 env へ追加する。Web に秘密を渡す `VITE_*` は使わない。

## 3. cloud / onprem の計画を確認する

Node の絶対 path、実行中のサービスユーザー名、私有 state と runtime.env、未作成の profile 出力先を指定する。symlink、空白・shell 記号を含む path は受け付けない。release と state と出力先を分け、state0700/runtime.env0600 はサービスユーザーが所有する。

```bash
node /opt/daifuku/releases/release-001/bundle/source/scripts/deploy-plan.mjs   --release /opt/daifuku/releases/release-001/bundle   --manifest-sha256 <確認済みSHA256>   --state /home/daifuku/operations   --config /home/daifuku/operations/runtime.env   --output /home/daifuku/profiles/release-001   --node /opt/node22/bin/node --user daifuku   --hostname erp.example.jp --profile cloud
```

cloud は組織管理 DNS と公開 TLS 入口を前提に Caddy の自動 HTTPS を使う。onprem は `--profile onprem --cert /etc/daifuku-tls/erp.crt --key /etc/daifuku-tls/erp.key` を指定する。証明書・秘密鍵は自動生成や読出しをせず参照だけを生成するため、Caddy が読める最小権限と証明書の期限/名前/chain を別途検証する。私設 DNS でも組織所有 FQDN を使い、全ブラウザ/agent に CA を正しく配布する。外部店舗が私設 ERP へ到達できなければ VPN 等を別途設計する。

既定の plan はファイルを作成せず、DB に接続せず、サービスを操作しない。確認後に同じコマンドへ `--execute` を追加すると、新しい出力先に `daifuku-api.service`、`Caddyfile`、秘密を含まない `deployment.json` を作り、state 内に evidence0700 を用意する。既存 profile や runtime.env は上書きしない。途中失敗した新出力は保全し、原因確認後に別の未使用出力先で再計画する。

## 4. 管理者が配備し、起動を確認する

生成物をレビューし、管理者が systemd / Caddy の所定位置へ設置する。release の全経路は Caddy が `web` を読み取れるようにし、秘密の state は Caddy に許可しない。Node executable と release の所有者・書込権限を固定し、稼働ユーザーから release が書換可能な状態を残さない。生成後の profile 自体は manifest 外の運用資材である。

`systemd-analyze verify <生成service>` と `caddy validate --config <生成Caddyfile> --adapter caddyfile` を行ってから、管理者が service を起動する。Caddy の管理 endpoint と access log は profile では無効。auth callback の code や query、機器 token を proxy/外部監視の URL log に追加しない。API は loopback のみ、外部へは HTTPS のみを公開する。証明書更新に必要な HTTP/HTTPS 条件は Caddy の公式手順に従う。

- `https://erp.example.jp/` と深い画面 URL で同じ SPA が表示される。
- `https://erp.example.jp/api/health` は API 生存、`/api/ready` は DB/schema/storage を確認する。503 の内部原因は公開しない。
- ログイン・会社選択・添付保存と取得を確認する。公開入口を使う外部 callback/Webhook は `/api` prefix を含めて provider 側の登録 URL と厳密に揃える。
- 店舗 agent は [機器連携仕様](../specs/deployment-edge.md) の外向き WSS/HTTPS を使う。通知が切れても再取得できること、停止・再起動後に同じ job を二重実行しないことを確認する。

systemd unit は SIGTERM と終了猶予を用い、release を read-only とし evidence だけ書込可能にする。ただしこのスクリプトは systemd 自身を有効化しない。手動起動して放置した process と二重に常駐させない。

## 5. 更新・失敗復旧

新 release を新ディレクトリへ展開・検証し、旧 release、私有 runtime.env、添付、DB role 秘密、移行前 DB backup を保全する。サービスを止め、新 release の runtime から `dist/setup/cli.js upgrade` を plan → 明示 execute する。新 profile を生成して内容を確認し、管理者が起動先を切り替える。

migration が適用された DB に古い実行コードだけを向ける「ロールバック」は行わない。復旧は [元の版と別の新規 DB を用いた復元](setup.md#4-復元した-db-で回復を確認する) で検証し、接続先を明示して切り替える。DB dump は添付・環境設定・role を含まない。常駐 process の再起動、TLS 証明書更新、backup 保持/実復元、空き容量監視は運用の責任である。

## 受入範囲

リポジトリ内の回帰は `node --test deploy/test/release.test.mjs`、API readiness/proxy と Web API base の unit で再現できる。配備 test は改竄・権限・symlink・候補拒否・異常入力・既定 plan 無変更・再実行上書き拒否を確認する。物理クラウド VM / 店舗本番 LAN、公開 CA 発行、実 host の systemd install/start は自動実受入に含めない。ローカルでの bundle / TLS / process 実検証結果は [今回の仕様](../specs/deployment-edge.md) の検証記録を参照する。

2026-09-12 の専用一時環境では、候補 commit の frozen/offline build → runtime だけの setup help →同梱 migration を専用 PostgreSQL 16 に適用 → 私有 env-file で API 起動 → health/ready200 → SIGTERM の正常終了を確認した。さらに同じ bundle を2つの profile で起動した実 Caddy 2.11.4 に配置し、信頼したテスト CA による TLS、SPA の深い URL、API prefix、偽の転送元 header の置換、WSS upgrade、接続中の WSS を含む停止、配布物不変を確認した。gateway の上流は合成 HTTP/WS であり、実 API の起動受入とは別である。公開 CA の発行や本番の systemd 導入まで成功したという意味ではない。
