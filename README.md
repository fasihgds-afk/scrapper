# Scrapper Pro

Chrome MV3 TypeScript extension + Fastify API + **MongoDB** for large infinite-scroll scrapes (400k+ records). No Docker, Redis, or PostgreSQL required.

## Stack

- Chrome Manifest V3 extension (TypeScript + Vite)
- Node.js 20 + Fastify API
- MongoDB (local Windows install)
- In-process batch ingest (no Redis queue)

## Quick start

### 1. Install MongoDB

Download [MongoDB Community Server](https://www.mongodb.com/try/download/community) for Windows and install it (default port `27017`).

Optional GUI: [MongoDB Compass](https://www.mongodb.com/products/tools/compass).

### 2. Configure

```powershell
Copy-Item .env.example .env
Copy-Item .env apps\api\.env
```

Default connection:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/scrapper
```

MongoDB creates the `scrapper` database automatically on first write.

### 3. Install & run

On PowerShell (if `npm` is blocked by execution policy, use `npm.cmd`):

```powershell
npm.cmd install
npm.cmd run build:shared
npm.cmd run build:extension
npm.cmd run dev:api
```

Health: [http://localhost:3000/health](http://localhost:3000/health) — expect `"db": true`.

### 4. Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → `apps/extension/dist`
4. Open a target page (or the demo), set API URL to `http://localhost:3000`, click **Start**

### Demo page

```powershell
npx --yes serve apps/extension/demo -p 4173
```

Open `http://localhost:4173/infinite-scroll-demo.html`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Mongo readiness |
| POST | `/jobs` | Create + start job |
| GET | `/jobs` | List jobs |
| GET | `/jobs/:id` | Job detail |
| GET | `/jobs/:id/progress` | Progress + queue depth |
| PATCH | `/jobs/:id` | Update status/checkpoint |
| POST | `/jobs/:id/batches` | Accept scraped batch |

## Docs

- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
- [Adapter guide](docs/adapter-guide.md)
