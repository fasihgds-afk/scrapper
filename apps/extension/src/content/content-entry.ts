import { ScraperEngine, type EngineProgress } from "./scraper-engine";
import type { ExtractedRecord } from "../adapters/types";

declare global {
  interface Window {
    __scrapperEngine?: ScraperEngine;
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

chrome.runtime.onMessage.addListener((message: ContentCommand, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case "SCRAPER_START": {
          void engine.start({
            jobId: message.jobId,
            siteKey: message.siteKey,
            batchSize: message.batchSize,
            restore: message.restore,
            onBatch: async (records, checkpoint) => {
              await chrome.runtime.sendMessage({
                type: "BATCH_FROM_CONTENT",
                jobId: message.jobId,
                records,
                checkpoint,
              });
            },
            onStatus: (progress) => {
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
          sendResponse({ ok: true, progress: engine.getProgress() });
          break;
        case "SCRAPER_STOP": {
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

export type { EngineProgress, ExtractedRecord };
