import { z } from "zod";
import { idSchema } from "./records.js";

export const jobStatusSchema = z.enum([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "stopped",
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobCheckpointSchema = z.object({
  scrollY: z.number().nonnegative().optional(),
  seenCount: z.number().int().nonnegative().optional(),
  lastFingerprint: z.string().optional(),
  reason: z.string().optional(),
});

export type JobCheckpoint = z.infer<typeof jobCheckpointSchema>;

export const createJobSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sourceUrl: z.string().url(),
  siteKey: z.string().min(1).max(100).default("default"),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobStatusSchema = z.object({
  status: jobStatusSchema,
  checkpoint: jobCheckpointSchema.optional(),
  reason: z.string().max(500).optional(),
});

export type UpdateJobStatusInput = z.infer<typeof updateJobStatusSchema>;

export const jobProgressSchema = z.object({
  jobId: idSchema,
  status: jobStatusSchema,
  totalFound: z.number().int().nonnegative(),
  totalSaved: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  totalDuplicates: z.number().int().nonnegative(),
  checkpoint: jobCheckpointSchema.nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime(),
});

export type JobProgress = z.infer<typeof jobProgressSchema>;

export const scrapingJobSchema = jobProgressSchema.extend({
  name: z.string(),
  sourceUrl: z.string(),
  siteKey: z.string(),
  createdAt: z.string().datetime(),
});

export type ScrapingJob = z.infer<typeof scrapingJobSchema>;
