# Discord × Claude Code Multi-Project Bridge

Discordのカテゴリ配下にチャンネルを作るだけで、自動的にプロジェクトディレクトリが作成され、そのチャンネルからClaude Codeとやり取りできるブリッジシステムです。Docker上で動作し、複数プロジェクトを同時に管理できます。

## 特徴

- **チャンネル作成 = プロジェクト作成**: Discordで指定カテゴリにチャンネルを作ると、ホストマシンに同名のディレクトリが自動生成される
- **Claude Codeとの対話**: 各チャンネルでメッセージを送ると、対応するプロジェクトディレクトリ内でClaude Codeが動作し、コーディング・ファイル操作・コマンド実行などを行う
- **作業過程の可視化**: チャンネルごとに作業ログスレッドが作られ、ツール使用や思考過程がリアルタイムで確認できる
- **セッション継続**: 同じチャンネル内の会話はセッションとして継続される
- **Docker隔離**: 全てDocker内で動作するため、ホストマシンへの影響を最小限に抑える
- **グローバル設定チャンネル**: `claude-root` という名前のチャンネルを作ると `~/.claude/` にマッピングされ、グローバル設定やスキルの管理が可能

## アーキテクチャ

```
Discord カテゴリ「Code Projects」
  ├─ #my-project     → ~/Code/my-project/
  ├─ #web-app        → ~/Code/web-app/
  └─ #claude-root    → ~/.claude/ (グローバル設定)

         ↕ Discord API

  ┌─────────────────────────────────┐
  │  Docker Container               │
  │                                 │
  │  Channel Watcher (Client #1)    │
  │    → CHANNEL_CREATE検知         │
  │    → ディレクトリ自動作成        │
  │    → config.json更新            │
  │                                 │
  │  Message Handler (Client #2)    │
  │    → メッセージ受信              │
  │    → claude --print 実行        │
  │    → 進捗をスレッドに投稿       │
  │    → 結果をチャンネルに返信     │
  └─────────────────────────────────┘
```

## 必要なもの

- **Docker Desktop** (Mac / Windows / Linux)
- **Claude Max Plan** または **Claude API Key**
- **Discordアカウント** (Bot作成権限のあるサーバー)

## セットアップ手順

### 1. リポジトリをクローン

```bash
git clone https://github.com/hsflow/discord-claudecode-multi-project-bridge.git
cd discord-claudecode-multi-project-bridge
```

### 2. Discord Botを作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリック → 名前を入力して作成
3. 左メニュー「**Bot**」を選択
4. 「Reset Token」をクリックしてトークンをコピー（**後で使います**）
5. 同じページの **Privileged Gateway Intents** で以下を有効化:
   - `MESSAGE CONTENT INTENT` → ON
6. 「Save Changes」をクリック

### 3. Botをサーバーに招待

1. 左メニュー「**OAuth2**」→「**URL Generator**」を選択
2. **Scopes** で `bot` にチェック
3. **Bot Permissions** で以下にチェック:
   - Send Messages
   - Create Public Threads
   - Read Message History
   - Manage Threads
   - View Channels
4. 生成されたURLをブラウザで開き、Botを招待するサーバーを選択

### 4. Discordサーバーにカテゴリを作成

1. Discordサーバーで「カテゴリーを作成」→ 名前を入力（例: `Code Projects`）
2. 開発者モードを有効化（ユーザー設定 → アプリの設定 → 詳細設定 → 開発者モード → ON）
3. 作成したカテゴリを右クリック →「IDをコピー」

### 5. Claude Codeの認証トークンを取得

#### Max Planの場合

ホストマシンでClaude Codeがインストール・ログイン済みであることを確認し、以下を実行:

```bash
claude setup-token
```

表示されたトークン（`sk-ant-oat01-...`）をコピーします。

#### API Keyの場合

[Anthropic Console](https://console.anthropic.com/) からAPIキーを取得します。  
※ この場合、`.env` の `CLAUDE_CODE_TOKEN` の代わりに別途設定が必要です（後述）。

### 6. 環境設定

```bash
cp .env.example .env
```

`.env` を編集して値を入力:

```env
# Step 2でコピーしたBotトークン
DISCORD_BOT_TOKEN=your-discord-bot-token

# Step 5で取得したClaude Codeトークン
CLAUDE_CODE_TOKEN=your-claude-code-token

# Step 4でコピーしたカテゴリID
WATCH_CATEGORY_ID=your-category-id
```

### 7. docker-compose.yml のパスを修正

`docker-compose.yml` のボリューム設定を、自分のプロジェクトディレクトリに合わせて変更:

```yaml
volumes:
  # ↓ プロジェクトを配置する親ディレクトリに変更
  - /path/to/your/projects:/workspace
  # ↓ Claude Codeのグローバル設定（claude-rootチャンネル用、不要なら削除可）
  - /path/to/your/.claude:/claude-home
```

### 8. ビルド & 起動

```bash
docker compose build
docker compose up -d
```

### 9. 動作確認

1. Discordで、Step 4で作成したカテゴリ内に新しいテキストチャンネルを作成（例: `test-project`）
2. ホストマシンで `ls /path/to/your/projects/test-project/` が作成されていることを確認
3. そのチャンネルでメッセージを送信 → Claude Codeが応答すれば成功

## 設定オプション

`.env` で以下のオプションを設定可能:

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `DISCORD_BOT_TOKEN` | (必須) | Discord Botトークン |
| `CLAUDE_CODE_TOKEN` | (必須) | Claude Code認証トークン |
| `WATCH_CATEGORY_ID` | (必須) | 監視対象のDiscordカテゴリID |
| `MAX_CONCURRENT_SESSIONS` | `4` | 同時実行セッション数の上限 |
| `SESSION_TIMEOUT_MS` | `1800000` | セッションのアイドルタイムアウト（ミリ秒） |
| `CLAUDE_PERMISSION_MODE` | `acceptEdits` | Claude Codeの権限モード (`acceptEdits`, `bypassPermissions` 等) |

### 権限モードについて

| モード | 説明 |
|--------|------|
| `acceptEdits` | ファイルの読み書きは自動承認、Bash実行は制限 |
| `bypassPermissions` | 全操作を自動承認（Docker内で隔離されているため実用的） |

## 予約チャンネル名

| チャンネル名 | マッピング先 | 用途 |
|-------------|-------------|------|
| `claude-root` | `~/.claude/` | グローバル設定、共通スキル・コマンドの管理 |

## 運用

### ログの確認

```bash
docker compose logs -f
```

### 再起動

```bash
docker compose restart
```

### 停止

```bash
docker compose down
```

### 再ビルド（コード変更後）

```bash
docker compose build && docker compose up -d
```

## API Key（コンソールAPIキー）を使う場合

Max Planではなく、Anthropic ConsoleのAPIキーを使う場合は:

1. `docker-compose.yml` の環境変数を変更:

```yaml
environment:
  - WORKSPACE_PATH=/workspace
  - ANTHROPIC_API_KEY=${CLAUDE_CODE_TOKEN}
```

2. `claude-runner.ts` の `args` に `--bare` フラグを追加

## ライセンス

MIT
