import { ScraperEngine, type EngineProgress } from "./scraper-engine";
import type { ExtractedRecord } from "../adapters/types";

declare global {
  interface Window {
    __scrapperEngine?: ScraperEngine;
    __scrapperBound?: boolean;
    __scrapperHeartbeat?: ReturnType<typeof setInterval>;
  }
}

const engine = window.__scrapperEngine ?? new ScraperEngine();
window.__scrapperEngine = engine;

type ContentCommand =
  | {
      type: "SCRAPER_START";
      jobId: string;
      siteKey?: string;
      batchSize?: number;
      restore?: { scrollY?: number; seenFingerprints?: string[] };
    }
  | { type: "SCRAPER_PAUSE" }
  | { type: "SCRAPER_RESUME" }
  | { type: "SCRAPER_STOP" }
  | { type: "SCRAPER_STATUS" };

function stopHeartbeat(): void {
  if (window.__scrapperHeartbeat) {
    clearInterval(window.__scrapperHeartbeat);
    window.__scrapperHeartbeat = undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendRuntime(message: unknown, attempts = 6): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await chrome.runtime.sendMessage(message);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(300 * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("extension message failed");
}

function startHeartbeat(): void {
  stopHeartbeat();
  window.__scrapperHeartbeat = setInterval(() => {
    const progress = engine.getProgress();
    if (progress.status !== "running" && progress.status !== "paused") {
      stopHeartbeat();
      return;
    }
    void chrome.runtime.sendMessage({ type: "CONTENT_HEARTBEAT", progress }).catch(() => undefined);
  }, 20_000);
}

if (!window.__scrapperBound) {
  window.__scrapperBound = true;

  chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
    void (async () => {
      try {
        switch (message.type) {
          case "SCRAPER_START": {
            startHeartbeat();
            void engine.start({
              jobId: message.jobId,
              siteKey: message.siteKey,
              batchSize: message.batchSize,
              restore: message.restore,
              onBatch: async (records, checkpoint) => {
                await sendRuntime({
                  type: "BATCH_FROM_CONTENT",
                  jobId: message.jobId,
                  records,
                  checkpoint,
                });
              },
              onStatus: (progress) => {
                if (progress.status !== "running" && progress.status !== "paused") {
                  stopHeartbeat();
                }
                void chrome.runtime.sendMessage({
                  type: "STATUS_FROM_CONTENT",
                  progress,
                });
              },
            });
            sendResponse({ ok: true, progress: engine.getProgress() });
            break;
          }
          case "SCRAPER_PAUSE":
            engine.pause();
            sendResponse({ ok: true, progress: engine.getProgress() });
            break;
          case "SCRAPER_RESUME":
            engine.resume();
            startHeartbeat();
            sendResponse({ ok: true, progress: engine.getProgress() });
            break;
          case "SCRAPER_STOP": {
            stopHeartbeat();
            const progress = await engine.stop();
            sendResponse({ ok: true, progress });
            break;
          }
          case "SCRAPER_STATUS":
            sendResponse({ ok: true, progress: engine.getProgress() });
            break;
          default:
            sendResponse({ ok: false, error: "Unknown command" });
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
}

export type { EngineProgress, ExtractedRecord };
