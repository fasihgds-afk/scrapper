import { Schema, model, type InferSchemaType, Types } from "mongoose";

export const JOB_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "stopped",
] as const;

export type JobStatusValue = (typeof JOB_STATUSES)[number];

const jobCheckpointSchema = new Schema(
  {
    scrollY: Number,
    seenCount: Number,
    lastFingerprint: String,
    reason: String,
  },
  { _id: false },
);

const scrapingJobSchema = new Schema(
  {
    name: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    siteKey: { type: String, default: "default" },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: "pending",
      index: true,
    },
    totalFound: { type: Number, default: 0 },
    totalSaved: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
    totalDuplicates: { type: Number, default: 0 },
    checkpoint: { type: jobCheckpointSchema, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

scrapingJobSchema.index({ createdAt: -1 });

export type ScrapingJobDoc = InferSchemaType<typeof scrapingJobSchema> & {
  _id: Types.ObjectId;
};

export const ScrapingJobModel = model("ScrapingJob", scrapingJobSchema);

const recordSchema = new Schema(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "ScrapingJob",
      required: true,
      index: true,
    },
    name: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    upn: { type: String, default: "" },
    type: { type: String, default: "" },
    sourceUrl: { type: String, default: "" },
    fingerprint: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

recordSchema.index({ email: 1, upn: 1 });
recordSchema.index({ createdAt: -1 });

export type RecordDoc = InferSchemaType<typeof recordSchema> & {
  _id: Types.ObjectId;
};

export const RecordModel = model("Record", recordSchema);

const BATCH_STATUSES = ["queued", "processing", "completed", "failed"] as const;

const scrapeBatchSchema = new Schema(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "ScrapingJob",
      required: true,
      index: true,
    },
    externalBatchId: { type: String, required: true },
    status: {
      type: String,
      enum: BATCH_STATUSES,
      default: "queued",
      index: true,
    },
    recordCount: { type: Number, default: 0 },
    savedCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    processedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

scrapeBatchSchema.index({ jobId: 1, externalBatchId: 1 }, { unique: true });

export type ScrapeBatchDoc = InferSchemaType<typeof scrapeBatchSchema> & {
  _id: Types.ObjectId;
};

export const ScrapeBatchModel = model("ScrapeBatch", scrapeBatchSchema);

const batchFailureSchema = new Schema(
  {
    batchId: {
      type: Schema.Types.ObjectId,
      ref: "ScrapeBatch",
      required: true,
      index: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
    error: { type: String, required: true },
    attempts: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const BatchFailureModel = model("BatchFailure", batchFailureSchema);
