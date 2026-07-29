import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  host: process.env.API_HOST ?? "0.0.0.0",
  // Render sets PORT; keep API_PORT for local use
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3000),
  corsOrigin: process.env.API_CORS_ORIGIN ?? "*",
  mongoUri: required(
    "MONGODB_URI",
    "mongodb://127.0.0.1:27017/scrapper",
  ),
  ingestConcurrency: Number(process.env.INGEST_CONCURRENCY ?? 2),
};
