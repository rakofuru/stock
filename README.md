# EDINET Screening Studio (Local)

EDINET DB API と Stooq を使って、全上場企業の財務情報を4日で収集しつつ、買い基準スクリーニングを行うローカルアプリです。

## 構成

- Frontend/API: Next.js (App Router, TypeScript)
- DB: PostgreSQL + Prisma
- 収集ワーカー: node-cron (`Asia/Tokyo`, 毎日 12:00 JST)
- 財務データ: EDINET DB API
- 価格履歴(5年): Stooq

## セットアップ

```bash
# PostgreSQL (Docker) を起動
docker run -d --name stock-postgres \
  -e POSTGRES_USER=stock \
  -e POSTGRES_PASSWORD=stockpass \
  -e POSTGRES_DB=stockdb \
  -p 5433:5432 postgres:16

npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

## 環境変数

`.env.local` を使います（このリポジトリでは Git 管理外）。

```env
DATABASE_URL="postgresql://stock:stockpass@localhost:5433/stockdb?schema=public"
SQLITE_DATABASE_URL="file:./dev.db"
EDINET_API_KEY="YOUR_EDINET_API_KEY"
EDINET_BASE_URL="https://edinetdb.jp/v1"
COLLECTION_DAILY_LIMIT="1020"
```

## 既存SQLiteからの移行

```bash
npm run db:generate:sqlite
npm run db:migrate:sqlite-to-postgres
```

## 既存PostgreSQLから本番PostgreSQLへの移行

```bash
# 例: SOURCE_DATABASE_URL はローカルDB、DATABASE_URL はVercel本番DB
SOURCE_DATABASE_URL="postgresql://stock:stockpass@localhost:5433/stockdb?schema=public" \
npm run db:migrate:postgres-to-postgres
```

## Vercel本番運用で必要な接続URL

`本番PostgreSQL接続URL` は、Vercel本番からアクセスできるPostgreSQLの接続文字列です。例:

```env
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>?sslmode=require"
```

Vercelに最低限必要なEnvironment Variables:

- `DATABASE_URL`（本番DBの接続URL）
- `EDINET_API_KEY`
- `EDINET_BASE_URL=https://edinetdb.jp/v1`
- `COLLECTION_DAILY_LIMIT=1020`

## 主要コマンド

- `npm run dev`: ローカル起動
- `npm run worker`: 日次収集ワーカー起動（12:00 JST）
- `npm run collect:resume`: 手動で収集再開
- `npm run screening:run`: 手動でスクリーニング実行
- `npm run db:generate:sqlite`: SQLite用Prisma Client生成（移行時のみ）
- `npm run db:migrate:sqlite-to-postgres`: SQLiteデータをPostgreSQLへ移送
- `npm run db:migrate:postgres-to-postgres`: PostgreSQL間で全データ移送
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:e2e`

## 画面

- `/dashboard`: 収集進捗、残件、失敗ログ、手動実行
- `/screening`: 左フィルタ / 中央一覧 / 右詳細の3ペイン
- `/settings`: 重み、SAM初期値、危険ワード辞書

## API（アプリ内）

- `POST /api/collection/run`
- `GET /api/collection/status`
- `POST /api/screenings/run`
- `GET /api/screenings/latest`
- `GET/PUT /api/settings/weights`
- `GET/PUT /api/settings/sam`
- `GET/PUT /api/settings/risk-keywords`

## 判定ロジックの要点

- 必須ゲート
  - `cf_operating > 0`
  - `equity_ratio_official >= 0.5`
- スコア
  - `score = earned / available * 100`
  - `coverage = evaluated / total * 100`
  - `PENDING` は score の分母から除外
- 高値回避
  - 現在値が5年高値の80%以下で PASS
- 時価総額推計
  - `market_cap_est = PER * 当期純利益`

## 収集優先順（現行）

- `financials` 未取得企業を優先
- 同条件では市場区分の優先順で処理
  - `PRIME -> STANDARD -> GROWTH -> OTHER -> UNKNOWN`

## テスト

- Unit: `tests/unit/calculations.spec.ts`
- Integration: `tests/integration/edinet-client.spec.ts`, `tests/integration/collection-cursor.spec.ts`
- E2E: `tests/e2e/app.spec.ts`

## 注意

本アプリは投資助言ではなく、条件スクリーニング支援ツールです。
