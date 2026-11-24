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
    const startDate =
      url.searchParams.get("startDate") ||
      url.searchParams.get("from_date") ||
      url.searchParams.get("dateFrom") ||
      undefined;
    const endDate =
      url.searchParams.get("endDate") ||
      url.searchParams.get("to_date") ||
      url.searchParams.get("dateTo") ||
      undefined;

    const filter = buildRecordFilter({
      jobId,
      q,
      university,
      startDate,
      endDate,
    });

    const total = await Record.countDocuments(filter);
    sendJson(res, 200, { total });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Failed to count records",
    });
  }
};
