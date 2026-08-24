const { connectMongo, Record, buildRecordFilter, sendText, sendJson } = require("../lib/db");

/** Keep serverless exports small enough to finish under Vercel time limits. */
const MAX_EXPORT_ROWS = 10000;
const DEDUPE_PULL_FACTOR = 6;
const MAX_PULL = 60000;

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
 * Capella is large: a Mongo name-sort over the domain filter often exceeds
 * Vercel’s time limit (Walden is small enough to pass).
 *
 * Strategy: pull a capped window with no Mongo sort (query can stop early),
 * dedupe, sort A–Z in memory, then apply from/to.
 */
async function collectUniqueRows(filter, { skip, maxRows }) {
  const pull = Math.min(
    Math.max((skip + maxRows) * DEDUPE_PULL_FACTOR, maxRows),
    MAX_PULL,
  );

  const docs = await Record.find(filter)
    .select({ name: 1, email: 1 })
    .limit(pull)
    .maxTimeMS(50_000)
    .lean();

  const seen = new Set();
  const unique = [];

  for (const doc of docs) {
    const name = cleanName(doc.name);
    const email = cleanEmail(doc.email);
    if (!name && !email) continue;
    const key = email || `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name, email });
  }

  unique.sort(compareRows);
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
