import { resolveAdapterForUrl } from "../adapters/registry";
import type { ExtractedRecord, SiteAdapter } from "../adapters/types";
import { DedupeBuffer } from "./dedupe-buffer";
import { DynamicContentObserver } from "./mutation-observer";
import { RecordExtractor } from "./record-extractor";
import { ScrollController } from "./scroll-controller";
import { createShouldWait } from "./ui-guard";

export type EngineStatus = "idle" | "running" | "paused" | "stopped" | "completed";

export type EngineProgress = {
  status: EngineStatus;
  jobId: string | null;
  localFound: number;
  pendingBatch: number;
  scrollY: number;
  lastFingerprint?: string;
};

type EngineOptions = {
  jobId: string;
  siteKey?: string;
  batchSize?: number;
  onBatch: (records: ExtractedRecord[], checkpoint: EngineProgress) => Promise<void>;
  onStatus: (progress: EngineProgress) => void;
  restore?: {
    scrollY?: number;
    seenFingerprints?: string[];
  };
};

export class ScraperEngine {
  private status: EngineStatus = "idle";
  private jobId: string | null = null;
  private adapter: SiteAdapter | null = null;
  private buffer: DedupeBuffer | null = null;
  private extractor: RecordExtractor | null = null;
  private observer: DynamicContentObserver | null = null;
  private scroller: ScrollController | null = null;
  private lastFingerprint?: string;

  getProgress(): EngineProgress {
    return {
      status: this.status,
      jobId: this.jobId,
      localFound: this.buffer?.seenCount ?? 0,
      pendingBatch: this.buffer?.pendingCount ?? 0,
      scrollY: this.scroller?.scrollY ?? window.scrollY,
      lastFingerprint: this.lastFingerprint,
    };
  }

  async start(options: EngineOptions): Promise<void> {
    if (this.status === "running") return;
    if (this.status === "paused") {
      this.jobId = options.jobId;
      this.resume();
      options.onStatus(this.getProgress());
      return;
    }

    this.scroller?.stop();
    this.observer?.stop();

    this.jobId = options.jobId;
    const heading = `${document.title}\n${(document.body?.innerText ?? "").slice(0, 4000)}`;
    const siteKey = /GCU[-_]CON[-_]3P/i.test(heading)
      ? "gcu_con_3p"
      : options.siteKey;
    this.adapter = resolveAdapterForUrl(location.href, siteKey);
    const batchSize =
      options.batchSize ?? this.adapter.config.batchSize ?? 200;

    this.buffer = new DedupeBuffer(batchSize, async (records) => {
      const last = records[records.length - 1];
      this.lastFingerprint = last?.fingerprint;
      await options.onBatch(records, this.getProgress());
    });

    if (options.restore?.seenFingerprints?.length) {
      this.buffer.restoreSeen(options.restore.seenFingerprints);
    }

    let idleFlushes = 0;
    this.extractor = new RecordExtractor(this.adapter);
    this.observer = new DynamicContentObserver((nodes) => {
      if (this.status !== "running") return;
      const records = this.extractor!.extractFromNodes(nodes, location.href);
      this.ingest(records, options.onStatus);
      void this.buffer?.flushReady();
    });

    const shouldWait = createShouldWait(this.adapter.config.uiGuard);

    this.scroller = new ScrollController(
      () => this.adapter!.getScrollTarget(),
      this.adapter.config.scroll,
      () => this.buffer!.seenCount,
      async () => {
        // Fluent/virtualized lists reuse DOM nodes — rescan visible rows every tick
        if (this.status !== "running" || !this.extractor || !this.buffer) return;
        const before = this.buffer.seenCount;
        this.ingest(this.extractor.extractAll(location.href), options.onStatus);
        await this.buffer.flushReady();
        if (this.buffer.seenCount === before) {
          idleFlushes += 1;
          if (idleFlushes >= 3) {
            await this.buffer.flush();
            idleFlushes = 0;
          }
        } else {
          idleFlushes = 0;
        }
      },
      shouldWait,
    );

    if (options.restore?.scrollY) {
      await this.scroller.restorePosition(options.restore.scrollY);
    }

    this.status = "running";
    options.onStatus(this.getProgress());

    // Initial sweep of already-rendered rows
    this.ingest(this.extractor.extractAll(location.href), options.onStatus);
    await this.buffer.flushReady();
    this.observer.start(document.body);

    const result = await this.scroller.run();
    const afterStatus = this.getProgress().status;

    if (afterStatus === "paused") {
      await this.buffer.flush();
      options.onStatus(this.getProgress());
      return;
    }

    if (afterStatus === "running") {
      this.status = result === "stalled" ? "completed" : "stopped";
    }
    await this.buffer.flush();
    this.observer.stop();
    options.onStatus(this.getProgress());
  }

  pause(): void {
    if (this.status !== "running") return;
    this.status = "paused";
    this.scroller?.pause();
  }

  resume(): void {
    if (this.status !== "paused") return;
    this.status = "running";
    this.scroller?.resume();
  }

  async stop(): Promise<EngineProgress> {
    this.status = "stopped";
    this.scroller?.stop();
    this.observer?.stop();
    await this.buffer?.flush();
    return this.getProgress();
  }

  private ingest(
    records: ExtractedRecord[],
    onStatus: (progress: EngineProgress) => void,
  ): void {
    if (!this.buffer || this.status === "stopped") return;
    const added = this.buffer.addMany(records);
    if (added > 0) {
      const last = records[records.length - 1];
      if (last) this.lastFingerprint = last.fingerprint;
      onStatus(this.getProgress());
    }
  }
}
