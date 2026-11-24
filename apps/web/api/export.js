const { connectMongo, Record, buildRecordFilter, sendText, sendJson } = require("../lib/db");

/** Max contacts per Copy / CSV request for row-range mode. */
const MAX_EXPORT_ROWS = 10000;
/** Max contacts for date-based export so users can export full date collections (e.g. 1,000–10,000 leads). */
const MAX_DATE_EXPORT_ROWS = 50000;

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function compareRows(a, b) {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.email.localeCompare(b.email);
}

/**
 * Build unique A–Z list for the filter, then slice [skip, skip+maxRows).
 * Optimized batch cursor to avoid memory bloat.
 */
async function collectUniqueRows(filter, { skip = 0, maxRows = MAX_EXPORT_ROWS }) {
  const seen = new Map();
  const cursor = Record.find(filter)
    .select({ name: 1, email: 1, _id: 0 })
    .maxTimeMS(55_000)
    .lean()
    .cursor({ batchSize: 2000 });

  for await (const doc of cursor) {
    const name = cleanName(doc.name);
    const email = cleanEmail(doc.email);
    if (!name && !email) continue;
    const key = email || `name:${name.toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { name, email });
  }

  const unique = [...seen.values()].sort(compareRows);
  return unique.slice(skip, skip + maxRows);
}

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

    const mode = (url.searchParams.get("mode") || "").toLowerCase();
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
    const dateLabel = url.searchParams.get("dateLabel") || undefined;

    // Mutually exclusive: if mode is 'date' or startDate/endDate is given, export strictly by date
    const isDateMode = mode === "date" || Boolean(startDate || endDate);

    let filter;
    let skip = 0;
    let maxRows = MAX_EXPORT_ROWS;
    let filename = "";
    const stamp = new Date().toISOString().slice(0, 10);

    if (isDateMode) {
      filter = buildRecordFilter({ jobId, q, university, startDate, endDate });
      skip = 0;
      maxRows = MAX_DATE_EXPORT_ROWS;
      const cleanLabel = (dateLabel || `${startDate || "start"}_${endDate || "end"}`)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 60);
      filename = `contacts_date_${cleanLabel}.csv`;
    } else {
      filter = buildRecordFilter({ jobId, q, university });
      const fromRaw = Math.floor(Number(url.searchParams.get("from") ?? 1));
      const toRaw = Math.floor(Number(url.searchParams.get("to") ?? fromRaw));
      const from = Math.max(1, Number.isFinite(fromRaw) ? fromRaw : 1);
      let to = Math.max(from, Number.isFinite(toRaw) ? toRaw : from);
      // Auto-cap any window to 10k rows (e.g. 10000–20000 → 10000–19999)
      to = Math.min(to, from + MAX_EXPORT_ROWS - 1);
      skip = from - 1;
      maxRows = to - from + 1;
      filename = `contacts_${stamp}_${from}-${to}.csv`;
    }

    const rows = await collectUniqueRows(filter, { skip, maxRows });
    const lines = [
      `${csvCell("Name")},${csvCell("Email")}`,
      ...rows.map((row) => `${csvCell(row.name)},${csvCell(row.email)}`),
    ];

    const body = `\uFEFF${lines.join("\r\n")}\r\n`;
    sendText(res, 200, body, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Failed to export CSV",
    });
  }
};
