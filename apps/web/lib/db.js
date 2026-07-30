const mongoose = require("mongoose");

const globalKey = "__scrapper_mongoose__";
const cached = global[globalKey] || { conn: null, promise: null };
global[globalKey] = cached;

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 12000,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

const jobSchema = new mongoose.Schema(
  {
    name: String,
    sourceUrl: String,
    siteKey: String,
    status: String,
    totalFound: Number,
    totalSaved: Number,
    totalFailed: Number,
    totalDuplicates: Number,
    checkpoint: mongoose.Schema.Types.Mixed,
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true, collection: "scrapingjobs" },
);

const recordSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
    email: String,
    upn: String,
    type: String,
    sourceUrl: String,
    fingerprint: String,
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "records" },
);

const ScrapingJob =
  mongoose.models.ScrapingJob || mongoose.model("ScrapingJob", jobSchema);
const Record =
  mongoose.models.Record || mongoose.model("Record", recordSchema);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRecordFilter({ jobId, q }) {
  const filter = {};
  if (jobId && mongoose.Types.ObjectId.isValid(jobId)) {
    filter.jobId = new mongoose.Types.ObjectId(jobId);
  }
  const query = typeof q === "string" ? q.trim() : "";
  if (query) {
    const re = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ name: re }, { email: re }, { upn: re }, { type: re }];
  }
  return filter;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(body);
}

module.exports = {
  connectMongo,
  ScrapingJob,
  Record,
  buildRecordFilter,
  sendJson,
  sendText,
};
