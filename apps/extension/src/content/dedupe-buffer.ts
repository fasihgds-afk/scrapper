import type { ExtractedRecord } from "../adapters/types";

export type FlushHandler = (records: ExtractedRecord[]) => void | Promise<void>;

/** Soft cap so very long runs do not grow an unbounded Set in the content tab. */
const DEFAULT_SEEN_CAP = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DedupeBuffer {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  /** Monotonic count of unique accepts (survives FIFO eviction for idle detection). */
  private acceptedTotal = 0;
  private pending: ExtractedRecord[] = [];
  private batchSize: number;
  private onFlush: FlushHandler;
  private seenCap: number;
  private flushing = false;

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
    return true;
  }

  addMany(records: ExtractedRecord[]): number {
    let added = 0;
    for (const r of records) {
      if (this.add(r)) added += 1;
    }
    return added;
  }

  /** Send full batches only. Leaves a remainder under batchSize. */
  async flushReady(): Promise<number> {
    let sent = 0;
    while (this.pending.length >= this.batchSize) {
      const n = await this.sendSlice(this.batchSize);
      if (n === 0) break;
      sent += n;
    }
    return sent;
  }

  async flush(): Promise<number> {
    if (this.pending.length === 0) return 0;
    return this.sendSlice(this.pending.length);
  }

  private async sendSlice(count: number): Promise<number> {
    if (this.flushing) return 0;
    if (this.pending.length === 0) return 0;
    this.flushing = true;
    const batch = this.pending.splice(0, Math.min(count, this.pending.length));
    try {
      await this.sendWithRetry(batch);
      return batch.length;
    } catch {
      this.pending.unshift(...batch);
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  private async sendWithRetry(batch: ExtractedRecord[]): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await this.onFlush(batch);
        return;
      } catch (err) {
        lastErr = err;
        await sleep(400 * 2 ** attempt);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("batch flush failed");
  }
}
