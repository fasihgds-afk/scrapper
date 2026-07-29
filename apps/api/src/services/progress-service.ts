import { Types } from "mongoose";
import { ScrapeBatchModel } from "../db/models.js";
import { getJob, serializeJob } from "./job-service.js";

export async function getJobProgress(jobId: string) {
  const job = await getJob(jobId);
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    totalFound: job.totalFound,
    totalSaved: job.totalSaved,
    totalFailed: job.totalFailed,
    totalDuplicates: job.totalDuplicates,
    checkpoint: job.checkpoint,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    updatedAt: job.updatedAt,
  };
}

export async function getBatchQueueDepth(jobId: string) {
  if (!Types.ObjectId.isValid(jobId)) return 0;
  return ScrapeBatchModel.countDocuments({
    jobId,
    status: { $in: ["queued", "processing"] },
  });
}

export { serializeJob };
