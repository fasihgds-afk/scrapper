# Site Adapter Guide

Adapters are config-driven JSON files under `apps/extension/src/config/sites/`.

## Default config shape

```json
{
  "siteKey": "my-site",
  "match": ["*://example.com/*"],
  "scrollContainer": "body",
  "rowSelector": ".user-row",
  "fields": {
    "name": { "selector": ".name", "attr": "text" },
    "email": { "selector": ".email", "attr": "text" },
    "upn": { "selector": ".upn", "attr": "text" },
    "type": { "selector": ".type", "attr": "text" }
  },
  "fingerprint": ["email", "upn"],
  "scroll": { "stepPx": 800, "delayMs": 400, "idleRounds": 8 },
  "batchSize": 200
}
```

## Steps to add a website

1. Copy `default.site.json` to `my-site.site.json`.
2. Set `siteKey`, `match`, `rowSelector`, and field selectors.
3. Register it in `apps/extension/src/adapters/registry.ts`:

```ts
import mySite from "../config/sites/my-site.site.json";
registerSiteConfig(mySite as SiteConfig);
```

4. Rebuild the extension (`npm run build:extension`).
5. In the popup, set **Site key** to `my-site`.

## Field attributes

- `text` — element text content (default)
- `href` / any attribute name — `getAttribute`
- `value` — form control value

## Fingerprints

Prefer stable DOM ids (`data-id`, `id`). Otherwise the adapter joins configured fingerprint fields (`email|upn` by default).
