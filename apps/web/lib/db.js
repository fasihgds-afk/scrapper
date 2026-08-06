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

const UNIVERSITY_DOMAINS = {
  capella: ["capella.edu", "capellauniversity.edu"],
  walden: ["waldenu.edu"],
};

function domainRegex(domains) {
  const escaped = domains.map((d) => escapeRegex(d)).join("|");
  return new RegExp(`@(?:[\\w.-]+\\.)?(?:${escaped})$`, "i");
}

function universityClause(university) {
  const key = typeof university === "string" ? university.trim().toLowerCase() : "";
  if (!key) return null;

  if (key === "capella" || key === "walden") {
    const re = domainRegex(UNIVERSITY_DOMAINS[key]);
    return { $or: [{ email: re }, { upn: re }] };
  }

  if (key === "other") {
    const allDomains = [
      ...UNIVERSITY_DOMAINS.capella,
      ...UNIVERSITY_DOMAINS.walden,
    ];
    const re = domainRegex(allDomains);
    return {
      $nor: [{ email: re }, { upn: re }],
    };
  }

  return null;
}

function buildRecordFilter({ jobId, q, university }) {
  const parts = [];

  if (jobId && mongoose.Types.ObjectId.isValid(jobId)) {
    parts.push({ jobId: new mongoose.Types.ObjectId(jobId) });
  }

  const query = typeof q === "string" ? q.trim() : "";
  if (query) {
    const re = new RegExp(escapeRegex(query), "i");
    parts.push({
      $or: [{ name: re }, { email: re }, { upn: re }, { type: re }],
    });
  }

  const uni = universityClause(university);
  if (uni) parts.push(uni);

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
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
