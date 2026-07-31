type ExtensionState = {
  apiBaseUrl: string;
  siteKey: string;
  batchSize: number;
  jobId: string | null;
  status: string;
  localFound: number;
  pendingBatches: unknown[];
  serverProgress?: {
    totalFound: number;
    totalSaved: number;
    totalFailed: number;
    totalDuplicates: number;
    queueDepth?: number;
  };
};

const els = {
  apiBaseUrl: document.getElementById("apiBaseUrl") as HTMLInputElement,
  siteKey: document.getElementById("siteKey") as HTMLInputElement,
  batchSize: document.getElementById("batchSize") as HTMLInputElement,
  saveSettings: document.getElementById("saveSettings") as HTMLButtonElement,
  startBtn: document.getElementById("startBtn") as HTMLButtonElement,
  pauseBtn: document.getElementById("pauseBtn") as HTMLButtonElement,
  resumeBtn: document.getElementById("resumeBtn") as HTMLButtonElement,
  stopBtn: document.getElementById("stopBtn") as HTMLButtonElement,
  status: document.getElementById("status") as HTMLElement,
  jobId: document.getElementById("jobId") as HTMLElement,
  localFound: document.getElementById("localFound") as HTMLElement,
  totalSaved: document.getElementById("totalSaved") as HTMLElement,
  totalDuplicates: document.getElementById("totalDuplicates") as HTMLElement,
  totalFailed: document.getElementById("totalFailed") as HTMLElement,
  queueDepth: document.getElementById("queueDepth") as HTMLElement,
  pendingBatches: document.getElementById("pendingBatches") as HTMLElement,
  error: document.getElementById("error") as HTMLElement,
};

function showError(msg: string | null) {
  if (!msg) {
    els.error.hidden = true;
    els.error.textContent = "";
    return;
  }
  els.error.hidden = false;
  els.error.textContent = msg;
}

function render(state: ExtensionState) {
  els.apiBaseUrl.value = state.apiBaseUrl;
  els.siteKey.value = state.siteKey;
  els.batchSize.value = String(state.batchSize);
  els.status.textContent = state.status;
  els.jobId.textContent = state.jobId ? state.jobId.slice(0, 8) + "…" : "—";
  els.localFound.textContent = String(state.localFound);
  els.totalSaved.textContent = String(state.serverProgress?.totalSaved ?? 0);
  els.totalDuplicates.textContent = String(
    state.serverProgress?.totalDuplicates ?? 0,
  );
  els.totalFailed.textContent = String(state.serverProgress?.totalFailed ?? 0);
  els.queueDepth.textContent = String(state.serverProgress?.queueDepth ?? 0);
  els.pendingBatches.textContent = String(state.pendingBatches.length);

  const running = state.status === "running";
  const paused = state.status === "paused";
  els.startBtn.disabled = running || paused;
  els.pauseBtn.disabled = !running;
  els.resumeBtn.disabled = !paused && !(state.jobId && state.status === "stopped");
  els.stopBtn.disabled = !running && !paused;
}

async function getPageTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("Open a website tab first");
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    throw new Error("Switch to the website tab (not chrome://extensions), then open Scrapper Pro again");
  }
  return tab.id;
}

async function send(type: string, payload: Record<string, unknown> = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res?.ok) throw new Error(res?.error ?? "Request failed");
  return res;
}

async function refresh() {
  const res = await send("POPUP_GET_STATE");
  render(res.state as ExtensionState);
}

els.saveSettings.addEventListener("click", () => {
  void (async () => {
    try {
      showError(null);
      await send("POPUP_SAVE_SETTINGS", {
        apiBaseUrl: els.apiBaseUrl.value.trim().replace(/\/$/, ""),
        siteKey: els.siteKey.value.trim() || "quotes",
        batchSize: Number(els.batchSize.value) || 200,
      });
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  })();
});

els.startBtn.addEventListener("click", () => {
  void (async () => {
    try {
      showError(null);
      const tabId = await getPageTabId();
      await send("POPUP_SAVE_SETTINGS", {
        apiBaseUrl: els.apiBaseUrl.value.trim().replace(/\/$/, ""),
        siteKey: els.siteKey.value.trim() || "quotes",
        batchSize: Number(els.batchSize.value) || 200,
      });
      await send("POPUP_START", { tabId });
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      await refresh().catch(() => undefined);
    }
  })();
});

els.pauseBtn.addEventListener("click", () => {
  void (async () => {
    try {
      showError(null);
      const tabId = await getPageTabId();
      await send("POPUP_PAUSE", { tabId });
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  })();
});

els.resumeBtn.addEventListener("click", () => {
  void (async () => {
    try {
      showError(null);
      const tabId = await getPageTabId();
      await send("POPUP_RESUME", { tabId });
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  })();
});

els.stopBtn.addEventListener("click", () => {
  void (async () => {
    try {
      showError(null);
      let tabId: number | undefined;
      try {
        tabId = await getPageTabId();
      } catch {
        tabId = undefined;
      }
      await send("POPUP_STOP", tabId ? { tabId } : {});
      await refresh();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    }
  })();
});

void refresh();
setInterval(() => void refresh().catch(() => undefined), 1500);
