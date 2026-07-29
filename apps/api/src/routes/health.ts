import type { FastifyPluginAsync } from "fastify";
import { isMongoReady } from "../db/mongo.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    const dbOk = isMongoReady();
    return reply.code(dbOk ? 200 : 503).send({
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      mongo: dbOk,
      uptime: process.uptime(),
    });
  });
};
