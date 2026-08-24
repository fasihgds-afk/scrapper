const { connectMongo, Record, buildRecordFilter, sendText, sendJson } = require("../lib/db");

const MAX_EXPORT_ROWS = 5000;
const BATCH_SIZE = 400;

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Walk name-sorted records in small keyset pages (no giant skip/limit).
 * Dedupes first, then applies from/to on unique contacts — same semantics as the Fastify API.
 */
async function collectUniqueRows(filter, { skip, maxRows }) {
  const seen = new Set();
  const rows = [];
  let uniqueIndex = 0;
  let lastName = null;
  let lastEmail = null;
  let lastId = null;

  for (;;) {
    const pageFilter =
      lastId === null
        ? filter
        : {
            $and: [
              filter,
              {
                $or: [
                  { name: { $gt: lastName } },
                  { name: lastName, email: { $gt: lastEmail } },
                  { name: lastName, email: lastEmail, _id: { $gt: lastId } },
                ],
              },
            ],
          };

    const docs = await Record.find(pageFilter)
      .sort({ name: 1, email: 1, _id: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (docs.length === 0) break;

    for (const doc of docs) {
      const name = cleanName(doc.name);
      const email = cleanEmail(doc.email);
      if (!name && !email) continue;

      const key = email || `name:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      uniqueIndex += 1;
      if (uniqueIndex <= skip) continue;

      rows.push({ name, email });
      if (rows.length >= maxRows) {
        return rows;
      }
    }

    const last = docs[docs.length - 1];
    lastName = String(last.name ?? "");
    lastEmail = String(last.email ?? "");
    lastId = last._id;
    if (docs.length < BATCH_SIZE) break;
  }

  return rows;
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
