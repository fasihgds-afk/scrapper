import type { FastifyPluginAsync } from "fastify";
import { createJobSchema, updateJobStatusSchema } from "@scrapper/shared";
import {
  createJob,
  getJob,
  listJobs,
  updateJobStatus,
} from "../services/job-service.js";
import {
  getBatchQueueDepth,
  getJobProgress,
} from "../services/progress-service.js";

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.post("/jobs", async (request, reply) => {
    const body = createJobSchema.parse(request.body);
    const job = await createJob(body);
    const running = await updateJobStatus(job.jobId, { status: "running" });
    return reply.code(201).send(running);
  });

  app.get("/jobs", async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    return listJobs(limit);
  });

  app.get("/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getJob(id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return job;
  });

  app.get("/jobs/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const progress = await getJobProgress(id);
    if (!progress) return reply.code(404).send({ error: "Job not found" });
    const queueDepth = await getBatchQueueDepth(id);
    return { ...progress, queueDepth };
  });

  app.patch("/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = updateJobStatusSchema.parse(request.body);
    const job = await updateJobStatus(id, body);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return job;
  });
};
