import type { FastifyPluginAsync } from "fastify";
import { batchPayloadSchema } from "@scrapper/shared";
import { Types } from "mongoose";
import { ScrapeBatchModel, ScrapingJobModel } from "../db/models.js";
import { getIngestQueue } from "../services/ingest-queue.js";
import { config } from "../config.js";

export const batchRoutes: FastifyPluginAsync = async (app) => {
  const ingestQueue = getIngestQueue(config.ingestConcurrency);

  app.post("/jobs/:id/batches", async (request, reply) => {
    const { id: jobId } = request.params as { id: string };
    if (!Types.ObjectId.isValid(jobId)) {
      return reply.code(404).send({ error: "Job not found" });
    }

    const body = batchPayloadSchema.parse(request.body);
    const job = await ScrapingJobModel.findById(jobId);
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }

    if (["stopped", "completed", "failed"].includes(job.status)) {
      return reply.code(409).send({
        error: `Job is ${job.status}; cannot accept batches`,
      });
    }

    const existing = await ScrapeBatchModel.findOne({
      jobId,
      externalBatchId: body.externalBatchId,
    });

    if (existing) {
      return reply.code(200).send({
        batchId: String(existing._id),
        externalBatchId: existing.externalBatchId,
        status: "duplicate" as const,
        recordCount: existing.recordCount,
      });
    }

    const batch = await ScrapeBatchModel.create({
      jobId,
      externalBatchId: body.externalBatchId,
      status: "queued",
      recordCount: body.records.length,
    });

    // Fire-and-forget ingest; API acknowledges immediately for reliability
    void ingestQueue
      .enqueue({
        batchId: String(batch._id),
        jobId,
        records: body.records,
        checkpoint: body.checkpoint,
      })
      .catch((err) => {
        app.log.error(
          { err, batchId: String(batch._id) },
          "batch ingest failed",
        );
      });

    return reply.code(202).send({
      batchId: String(batch._id),
      externalBatchId: body.externalBatchId,
      status: "queued" as const,
      recordCount: body.records.length,
    });
  });
};
