import type { ExtractedRecord } from "../adapters/types";

export type FlushHandler = (records: ExtractedRecord[]) => void | Promise<void>;

export class DedupeBuffer {
  private seen = new Set<string>();
  private pending: ExtractedRecord[] = [];
  private batchSize: number;
  private onFlush: FlushHandler;

  constructor(batchSize: number, onFlush: FlushHandler) {
    this.batchSize = Math.max(1, Math.min(batchSize, 1000));
    this.onFlush = onFlush;
  }

  get seenCount(): number {
    return this.seen.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  has(fingerprint: string): boolean {
    return this.seen.has(fingerprint);
  }

  restoreSeen(fingerprints: string[]): void {
    for (const fp of fingerprints) this.seen.add(fp);
  }

  exportSeenSnapshot(limit = 5000): string[] {
    return Array.from(this.seen).slice(-limit);
  }

  add(record: ExtractedRecord): boolean {
    if (this.seen.has(record.fingerprint)) return false;
    this.seen.add(record.fingerprint);
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
