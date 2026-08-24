const { connectMongo, Record, buildRecordFilter, sendText, sendJson } = require("../lib/db");

/** Max contacts per Copy / CSV request (any From–To window). */
const MAX_EXPORT_ROWS = 10000;

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
 * Build the full unique A–Z list for the filter, then slice [skip, skip+maxRows).
 * Needed so ranges like 10000–19999 work, not only 1–10000.
 */
async function collectUniqueRows(filter, { skip, maxRows }) {
  const seen = new Map();
  const cursor = Record.find(filter)
    .select({ name: 1, email: 1 })
    .maxTimeMS(55_000)
    .lean()
    .cursor({ batchSize: 1500 });

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
    const filter = buildRecordFilter({ jobId, q, university });

    const fromRaw = Math.floor(Number(url.searchParams.get("from") ?? 1));
    const toRaw = Math.floor(Number(url.searchParams.get("to") ?? fromRaw));
    const from = Math.max(1, Number.isFinite(fromRaw) ? fromRaw : 1);
    let to = Math.max(from, Number.isFinite(toRaw) ? toRaw : from);
    // Auto-cap any window to 10k rows (e.g. 10000–20000 → 10000–19999)
    to = Math.min(to, from + MAX_EXPORT_ROWS - 1);
    const skip = from - 1;
    const maxRows = to - from + 1;

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `contacts_${stamp}_${from}-${to}.csv`;

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
