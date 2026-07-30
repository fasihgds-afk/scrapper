const { connectMongo, Record, buildRecordFilter, sendText, sendJson } = require("../lib/db");

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
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
    const filter = buildRecordFilter({ jobId, q });

    const fromRaw = Math.floor(Number(url.searchParams.get("from") ?? 1));
    const toRaw = Math.floor(Number(url.searchParams.get("to") ?? fromRaw));
    const from = Math.max(1, Number.isFinite(fromRaw) ? fromRaw : 1);
    let to = Math.max(from, Number.isFinite(toRaw) ? toRaw : from);
    to = Math.min(to, from + 10000 - 1);
    const skip = from - 1;
    const maxRows = to - from + 1;

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `contacts_${stamp}_${from}-${to}.csv`;

    // Pull a window of sorted docs (name A-Z), then dedupe like the main API.
    const docs = await Record.find(filter)
      .sort({ name: 1, email: 1, _id: 1 })
      .skip(skip)
      .limit(Math.min(maxRows * 3, 30000))
      .lean();

    const seen = new Set();
    const lines = [`${csvCell("Name")},${csvCell("Email")}`];

    for (const doc of docs) {
      if (lines.length - 1 >= maxRows) break;
      const name = cleanName(doc.name);
      const email = cleanEmail(doc.email);
      if (!name && !email) continue;
      const key = email || `name:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${csvCell(name)},${csvCell(email)}`);
    }

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
