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
    const total = await Record.countDocuments(
      buildRecordFilter({
        jobId: url.searchParams.get("jobId") || undefined,
        q: url.searchParams.get("q") || undefined,
        university: url.searchParams.get("university") || undefined,
      }),
    );
    sendJson(res, 200, { total });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Failed to count records",
    });
  }
};
