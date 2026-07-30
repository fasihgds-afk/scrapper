import type { FastifyPluginAsync } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
);

export const uiRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_request, reply) => {
    const html = await readFile(path.join(publicDir, "index.html"), "utf8");
    return reply.type("text/html; charset=utf-8").send(html);
  });
};
