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

Data browser (local): [http://localhost:3000/](http://localhost:3000/)

**Share with team (public):** [https://scrapper-api-0i33.onrender.com/](https://scrapper-api-0i33.onrender.com/) — live records view + CSV export. First load after idle may take ~30–60s on the free plan.

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
| GET | `/` | Data browser UI |
| GET | `/health` | Mongo readiness |
| POST | `/jobs` | Create + start job |
| GET | `/jobs` | List jobs |
| GET | `/jobs/:id` | Job detail |
| GET | `/jobs/:id/progress` | Progress + queue depth |
| PATCH | `/jobs/:id` | Update status/checkpoint |
| POST | `/jobs/:id/batches` | Accept scraped batch |
| GET | `/records` | Paginated records (`jobId`, `q`, `page`, `limit`) |
| GET | `/records/export.csv` | Download matching records as CSV |

## Docs

- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
- [Adapter guide](docs/adapter-guide.md)
