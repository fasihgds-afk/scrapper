import type { ScrapedRecord } from "@scrapper/shared";
import type { JobCheckpoint } from "@scrapper/shared";
import { ScrapeBatchModel, ScrapingJobModel } from "../db/models.js";
import { ingestRecords } from "./ingest-service.js";
import { incrementJobCounters, mergeCheckpoint } from "./job-service.js";

export type IngestBatchInput = {
  batchId: string;
  jobId: string;
  records: ScrapedRecord[];
  checkpoint?: JobCheckpoint;
};

/**
 * In-process batch ingest with simple concurrency limit (no Redis).
 */
class IngestQueue {
  private active = 0;
  private pending: Array<{
    input: IngestBatchInput;
    resolve: () => void;
    reject: (err: unknown) => void;
  }> = [];

  constructor(private concurrency: number) {}

  enqueue(input: IngestBatchInput): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      this.active += 1;
      void this.run(next.input)
        .then(() => next.resolve())
        .catch((err) => next.reject(err))
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  private async run(input: IngestBatchInput): Promise<void> {
    const { batchId, jobId, records, checkpoint } = input;
    const job = await ScrapingJobModel.findById(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    await ScrapeBatchModel.findByIdAndUpdate(batchId, {
      status: "processing",
    });

    try {
      const result = await ingestRecords(
        jobId,
        batchId,
        records,
        job.sourceUrl,
      );

      await ScrapeBatchModel.findByIdAndUpdate(batchId, {
        status: "completed",
        savedCount: result.saved,
        duplicateCount: result.duplicates,
        failedCount: result.failed,
        processedAt: new Date(),
      });

      await incrementJobCounters(jobId, {
        found: result.found,
        saved: result.saved,
        failed: result.failed,
        duplicates: result.duplicates,
      });

      if (checkpoint) {
        await mergeCheckpoint(jobId, checkpoint);
      }
    } catch (err) {
      await ScrapeBatchModel.findByIdAndUpdate(batchId, {
        status: "failed",
        failedCount: records.length,
        processedAt: new Date(),
      });
      await incrementJobCounters(jobId, { failed: records.length });
      throw err;
    }
  }
}

let queue: IngestQueue | null = null;

export function getIngestQueue(concurrency = 2): IngestQueue {
  if (!queue) queue = new IngestQueue(concurrency);
  return queue;
}
