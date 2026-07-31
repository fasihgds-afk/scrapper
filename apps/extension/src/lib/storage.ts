export type PendingBatch = {
  externalBatchId: string;
  records: Array<{
    name: string;
    email: string;
    upn: string;
    type: string;
    sourceUrl: string;
    fingerprint: string;
  }>;
  checkpoint?: {
    scrollY?: number;
    seenCount?: number;
    lastFingerprint?: string;
  };
  attempts: number;
  /** Earliest time (epoch ms) this batch may be retried after a failure */
  nextRetryAt?: number;
};

export type ExtensionState = {
  apiBaseUrl: string;
  siteKey: string;
  batchSize: number;
  jobId: string | null;
  status: string;
  localFound: number;
  scrollY: number;
  lastFingerprint?: string;
  seenFingerprints: string[];
  pendingBatches: PendingBatch[];
  serverProgress?: {
    totalFound: number;
    totalSaved: number;
    totalFailed: number;
    totalDuplicates: number;
    queueDepth?: number;
  };
};

const DEFAULT_STATE: ExtensionState = {
  apiBaseUrl: "https://scrapper-api-0i33.onrender.com",
  siteKey: "walden",
  batchSize: 200,
  jobId: null,
  status: "idle",
  localFound: 0,
  scrollY: 0,
  seenFingerprints: [],
  pendingBatches: [],
};

export async function loadState(): Promise<ExtensionState> {
  const result = await chrome.storage.local.get("scrapperState");
  return { ...DEFAULT_STATE, ...(result.scrapperState as ExtensionState | undefined) };
}

export async function saveState(patch: Partial<ExtensionState>): Promise<ExtensionState> {
  const current = await loadState();
  const next = { ...current, ...patch };
  // Cap fingerprint snapshot to keep storage bounded
  if (next.seenFingerprints.length > 10_000) {
    next.seenFingerprints = next.seenFingerprints.slice(-10_000);
  }
  await chrome.storage.local.set({ scrapperState: next });
  return next;
}

export async function clearJobState(): Promise<ExtensionState> {
  return saveState({
    jobId: null,
    status: "idle",
    localFound: 0,
    scrollY: 0,
    lastFingerprint: undefined,
    seenFingerprints: [],
    pendingBatches: [],
    serverProgress: undefined,
  });
}
