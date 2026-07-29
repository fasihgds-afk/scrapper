import { resolveAdapterForUrl } from "../adapters/registry";
import type { ExtractedRecord, SiteAdapter } from "../adapters/types";
import { DedupeBuffer } from "./dedupe-buffer";
import { DynamicContentObserver } from "./mutation-observer";
import { RecordExtractor } from "./record-extractor";
import { ScrollController } from "./scroll-controller";

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

    this.jobId = options.jobId;
    this.adapter = resolveAdapterForUrl(location.href, options.siteKey);
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

    this.extractor = new RecordExtractor(this.adapter);
    this.observer = new DynamicContentObserver((nodes) => {
      if (this.status !== "running") return;
      const records = this.extractor!.extractFromNodes(nodes, location.href);
      this.ingest(records, options.onStatus);
    });

    this.scroller = new ScrollController(
      this.adapter.getScrollTarget(),
      this.adapter.config.scroll,
      () => this.buffer!.seenCount,
    );

    if (options.restore?.scrollY) {
      await this.scroller.restorePosition(options.restore.scrollY);
    }

    this.status = "running";
    options.onStatus(this.getProgress());

    // Initial sweep of already-rendered rows
    this.ingest(this.extractor.extractAll(location.href), options.onStatus);
    this.observer.start(document.body);

    const result = await this.scroller.run();
    await this.buffer.flush();

    if (this.status === "paused") {
      options.onStatus(this.getProgress());
      return;
    }

    this.status = result === "stalled" ? "completed" : "stopped";
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
