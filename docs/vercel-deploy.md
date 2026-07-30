# Deploy live browser to Vercel (GitHub connect)

Share the records UI with your team via a public Vercel URL. Scraping still uses the API; this app only **reads** MongoDB Atlas.

## Important

**Root Directory must be `apps/web`** — not `apps/api`, not the repo root.

If Vercel runs `tsc` / `@scrapper/api`, the root directory is wrong. Fix it in:

**Project → Settings → General → Root Directory → `apps/web` → Redeploy**

## 1. Push code

Make sure `apps/web` is on GitHub `main`.

## 2. Import in Vercel

1. Open [https://vercel.com/new](https://vercel.com/new)
2. **Import** `fasihgds-afk/scrapper`
3. Click **Edit** next to Root Directory and set:

| Field | Value |
|-------|--------|
| Framework Preset | Other |
| Root Directory | `apps/web` |
| Build Command | `npm run build` (or leave default) |
| Output Directory | `public` |
| Install Command | `npm install` |

4. **Environment Variables** → add:

| Key | Value |
|-----|--------|
| `MONGODB_URI` | Same Atlas URI as in your local `.env` |

5. Click **Deploy**

## 3. Share

After deploy you get a URL like `https://your-project.vercel.app` — send that to teammates.

## Notes

- Atlas Network Access must allow `0.0.0.0/0`.
- Do **not** commit `.env` — set `MONGODB_URI` only in the Vercel dashboard.
- `apps/api` is for Render / local Node — do not use it as the Vercel root.
