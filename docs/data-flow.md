# Data Flow

1. User opens target page and clicks **Start** in the popup.
2. Popup asks the service worker to create a job via `POST /jobs`.
3. Service worker commands the content script to begin scraping.
4. Content script observes DOM, scrolls, extracts fields, dedupes locally, emits batches.
5. Service worker posts batches to `POST /jobs/:id/batches`.
6. API stores a batch document and enqueues in-process ingest.
7. Ingest upserts records by `fingerprint`, updates job counters and checkpoint.
8. Popup polls progress for live metrics.

## Resume path

`chrome.storage.local` keeps `jobId`, `scrollY`, `seenFingerprints`, and `pendingBatches`. Resume restores scroll/fingerprints and flushes pending batches.
