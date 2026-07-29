import { ApiClient } from "../lib/api-client";
import {
  loadState,
  saveState,
  type ExtensionState,
  type PendingBatch,
} from "../lib/storage";
import type { EngineProgress } from "../content/scraper-engine";
import type { ExtractedRecord } from "../adapters/types";

const api = new ApiClient("http://localhost:3000");
let progressPollTimer: ReturnType<typeof setInterval> | null = null;

async function syncApiBase(): Promise<ExtensionState> {
  const state = await loadState();
  api.setBaseUrl(state.apiBaseUrl);
  return state;
}

function uuid(): string {
  return crypto.randomUUID();
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function sendToContent(message: unknown) {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error("No active tab");
  return chrome.tabs.sendMessage(tabId, message);
}

async function enqueueAndSendBatch(
  jobId: string,
  records: ExtractedRecord[],
  checkpoint: EngineProgress,
): Promise<void> {
  const state = await syncApiBase();
  const pending: PendingBatch = {
    externalBatchId: uuid(),
    records,
    checkpoint: {
      scrollY: checkpoint.scrollY,
      seenCount: checkpoint.localFound,
      lastFingerprint: checkpoint.lastFingerprint,
    },
    attempts: 0,
  };

  const pendingBatches = [...state.pendingBatches, pending];
  const seenFingerprints = [
    ...state.seenFingerprints,
    ...records.map((r) => r.fingerprint),
  ];

  await saveState({
    pendingBatches,
    seenFingerprints,
    localFound: checkpoint.localFound,
    scrollY: checkpoint.scrollY,
    lastFingerprint: checkpoint.lastFingerprint,
    status: checkpoint.status,
  });

  await flushPendingBatches(jobId);
}

async function flushPendingBatches(jobId: string): Promise<void> {
  const state = await syncApiBase();
  const remaining: PendingBatch[] = [];

  for (const batch of state.pendingBatches) {
    try {
      await api.sendBatch(jobId, {
        externalBatchId: batch.externalBatchId,
        records: batch.records,
        checkpoint: batch.checkpoint,
      });
    } catch (err) {
      const attempts = batch.attempts + 1;
      if (attempts < 8) {
        remaining.push({ ...batch, attempts });
      }
      console.error("[scrapper] batch send failed", err);
    }
  }

  await saveState({ pendingBatches: remaining });
}

function startProgressPolling(jobId: string): void {
  stopProgressPolling();
  progressPollTimer = setInterval(() => {
    void (async () => {
      try {
        await syncApiBase();
        const progress = await api.getProgress(jobId);
        await saveState({
          status: progress.status,
          serverProgress: {
            totalFound: progress.totalFound,
            totalSaved: progress.totalSaved,
            totalFailed: progress.totalFailed,
            totalDuplicates: progress.totalDuplicates,
            queueDepth: (progress as { queueDepth?: number }).queueDepth,
          },
        });
      } catch (err) {
        console.warn("[scrapper] progress poll failed", err);
      }
    })();
  }, 2000);
}

function stopProgressPolling(): void {
  if (progressPollTimer) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case "POPUP_GET_STATE": {
          sendResponse({ ok: true, state: await loadState() });
          break;
        }
        case "POPUP_SAVE_SETTINGS": {
          const state = await saveState({
            apiBaseUrl: message.apiBaseUrl,
            siteKey: message.siteKey,
            batchSize: message.batchSize,
          });
          api.setBaseUrl(state.apiBaseUrl);
          sendResponse({ ok: true, state });
          break;
        }
        case "POPUP_START": {
          const state = await syncApiBase();
          const tabId = await getActiveTabId();
          if (!tabId) throw new Error("No active tab");
          const tab = await chrome.tabs.get(tabId);
          const sourceUrl = tab.url ?? message.sourceUrl;
          if (!sourceUrl || sourceUrl.startsWith("chrome://")) {
            throw new Error("Open a normal webpage to scrape");
          }

          const job = await api.createJob({
            name: message.name,
            sourceUrl,
            siteKey: state.siteKey,
          });

          await saveState({
            jobId: job.jobId,
            status: "running",
            localFound: 0,
            scrollY: 0,
            seenFingerprints: [],
            pendingBatches: [],
            serverProgress: {
              totalFound: 0,
              totalSaved: 0,
              totalFailed: 0,
              totalDuplicates: 0,
            },
          });

          await sendToContent({
            type: "SCRAPER_START",
            jobId: job.jobId,
            siteKey: state.siteKey,
            batchSize: state.batchSize,
          });

          startProgressPolling(job.jobId);
          sendResponse({ ok: true, jobId: job.jobId });
          break;
        }
        case "POPUP_RESUME": {
          const state = await syncApiBase();
          if (!state.jobId) throw new Error("No job to resume");

          await api.updateJob(state.jobId, {
            status: "running",
            checkpoint: {
              scrollY: state.scrollY,
              seenCount: state.localFound,
              lastFingerprint: state.lastFingerprint,
            },
          });

          // Prefer in-page resume when the engine is still paused; otherwise cold-start with checkpoint.
          let resumedInPlace = false;
          try {
            const statusRes = (await sendToContent({
              type: "SCRAPER_STATUS",
            })) as { ok?: boolean; progress?: { status?: string } };
            if (statusRes?.progress?.status === "paused") {
              await sendToContent({ type: "SCRAPER_RESUME" });
              resumedInPlace = true;
            }
          } catch {
            resumedInPlace = false;
          }

          if (!resumedInPlace) {
            await sendToContent({
              type: "SCRAPER_START",
              jobId: state.jobId,
              siteKey: state.siteKey,
              batchSize: state.batchSize,
              restore: {
                scrollY: state.scrollY,
                seenFingerprints: state.seenFingerprints,
              },
            });
          }

          await saveState({ status: "running" });
          startProgressPolling(state.jobId);
          await flushPendingBatches(state.jobId);
          sendResponse({ ok: true, jobId: state.jobId });
          break;
        }
        case "POPUP_PAUSE": {
          const state = await loadState();
          await sendToContent({ type: "SCRAPER_PAUSE" });
          if (state.jobId) {
            await syncApiBase();
            await api.updateJob(state.jobId, {
              status: "paused",
              checkpoint: {
                scrollY: state.scrollY,
                seenCount: state.localFound,
                lastFingerprint: state.lastFingerprint,
              },
            });
          }
          await saveState({ status: "paused" });
          sendResponse({ ok: true });
          break;
        }
        case "POPUP_STOP": {
          const state = await loadState();
          try {
            await sendToContent({ type: "SCRAPER_STOP" });
          } catch {
            // content script may already be gone
          }
          if (state.jobId) {
            await syncApiBase();
            await flushPendingBatches(state.jobId);
            await api.updateJob(state.jobId, {
              status: "stopped",
              checkpoint: {
                scrollY: state.scrollY,
                seenCount: state.localFound,
                lastFingerprint: state.lastFingerprint,
              },
            });
          }
          stopProgressPolling();
          await saveState({ status: "stopped" });
          sendResponse({ ok: true });
          break;
        }
        case "BATCH_FROM_CONTENT": {
          const { jobId, records, checkpoint } = message as {
            jobId: string;
            records: ExtractedRecord[];
            checkpoint: EngineProgress;
          };
          await enqueueAndSendBatch(jobId, records, checkpoint);
          if (checkpoint.status === "completed") {
            await syncApiBase();
            await api.updateJob(jobId, {
              status: "completed",
              checkpoint: {
                scrollY: checkpoint.scrollY,
                seenCount: checkpoint.localFound,
                lastFingerprint: checkpoint.lastFingerprint,
                reason: "no_new_data",
              },
              reason: "no_new_data",
            });
            stopProgressPolling();
            await saveState({ status: "completed" });
          }
          sendResponse({ ok: true });
          break;
        }
        case "STATUS_FROM_CONTENT": {
          const progress = message.progress as EngineProgress;
          await saveState({
            status: progress.status,
            localFound: progress.localFound,
            scrollY: progress.scrollY,
            lastFingerprint: progress.lastFingerprint,
          });
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message" });
      }
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
  return true;
});

// Retry pending batches periodically (network recovery)
setInterval(() => {
  void (async () => {
    const state = await loadState();
    if (state.jobId && state.pendingBatches.length > 0) {
      await flushPendingBatches(state.jobId);
    }
  })();
}, 10000);
