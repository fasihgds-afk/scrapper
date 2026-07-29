# Architecture

## Overview

Scrapper Pro uses a Chrome MV3 extension for DOM extraction and a Fastify API that writes directly to MongoDB. Batches are ingested in-process with a small concurrency limit — no Redis or Docker.

## Components

1. **Popup UI** — start/pause/resume/stop and live counters
2. **Service worker** — job orchestration, batch upload retries, checkpoint persistence
3. **Content script** — MutationObserver + scroll loop + local dedupe buffer
4. **Fastify API** — jobs and batch endpoints
5. **In-process ingest queue** — concurrent bulk upserts into MongoDB
6. **MongoDB** — jobs, records, batches, failures

## Reliability

- Batches of ~200 records (configurable)
- Idempotent `externalBatchId` per batch
- Unique `fingerprint` index on records
- Pending batches retried from `chrome.storage`
- Checkpoint (`scrollY`, `seenCount`, `lastFingerprint`) saved continuously
