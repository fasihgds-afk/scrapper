# Deploy API to Render (for other laptops)

## 1. Push your code to GitHub

Create a GitHub repo and push this project (do **not** commit `.env` — it has secrets).

## 2. Create a Render Web Service

1. Go to [https://dashboard.render.com](https://dashboard.render.com) and sign up / log in
2. **New** → **Web Service**
3. Connect your GitHub repo
4. Settings:

| Field | Value |
|-------|--------|
| Name | `scrapper-api` |
| Runtime | Node |
| Build Command | `npm install && npm run build:shared && npm run build:api` |
| Start Command | `npm run start:api` |
| Instance | Free |

## 3. Environment variables

In Render → Environment, add:

| Key | Value |
|-----|--------|
| `MONGODB_URI` | Your Atlas connection string (same as local `.env`) |
| `API_HOST` | `0.0.0.0` |
| `API_CORS_ORIGIN` | `*` |
| `INGEST_CONCURRENCY` | `2` |

Render sets `PORT` automatically — the app already reads it.

## 4. MongoDB Atlas

Network Access → allow `0.0.0.0/0` (or Render will be blocked).

## 5. Deploy

Click **Create Web Service** / **Deploy**.

When live, open:

`https://YOUR-SERVICE.onrender.com/health`

You should see `"db": true`.

## 6. Use on any laptop

In Scrapper Pro popup:

```text
API URL = https://YOUR-SERVICE.onrender.com
```

No ngrok. No localhost. Works from other laptops.

### Free plan note

Render free services sleep after idle time. First request after sleep can take ~30–60 seconds.
