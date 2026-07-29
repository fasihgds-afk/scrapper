# Use Scrapper Pro on other laptops + live websites

Your MongoDB is already in the cloud (Atlas). Other laptops only need:

1. The Chrome extension installed
2. A **public API URL** (not `localhost`)

`localhost` only works on the same computer.

---

## A) Install the extension on another laptop

1. Copy this file to the other laptop:
   - `release/scrapper-pro-extension.zip`
2. Unzip it to a folder (example: `C:\ScrapperPro\extension`)
3. Chrome → `chrome://extensions`
4. Enable **Developer mode**
5. **Load unpacked** → select the unzipped folder (must contain `manifest.json`)

---

## B) Make the API reachable from other laptops

### Quick way (temporary): Cloudflare Tunnel / ngrok

On your main PC (where the API runs):

```powershell
npm.cmd run dev:api
```

In another terminal, create a public tunnel, e.g. with ngrok:

```powershell
ngrok http 3000
```

Copy the HTTPS URL shown (example: `https://abc123.ngrok-free.app`).

On every laptop, in the extension popup set:

- **API URL** = that HTTPS URL
- Click **Save settings**

### Better way (always on): host the API in the cloud

Deploy `apps/api` to Railway, Render, Fly.io, etc. with env:

```env
MONGODB_URI=your-atlas-uri
API_HOST=0.0.0.0
API_PORT=3000
API_CORS_ORIGIN=*
```

Then every laptop uses:

`https://your-api-domain.com`

---

## C) Scrape a live website

Each website needs its own selectors (site key). Built-in example:

| Site key | URL |
|----------|-----|
| `quotes` | http://quotes.toscrape.com/scroll |

For your own live site:

1. Inspect the page (right-click → Inspect)
2. Find the CSS selectors for each row + name/email/upn/type
3. Add a JSON file under `apps/extension/src/config/sites/`
4. Register it in `apps/extension/src/adapters/registry.ts`
5. Rebuild: `npm.cmd run build:extension`
6. Re-zip `apps/extension/dist` and update other laptops
7. In popup, set **Site key** to your new key

---

## Checklist on another laptop

1. Extension loaded
2. API URL = public HTTPS URL (not localhost)
3. Correct **Site key** for that website
4. You are on the target page tab
5. Click **Start**

Check data in MongoDB Atlas → Browse Collections → `scrapper` database.

---

See [docs/render-deploy.md](docs/render-deploy.md) to host the API on Render for other laptops.
