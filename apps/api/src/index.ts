import { buildApp } from "./app.js";
import { config } from "./config.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";

async function main() {
  await connectMongo();
  const { app } = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Shutting down (${signal})...`);
    await app.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`API listening on http://${config.host}:${config.port}`);
  app.log.info(`MongoDB: ${config.mongoUri}`);
}

main().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
