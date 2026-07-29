import {
  createJobSchema,
  jobCheckpointSchema,
  type CreateJobInput,
  type JobCheckpoint,
  type JobStatus,
  type UpdateJobStatusInput,
} from "@scrapper/shared";
import { Types } from "mongoose";
import { ScrapingJobModel, type ScrapingJobDoc } from "../db/models.js";

function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function serializeJob(job: ScrapingJobDoc & { createdAt?: Date; updatedAt?: Date }) {
  const checkpoint = job.checkpoint
    ? jobCheckpointSchema.parse(job.checkpoint)
    : null;

  const createdAt = job.createdAt ?? new Date();
  const updatedAt = job.updatedAt ?? createdAt;

  return {
    jobId: String(job._id),
    name: job.name,
    sourceUrl: job.sourceUrl,
    siteKey: job.siteKey,
    status: job.status as JobStatus,
    totalFound: job.totalFound,
    totalSaved: job.totalSaved,
    totalFailed: job.totalFailed,
    totalDuplicates: job.totalDuplicates,
    checkpoint,
    startedAt: toIso(job.startedAt),
    endedAt: toIso(job.endedAt),
    updatedAt: updatedAt.toISOString(),
    createdAt: createdAt.toISOString(),
  };
}

export async function createJob(input: CreateJobInput) {
  const data = createJobSchema.parse(input);
  const job = await ScrapingJobModel.create({
    name: data.name ?? `Scrape ${new URL(data.sourceUrl).hostname}`,
    sourceUrl: data.sourceUrl,
    siteKey: data.siteKey,
    status: "pending",
  });
  return serializeJob(job);
}

export async function getJob(jobId: string) {
  if (!Types.ObjectId.isValid(jobId)) return null;
  const job = await ScrapingJobModel.findById(jobId);
  return job ? serializeJob(job) : null;
}

export async function listJobs(limit = 50) {
  const jobs = await ScrapingJobModel.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200));
  return jobs.map(serializeJob);
}

export async function updateJobStatus(jobId: string, input: UpdateJobStatusInput) {
  if (!Types.ObjectId.isValid(jobId)) return null;
  const existing = await ScrapingJobModel.findById(jobId);
  if (!existing) return null;

  const now = new Date();
  existing.status = input.status;

  if (input.checkpoint || input.reason) {
    existing.checkpoint = {
      ...(existing.checkpoint ?? {}),
      ...(input.checkpoint ?? {}),
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }

  if (input.status === "running") {
    if (!existing.startedAt) existing.startedAt = now;
    existing.endedAt = null;
  }
  if (["completed", "failed", "stopped"].includes(input.status)) {
    existing.endedAt = now;
  }

  await existing.save();
  return serializeJob(existing);
}

export async function mergeCheckpoint(jobId: string, checkpoint: JobCheckpoint) {
  if (!Types.ObjectId.isValid(jobId)) return null;
  const existing = await ScrapingJobModel.findById(jobId);
  if (!existing) return null;

  existing.checkpoint = {
    ...(existing.checkpoint ?? {}),
    ...checkpoint,
  };
  await existing.save();
  return serializeJob(existing);
}

export async function incrementJobCounters(
  jobId: string,
  deltas: {
    found?: number;
    saved?: number;
    failed?: number;
    duplicates?: number;
  },
) {
  if (!Types.ObjectId.isValid(jobId)) return null;
  return ScrapingJobModel.findByIdAndUpdate(
    jobId,
    {
      $inc: {
        ...(deltas.found ? { totalFound: deltas.found } : {}),
        ...(deltas.saved ? { totalSaved: deltas.saved } : {}),
        ...(deltas.failed ? { totalFailed: deltas.failed } : {}),
        ...(deltas.duplicates ? { totalDuplicates: deltas.duplicates } : {}),
      },
    },
    { new: true },
  );
}
