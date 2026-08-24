const { connectMongo, Record, buildRecordFilter, sendJson } = require("../lib/db");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    await connectMongo();
    const url = new URL(req.url, "http://localhost");
    const jobId = url.searchParams.get("jobId") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const university = url.searchParams.get("university") || undefined;
    const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
    const filter = buildRecordFilter({ jobId, q, university });

    const [docs, total] = await Promise.all([
      Record.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Record.countDocuments(filter),
    ]);

    sendJson(res, 200, {
      items: docs.map((doc) => ({
        id: String(doc._id),
        jobId: String(doc.jobId),
        name: doc.name ?? "",
        email: doc.email ?? "",
        upn: doc.upn ?? "",
        type: doc.type ?? "",
        tag: doc.tag ?? "",
        sourceUrl: doc.sourceUrl ?? "",
        fingerprint: doc.fingerprint,
        createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Failed to list records",
    });
  }
};
