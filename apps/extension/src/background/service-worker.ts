import { ApiClient } from "../lib/api-client";
import {
  loadState,
  saveState,
  type ExtensionState,
  type PendingBatch,
} from "../lib/storage";
import type { EngineProgress } from "../content/scraper-engine";
import type { ExtractedRecord } from "../adapters/types";

const api = new ApiClient("https://scrapper-api-0i33.onrender.com");
let progressPollTimer: ReturnType<typeof setInterval> | null = null;
let lastTabId: number | null = null;

async function syncApiBase(): Promise<ExtensionState> {
  const state = await loadState();
  api.setBaseUrl(state.apiBaseUrl);
  return state;
}

function uuid(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (typeof tabId === "number") {
    const tab = await chrome.tabs.get(tabId);
    lastTabId = tab.id ?? null;
    if (lastTabId != null) void saveState({ lastTabId });
    return tab;
  }
  if (lastTabId != null) {
    try {
      const tab = await chrome.tabs.get(lastTabId);
      return tab;
    } catch {
      lastTabId = null;
    }
  }
  const stored = await loadState();
  if (stored.lastTabId != null) {
    try {
      const tab = await chrome.tabs.get(stored.lastTabId);
      lastTabId = tab.id ?? null;
      return tab;
    } catch {
      // tab gone
    }
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("No active tab — open a website first");
  lastTabId = tab.id;
  void saveState({ lastTabId });
  return tab;
}

function assertScrapableUrl(url: string | undefined): void {
  if (!url) throw new Error("Open a normal website tab first");
  if (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  ) {
    throw new Error(
      "Cannot scrape this page. Open http://quotes.toscrape.com/scroll , refresh it, then Start.",
    );
  }
}

async function injectContent(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"],
    });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not attach to page (${msg}). Refresh the website tab, keep it focused, then click Start again.`,
      );
    }
  }
}

/** Use the GCU members adapter when this group is on screen, even if Site key is still walden. */
async function resolveJobSiteKey(tabId: number, fallback: string): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () =>
        /GCU[-_]CON[-_]3P/i.test(
          `${document.title}\n${(document.body?.innerText ?? "").slice(0, 4000)}`,
        ),
    });
    if (results.some((r) => r.result === true)) return "gcu_con_3p";
  } catch {
    // page may still be loading
  }
  return fallback;
}
async function findMemberListFrameId(tabId: number): Promise<number | undefined> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const selectors = [
          ".ms-Persona",
          "[data-automationid='Persona']",
          ".fui-Persona",
          ".ms-DetailsRow[role='row']",
          "[data-automationid='DetailsRow']",
          ".ms-List-cell",
          "div[role='listitem']",
        ];
        let max = 0;
        for (const sel of selectors) {
          try {
            max = Math.max(max, document.querySelectorAll(sel).length);
          } catch {
            // skip
          }
        }
        return max;
      },
    });
    let bestFrameId: number | undefined;
    let bestCount = 0;
    for (const entry of results) {
      const count = Number(entry.result ?? 0);
      if (count > bestCount) {
        bestCount = count;
        bestFrameId = entry.frameId;
      }
    }
    return bestCount > 0 ? bestFrameId : undefined;
  } catch {
    return undefined;
  }
}

async function pingContent(tabId: number): Promise<boolean> {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "SCRAPER_STATUS" });
    return Boolean(res);
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingContent(tabId)) return;

  await injectContent(tabId);

  for (let i = 0; i < 25; i++) {
    if (await pingContent(tabId)) return;
    await sleep(120);
  }

  const state = await loadState();
  if (state.status === "running" || state.status === "paused") {
    throw new Error(
      "Lost connection to the page while a job is active. Refresh the website tab, then click Resume. The tab was not reloaded automatically so your progress is kept.",
    );
  }

  // Last resort only when no job is in flight — reload would kill a live scrape
  await chrome.tabs.reload(tabId);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Page reload timed out"));
    }, 15000);
    const listener = (
      updatedTabId: number,
      info: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  await sleep(400);
  await injectContent(tabId);

  for (let i = 0; i < 25; i++) {
    if (await pingContent(tabId)) return;
    await sleep(120);
  }

  throw new Error(
    "Still cannot connect to the page. Close other Chrome windows, open the target site, refresh, then Start.",
  );
}

async function sendToContent(message: unknown, tabId?: number) {
  const tab = await resolveTab(tabId);
  assertScrapableUrl(tab.url);
  const id = tab.id!;
  await ensureContentScript(id);

  const type = (message as { type?: string }).type;
  let frameId: number | undefined;
  if (type === "SCRAPER_START") {
    frameId = await findMemberListFrameId(id);
    await saveState({ scrapeFrameId: frameId ?? null });
  } else {
    const state = await loadState();
    frameId = state.scrapeFrameId ?? undefined;
  }

  try {
    return await chrome.tabs.sendMessage(
      id,
      message,
      frameId != null ? { frameId } : {},
    );
  } catch (err) {
    if (frameId != null) {
      return chrome.tabs.sendMessage(id, message);
    }
    throw err;
  }
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

function batchRetryDelayMs(attempts: number): number {
  // 1s, 2s, 4s, ... capped at 60s, plus 0–500ms jitter
  const base = Math.min(60_000, 1000 * 2 ** Math.max(0, attempts));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

async function flushPendingBatches(jobId: string): Promise<void> {
  const state = await syncApiBase();
  const remaining: PendingBatch[] = [];
  const now = Date.now();

  for (const batch of state.pendingBatches) {
    if (batch.nextRetryAt && batch.nextRetryAt > now) {
      remaining.push(batch);
      continue;
    }

    try {
      await api.sendBatch(jobId, {
        externalBatchId: batch.externalBatchId,
        records: batch.records,
        checkpoint: batch.checkpoint,
      });
    } catch (err) {
      const attempts = batch.attempts + 1;
      if (attempts < 8) {
        remaining.push({
          ...batch,
          attempts,
          nextRetryAt: now + batchRetryDelayMs(attempts),
        });
      } else {
        // Never silently drop — keep retrying on a long interval
        console.error(
          "[scrapper] batch send failed after 8 attempts; keeping for retry in 5m",
          err,
        );
        remaining.push({
          ...batch,
          attempts,
          nextRetryAt: now + 5 * 60_000,
        });
      }
      console.error("[scrapper] batch send failed", err);
    }
  }

  await saveState({ pendingBatches: remaining });
}

async function pollServerProgress(jobId: string): Promise<void> {
  try {
    await syncApiBase();
    const progress = await api.getProgress(jobId);
    // Never copy server status onto the engine. Server staying "running"
    // after a local stall is what made the popup look like it auto-resumed.
    await saveState({
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
}

async function persistTerminalStatus(
  jobId: string,
  progress: EngineProgress,
): Promise<void> {
  if (progress.status !== "completed" && progress.status !== "stopped") return;
  try {
    await syncApiBase();
    await api.updateJob(jobId, {
      status: progress.status,
      checkpoint: {
        scrollY: progress.scrollY,
        seenCount: progress.localFound,
        lastFingerprint: progress.lastFingerprint,
        reason: progress.status === "completed" ? "no_new_data" : "stopped",
      },
      reason: progress.status === "completed" ? "no_new_data" : "stopped",
    });
  } catch (err) {
    console.warn("[scrapper] failed to persist terminal job status", err);
  }
  stopProgressPolling();
}

function armKeepAlive(): void {
  void chrome.alarms.create("scrapper-tick", { periodInMinutes: 1 });
}

function startProgressPolling(jobId: string): void {
  stopProgressPolling();
  armKeepAlive();
  progressPollTimer = setInterval(() => {
    void pollServerProgress(jobId);
    void (async () => {
      const state = await loadState();
      if (state.jobId && state.pendingBatches.length > 0) {
        await flushPendingBatches(state.jobId);
      }
    })();
  }, 2000);
}

function stopProgressPolling(): void {
  if (progressPollTimer) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
  void chrome.alarms.clear("scrapper-tick");
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
          const tab = await resolveTab(message.tabId);
          assertScrapableUrl(tab.url);
          const sourceUrl = tab.url as string;
          const siteKey = await resolveJobSiteKey(tab.id!, state.siteKey);

          const job = await api.createJob({
            name: siteKey === "gcu_con_3p" ? "GCU_CON-3P" : message.name,
            sourceUrl,
            siteKey,
          });

          try {
            await sendToContent(
              {
                type: "SCRAPER_START",
                jobId: job.jobId,
                siteKey,
                batchSize: state.batchSize,
              },
              tab.id,
            );
          } catch (err) {
            await saveState({ status: "idle", jobId: null });
            throw err;
          }

          await saveState({
            jobId: job.jobId,
            status: "running",
            localFound: 0,
            scrollY: 0,
            seenFingerprints: [],
            pendingBatches: [],
            lastTabId: tab.id ?? null,
            lastHeartbeatAt: Date.now(),
            serverProgress: {
              totalFound: 0,
              totalSaved: 0,
              totalFailed: 0,
              totalDuplicates: 0,
            },
          });

          startProgressPolling(job.jobId);
          sendResponse({ ok: true, jobId: job.jobId });
          break;
        }
        case "POPUP_RESUME": {
          const state = await syncApiBase();
          if (!state.jobId) throw new Error("No job to resume");
          const tab = await resolveTab(message.tabId);

          await api.updateJob(state.jobId, {
            status: "running",
            checkpoint: {
              scrollY: state.scrollY,
              seenCount: state.localFound,
              lastFingerprint: state.lastFingerprint,
            },
          });

          let resumedInPlace = false;
          try {
            const statusRes = (await sendToContent(
              { type: "SCRAPER_STATUS" },
              tab.id,
            )) as { ok?: boolean; progress?: { status?: string } };
            if (statusRes?.progress?.status === "paused") {
              await sendToContent({ type: "SCRAPER_RESUME" }, tab.id);
              resumedInPlace = true;
            }
          } catch {
            resumedInPlace = false;
          }

          if (!resumedInPlace) {
            await sendToContent(
              {
                type: "SCRAPER_START",
                jobId: state.jobId,
                siteKey: state.siteKey,
                batchSize: state.batchSize,
                restore: {
                  scrollY: state.scrollY,
                  seenFingerprints: state.seenFingerprints,
                },
              },
              tab.id,
            );
          }

          await saveState({ status: "running", lastTabId: tab.id ?? state.lastTabId, lastHeartbeatAt: Date.now() });
          startProgressPolling(state.jobId);
          await flushPendingBatches(state.jobId);
          sendResponse({ ok: true, jobId: state.jobId });
          break;
        }
        case "POPUP_PAUSE": {
          const state = await loadState();
          const tab = await resolveTab(message.tabId);
          await sendToContent({ type: "SCRAPER_PAUSE" }, tab.id);
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
            const tab = await resolveTab(message.tabId);
            await sendToContent({ type: "SCRAPER_STOP" }, tab.id);
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
          if (checkpoint.status === "completed" || checkpoint.status === "stopped") {
            await persistTerminalStatus(jobId, checkpoint);
            await saveState({ status: checkpoint.status });
          }
          sendResponse({ ok: true });
          break;
        }
        case "STATUS_FROM_CONTENT":
        case "CONTENT_HEARTBEAT": {
          const progress = message.progress as EngineProgress;
          await saveState({
            status: progress.status,
            localFound: progress.localFound,
            scrollY: progress.scrollY,
            lastFingerprint: progress.lastFingerprint,
            lastHeartbeatAt: Date.now(),
            ...(lastTabId != null ? { lastTabId } : {}),
          });
          if (progress.jobId) {
            await persistTerminalStatus(progress.jobId, progress);
          }
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "scrapper-tick") return;
  void (async () => {
    const state = await loadState();
    if (state.jobId && state.pendingBatches.length > 0) {
      await flushPendingBatches(state.jobId);
    }
    if (state.jobId && state.status === "running") {
      await pollServerProgress(state.jobId);
      startProgressPolling(state.jobId);
      const heartbeatAge = state.lastHeartbeatAt
        ? Date.now() - state.lastHeartbeatAt
        : Number.POSITIVE_INFINITY;
      if (heartbeatAge > 45_000) {
        try {
          await sendToContent(
            {
              type: "SCRAPER_START",
              jobId: state.jobId,
              siteKey: state.siteKey,
              batchSize: state.batchSize,
              restore: {
                scrollY: state.scrollY,
                seenFingerprints: state.seenFingerprints,
              },
            },
            state.lastTabId ?? undefined,
          );
          await saveState({ lastHeartbeatAt: Date.now() });
        } catch (err) {
          console.warn("[scrapper] auto-resume after silent tab failed", err);
        }
      }
    }
  })();
});

void (async () => {
  const state = await loadState();
  if (typeof state.lastTabId === "number") lastTabId = state.lastTabId;
  if (state.jobId && (state.status === "running" || state.pendingBatches.length > 0)) {
    startProgressPolling(state.jobId);
    if (state.pendingBatches.length > 0) {
      await flushPendingBatches(state.jobId);
    }
  }
})();
