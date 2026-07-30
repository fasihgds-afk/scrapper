const { connectMongo, ScrapingJob, sendJson } = require("../lib/db");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    await connectMongo();
    const url = new URL(req.url, "http://localhost");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
    const jobs = await ScrapingJob.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    sendJson(
      res,
      200,
      jobs.map((job) => ({
        jobId: String(job._id),
        name: job.name,
        sourceUrl: job.sourceUrl,
        siteKey: job.siteKey,
        status: job.status,
        totalFound: job.totalFound ?? 0,
        totalSaved: job.totalSaved ?? 0,
        totalFailed: job.totalFailed ?? 0,
        totalDuplicates: job.totalDuplicates ?? 0,
        checkpoint: job.checkpoint ?? null,
        startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
        endedAt: job.endedAt ? new Date(job.endedAt).toISOString() : null,
        createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
        updatedAt: job.updatedAt ? new Date(job.updatedAt).toISOString() : null,
      })),
    );
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Failed to list jobs",
    });
  }
};
