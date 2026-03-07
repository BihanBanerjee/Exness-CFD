# Velox — Real-Time Leveraged Trading Platform

A production-grade, real-time cryptocurrency trading platform with automatic liquidation, leveraged perpetual contracts, and live price streaming. Built as a distributed microservices system using TypeScript, Redis Streams, PostgreSQL/TimescaleDB, WebSockets, and Next.js.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-1.3+-fbf0df?logo=bun&logoColor=000)
![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=next.js&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.2-06B6D4?logo=tailwindcss&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Overview

Velox enables users to trade cryptocurrencies (BTC, ETH, SOL) with up to 100x leverage on perpetual contracts. The platform features a professional trading interface with real-time candlestick charts, live bid/ask streaming, and an in-memory liquidation engine that monitors every price tick.

**Key highlights:**

- 7 microservices communicating via Redis Streams
- In-memory trading engine with event sourcing and crash recovery
- Real-time WebSocket price feeds from Binance
- Professional trading UI with interactive charts and position management
- Dual authentication: password + magic link email sign-in
- BigInt arithmetic throughout — zero floating-point errors

| Metric | Value |
|--------|-------|
| Supported assets | BTCUSDT, ETHUSDT, SOLUSDT |
| Leverage range | 1x – 100x |
| Price precision | 8 decimal places (10^8 scale) |
| Snapshot interval | 15 seconds |
| Initial balance | $1,000 (virtual) |
| Candle timeframes | 30s, 1m, 5m, 15m, 1h, 4h, 1d |

---

## Architecture

### System Overview

![Velox System Architecture](assets/architecture.png)

All order operations flow through Redis Streams. The HTTP backend is stateless — the liquidation engine is the single source of truth for balances and positions.

**Request-Response Flow:** Frontend → HTTP Backend → Redis Stream → Liquidation Engine → Redis Response → HTTP Backend → Frontend

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, lightweight-charts |
| HTTP API | Express.js 5 |
| WebSocket | ws |
| Message broker | Redis Streams + Pub/Sub |
| Database | PostgreSQL 17 + TimescaleDB |
| ORM | Prisma |
| Auth | JWT (httpOnly cookies) + Magic Link (Resend) |
| Validation | Zod |
| Monorepo | Turborepo |

---

## Project Structure

```
velox/
├── apps/
│   ├── web/                    # Next.js frontend (React 19 + Tailwind 4)
│   ├── http-backend/           # REST API gateway (Express)
│   ├── liquidation-engine/     # Core trading engine + auto-liquidation
│   ├── realtime-server/        # WebSocket server for live prices
│   ├── price-poller/           # Binance price ingestion + spread
│   ├── db-worker/              # Persist closed orders to PostgreSQL
│   └── batch-uploader/         # Batch trade data → TimescaleDB
│
├── packages/
│   ├── validation/             # Zod schemas + Express middleware
│   ├── prisma-client/          # Prisma schema + generated client
│   ├── redis-client/           # Redis client, streams, subscriber
│   ├── redis-stream-types/     # Type-safe stream message definitions
│   ├── price-utils/            # BigInt arithmetic (10^8 scale)
│   └── ui/                     # Shared UI components
│
├── docker-compose.yml
├── turbo.json
└── README.md
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.3.4+
- [Docker](https://www.docker.com/) + Docker Compose
- PostgreSQL 17 with TimescaleDB
- Redis 7.x

### Setup

```bash
# 1. Clone and install
git clone <repository-url>
cd velox
bun install

# 2. Start infrastructure
docker-compose up -d
# PostgreSQL on :5433, Redis on :6380

# 3. Run migrations
cd packages/prisma-client && bunx prisma migrate deploy && cd ../..

# 4. Start all backend services
bun start:dev

# 5. Start the frontend (in a separate terminal)
cd apps/web && bun run dev
```

### Service Ports

| Service | Port |
|---------|------|
| Frontend | `http://localhost:3000` |
| HTTP API | `http://localhost:3005` |
| WebSocket | `ws://localhost:3006` |
| PostgreSQL | `localhost:5433` |
| Redis | `localhost:6380` |

---

## Services

### Frontend (`apps/web`)

Next.js 16 trading interface styled with Tailwind CSS 4.

**Pages:**
- `/` — Landing page with sign-in / register options
- `/signin` — Dual auth: password form + magic link email tab
- `/register` — Account creation (email, phone, password)
- `/trade` — Full trading dashboard

**Trading UI features:**
- Real-time candlestick chart (lightweight-charts) with 7 timeframes
- Asset selector with live bid/ask prices
- Order form with leverage slider (1–100x), stop-loss, take-profit
- Resizable sidebar and positions panel (drag-to-resize)
- Open positions with live P&L, closed positions with close reason badges
- Balance, equity, and total P&L in the top bar
- Profile menu with sign-out
- WebSocket price streaming with ticket-based auth

---

### Liquidation Engine (`apps/liquidation-engine`)

The core of the platform. Maintains all trading state in memory for sub-millisecond order processing.

**Capabilities:**
- Order placement, closure, and balance management
- Automatic liquidation on every price tick:
  - **Margin call** — triggered at 90% margin loss
  - **Stop-loss / Take-profit** — price-based triggers
- LONG orders close at bid price, SHORT orders close at ask price
- State snapshots every 15 seconds → PostgreSQL
- Full event replay from last snapshot on restart

**Engine states:** `STARTING` → `REPLAYING` → `READY` → `SHUTDOWN`

---

### HTTP Backend (`apps/http-backend`)

Stateless REST API that validates requests and forwards them to the engine via Redis Streams.

**Auth endpoints:**
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/user/signup` | Register with email, phone, password |
| POST | `/api/v1/user/signin` | Sign in with password |
| POST | `/api/v1/user/magic-link` | Send magic link email |
| GET | `/api/v1/user/auth/verify` | Verify magic link token |
| POST | `/api/v1/user/signout` | Clear auth cookie |
| GET | `/api/v1/user/me` | Get current user |
| GET | `/api/v1/user/ws-ticket` | One-time WebSocket ticket |

**Order endpoints** (all require auth):
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/order/open` | Open a position |
| POST | `/api/v1/order/close/:orderId` | Close a position |
| GET | `/api/v1/order/user/orders?status=OPEN\|CLOSED` | List positions |
| GET | `/api/v1/order/user/balance` | Get balance |
| GET | `/api/v1/order/:orderId` | Get order details |

**Candle endpoint:**
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/candles?asset=BTCUSDT&duration=1m` | OHLCV candles (up to 1000) |

Supported durations: `30s`, `1m`, `5m`, `15m`, `1h`, `4h`, `1d`

---

### Realtime Server (`apps/realtime-server`)

WebSocket server that broadcasts live prices to all authenticated clients.

- Subscribes to Redis Pub/Sub `market:*` channels
- Ticket-based auth (one-time use, 30s TTL) with JWT fallback
- Heartbeat ping/pong (30s interval)
- Multi-tab support (multiple connections per user)

```json
{
  "type": "price_update",
  "symbol": "BTCUSDT",
  "data": {
    "bidPrice": 92000.50,
    "askPrice": 92092.50,
    "timestamp": 1703001234567
  }
}
```

---

### Price Poller (`apps/price-poller`)

Connects to Binance WebSocket and distributes prices with a 0.1% bid/ask spread.

- Subscribes to `btcusdt@trade`, `ethusdt@trade`, `solusdt@trade`
- Publishes manipulated prices to the request stream (for trading)
- Publishes honest prices to the batch uploader stream (for charts)
- Broadcasts to `market:{SYMBOL}` Redis channels (for WebSocket)

---

### DB Worker (`apps/db-worker`)

Listens to the response stream for closed orders and persists them to PostgreSQL.

- Calculates close price from P&L data
- Idempotent upserts (safe on restart)
- Tracks close reason: `MANUAL`, `MARGIN_CALL`, `STOP_LOSS`, `TAKE_PROFIT`

---

### Batch Uploader (`apps/batch-uploader`)

Accumulates trade ticks and batch-inserts them into TimescaleDB.

- Batch size: 100 messages or 5-second flush timeout
- Feeds TimescaleDB materialized views for candlestick aggregation

---

## API Examples

### Register a new user

```bash
curl -X POST http://localhost:3005/api/v1/user/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "trader@example.com", "phone": 1234567890, "password": "secure123"}'
```

### Open a leveraged position

```bash
curl -X POST http://localhost:3005/api/v1/order/open \
  -H "Content-Type: application/json" \
  -b "token=<jwt>" \
  -d '{
    "orderType": "LONG",
    "asset": "BTCUSDT",
    "leverage": 10,
    "qty": 100,
    "stopLoss": 90000,
    "takeProfit": 95000
  }'
```

### Send a magic link

```bash
curl -X POST http://localhost:3005/api/v1/user/magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "trader@example.com"}'
```

---

## Data Flow

### Order Lifecycle

```
1. User places order
   Frontend → HTTP Backend → Redis Stream (request:stream)

2. Engine processes
   Liquidation Engine validates → deducts margin → opens position
   → publishes response to Redis

3. Response delivered
   HTTP Backend subscriber receives response → returns to frontend

4. Continuous monitoring
   Every price tick: engine checks all open orders for liquidation
   → margin call, stop-loss, or take-profit triggers

5. Order closed (manual or automatic)
   Engine calculates P&L → returns margin + P&L to balance
   → DB Worker persists to PostgreSQL
```

### State Recovery

```
Engine crash → restart
  ↓
Load latest snapshot from PostgreSQL
  ↓
Replay all Redis Stream events since snapshot's lastStreamId
  ↓
State fully restored → engine status: READY
```

---

## Database Schema

### Users

```sql
CREATE TABLE users (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email    VARCHAR UNIQUE NOT NULL,
  phone    BIGINT UNIQUE NOT NULL,
  password VARCHAR NOT NULL
);
```

### Closed Orders

```sql
CREATE TABLE closed_orders (
  "orderId"          UUID PRIMARY KEY,
  "userId"           UUID NOT NULL,
  asset              VARCHAR NOT NULL,
  "orderType"        VARCHAR NOT NULL,      -- LONG | SHORT
  leverage           INTEGER NOT NULL,
  "marginInt"        BIGINT NOT NULL,
  "executionPriceInt" BIGINT NOT NULL,
  "closePriceInt"    BIGINT NOT NULL,
  "qtyInt"           BIGINT NOT NULL,
  "stopLossInt"      BIGINT,
  "takeProfitInt"    BIGINT,
  "finalPnLInt"      BIGINT NOT NULL,
  "closeReason"      VARCHAR,               -- MANUAL | MARGIN_CALL | STOP_LOSS | TAKE_PROFIT
  "createdAt"        TIMESTAMP NOT NULL,
  "closedAt"         TIMESTAMP NOT NULL
);
```

### Trades (TimescaleDB Hypertable)

```sql
CREATE TABLE trades (
  id        VARCHAR NOT NULL,
  time      TIMESTAMPTZ NOT NULL,
  symbol    VARCHAR NOT NULL,
  "priceInt" BIGINT NOT NULL,
  "qtyInt"  BIGINT NOT NULL,
  PRIMARY KEY (id, time)
);

SELECT create_hypertable('trades', 'time');
```

### Snapshots

```sql
CREATE TABLE snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp      TIMESTAMP DEFAULT NOW(),
  "lastStreamId" VARCHAR NOT NULL,
  data           JSONB NOT NULL
);
```

---

## Environment Variables

### HTTP Backend

```env
API_PORT=3005
JWT_SECRET=your-secret-key
DATABASE_URL=postgresql://postgres:password@localhost:5433/trading_db
REDIS_HOST=localhost
REDIS_PORT=6380
RESEND_API_KEY=re_xxxxx           # For magic link emails
API_BASE_URL=http://localhost:3005
FRONTEND_URL=http://localhost:3000
```

### Liquidation Engine / DB Worker / Batch Uploader

```env
REDIS_HOST=localhost
REDIS_PORT=6380
DATABASE_URL=postgresql://postgres:password@localhost:5433/trading_db
```

### Price Poller / Realtime Server

```env
REDIS_HOST=localhost
REDIS_PORT=6380
```

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **BigInt (10^8 scale)** | JavaScript `Number` has floating-point precision issues. Financial calculations require exactness. |
| **Redis Streams** | Durable message delivery with replay capability, unlike Pub/Sub. Consumer groups enable horizontal scaling. |
| **In-memory engine** | Sub-millisecond order processing and liquidation detection on every price tick. Snapshots + replay provide durability. |
| **TimescaleDB** | Purpose-built for time-series. Materialized views efficiently aggregate candles across 7 timeframes. |
| **Stateless HTTP layer** | The API gateway does no state management — all order/balance state lives in the engine. Enables horizontal API scaling. |
| **Ticket-based WebSocket auth** | One-time tickets (30s TTL) avoid sending JWTs over WebSocket URLs. More secure than query-string tokens. |

---

## Performance

| Metric | Value |
|--------|-------|
| Price ingestion | ~1,000 ticks/sec per asset |
| Liquidation check | Every tick, all open orders |
| Engine request timeout | 5 seconds |
| Snapshot persistence | Every 15 seconds |
| Batch insert size | 100 messages or 5s flush |
| WebSocket broadcast | Real-time to all clients |

---

## Development

### Database Migrations

```bash
cd packages/prisma-client
bunx prisma migrate dev --name <migration_name>    # Create migration
bunx prisma migrate deploy                          # Apply migrations
bunx prisma generate                                # Regenerate client
```

### Monitoring

```bash
# Redis stream lengths
redis-cli -p 6380 XLEN request:stream
redis-cli -p 6380 XLEN response:stream

# Live price feed
redis-cli -p 6380 PSUBSCRIBE "market:*"

# Recent candles
psql -p 5433 -U postgres -d trading_db \
  -c "SELECT * FROM candles_1m ORDER BY time DESC LIMIT 10;"

# Closed orders
psql -p 5433 -U postgres -d trading_db \
  -c "SELECT asset, \"orderType\", \"finalPnLInt\", \"closeReason\" FROM closed_orders ORDER BY \"closedAt\" DESC LIMIT 10;"
```

---

## License

MIT
