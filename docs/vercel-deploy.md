# Deploy live browser to Vercel (GitHub connect)

Share the records UI with your team via a public Vercel URL. Scraping still uses the API; this app only **reads** MongoDB Atlas.

## 1. Push code

Make sure `apps/web` is on GitHub `main` (already part of this repo).

## 2. Import in Vercel

1. Open [https://vercel.com/new](https://vercel.com/new)
2. **Import** the `fasihgds-afk/scrapper` GitHub repo
3. Project settings:

| Field | Value |
|-------|--------|
| Framework Preset | Other |
| Root Directory | `apps/web` |
| Build Command | leave empty (or `npm install`) |
| Output Directory | `public` |

4. **Environment Variables** → add:

| Key | Value |
|-----|--------|
| `MONGODB_URI` | Same Atlas URI as in your local `.env` |

5. Click **Deploy**

## 3. Share

After deploy, Vercel gives you a URL like:

`https://your-project.vercel.app`

Send that link to teammates. It shows live Name/Email data, search, filters, and CSV range export.

## Notes

- Atlas Network Access must allow `0.0.0.0/0` (or Vercel cannot reach MongoDB).
- Every push to `main` that touches `apps/web` can auto-redeploy if you keep Git connected.
- Do **not** commit `.env` — set secrets only in the Vercel dashboard.
