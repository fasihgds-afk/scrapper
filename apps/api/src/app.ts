import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { config } from "./config.js";
import { jobRoutes } from "./routes/jobs.js";
import { batchRoutes } from "./routes/batches.js";
import { healthRoutes } from "./routes/health.js";
import { recordRoutes } from "./routes/records.js";
import { uiRoutes } from "./routes/ui.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 5 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.corsOrigin === "*" ? true : config.corsOrigin,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Validation failed",
        details: error.flatten(),
      });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  });

  await app.register(healthRoutes);
  await app.register(jobRoutes);
  await app.register(batchRoutes);
  await app.register(recordRoutes);
  await app.register(uiRoutes);

  return { app };
}
