import type { ExtractedRecord } from "../adapters/types";

export type FlushHandler = (records: ExtractedRecord[]) => void | Promise<void>;

/** Soft cap so very long runs do not grow an unbounded Set in the content tab. */
const DEFAULT_SEEN_CAP = 25_000;

export class DedupeBuffer {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  /** Monotonic count of unique accepts (survives FIFO eviction for idle detection). */
  private acceptedTotal = 0;
  private pending: ExtractedRecord[] = [];
  private batchSize: number;
  private onFlush: FlushHandler;
  private seenCap: number;

  constructor(
    batchSize: number,
    onFlush: FlushHandler,
    seenCap = DEFAULT_SEEN_CAP,
  ) {
    this.batchSize = Math.max(1, Math.min(batchSize, 1000));
    this.onFlush = onFlush;
    this.seenCap = Math.max(1000, seenCap);
  }

  get seenCount(): number {
    return this.acceptedTotal;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  has(fingerprint: string): boolean {
    return this.seen.has(fingerprint);
  }

  restoreSeen(fingerprints: string[]): void {
    for (const fp of fingerprints) {
      if (this.seen.has(fp)) continue;
      this.trackSeen(fp);
      this.acceptedTotal += 1;
    }
  }

  exportSeenSnapshot(limit = 10_000): string[] {
    return this.seenOrder.slice(-limit);
  }

  private trackSeen(fingerprint: string): void {
    if (this.seen.has(fingerprint)) return;
    this.seen.add(fingerprint);
    this.seenOrder.push(fingerprint);
    while (this.seenOrder.length > this.seenCap) {
      const oldest = this.seenOrder.shift();
      if (oldest) this.seen.delete(oldest);
    }
  }

  add(record: ExtractedRecord): boolean {
    if (this.seen.has(record.fingerprint)) return false;
    this.trackSeen(record.fingerprint);
    this.acceptedTotal += 1;
    this.pending.push(record);
    if (this.pending.length >= this.batchSize) {
      void this.flush();
    }
    return true;
  }

  addMany(records: ExtractedRecord[]): number {
    let added = 0;
    for (const r of records) {
      if (this.add(r)) added += 1;
    }
    return added;
  }

  async flush(): Promise<number> {
    if (this.pending.length === 0) return 0;
    const batch = this.pending.splice(0, this.pending.length);
    await this.onFlush(batch);
    return batch.length;
  }
}
