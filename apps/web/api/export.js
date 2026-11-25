const { once } = require("node:events");
const { connectMongo, Record, buildRecordFilter, sendJson } = require("../lib/db");

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
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

    const formatParam = (url.searchParams.get("format") || "").toLowerCase();
    const isTsv = formatParam === "tsv" || url.pathname.endsWith(".tsv");
    const ext = isTsv ? "tsv" : "csv";

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

    const isDateMode = mode === "date" || Boolean(startDate || endDate);

    let filter;
    let skip = 0;
    let maxRows = Number.POSITIVE_INFINITY;
    let filename = "";
    const stamp = new Date().toISOString().slice(0, 10);

    if (isDateMode) {
      filter = buildRecordFilter({ jobId, q, university, startDate, endDate });
      skip = 0;
      maxRows = Number.POSITIVE_INFINITY;
      const cleanLabel = (dateLabel || `${startDate || "start"}_${endDate || "end"}`)
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 60);
      filename = `contacts_date_${cleanLabel}.${ext}`;
    } else {
      filter = buildRecordFilter({ jobId, q, university });
      const rawLimit = (url.searchParams.get("limit") || "").trim().toLowerCase();
      const hasRange = url.searchParams.has("from") || url.searchParams.has("to");

      if (!hasRange && rawLimit === "all") {
        skip = 0;
        maxRows = Number.POSITIVE_INFINITY;
        filename = `contacts_${stamp}.${ext}`;
      } else if (hasRange) {
        const fromRaw = Math.floor(Number(url.searchParams.get("from") ?? 1));
        const toRaw = Math.floor(Number(url.searchParams.get("to") ?? fromRaw));
        const from = Math.max(1, Number.isFinite(fromRaw) ? fromRaw : 1);
        const to = Math.max(from, Number.isFinite(toRaw) ? toRaw : from);
        skip = from - 1;
        maxRows = to - from + 1;
        filename = `contacts_${stamp}_${from}-${to}.${ext}`;
      } else {
        maxRows = Number.POSITIVE_INFINITY;
        filename = `contacts_${stamp}.${ext}`;
      }
    }

    let clientClosed = false;
    req.on("close", () => {
      if (!req.complete) clientClosed = true;
    });

    res.writeHead(200, {
      "Content-Type": isTsv
        ? "text/tab-separated-values; charset=utf-8"
        : "text/csv; charset=utf-8",
      "Content-Disposition": isTsv
        ? `inline; filename="${filename}"`
        : `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });

    const buffer = [];
    if (isTsv) {
      buffer.push("Name\tEmail\n");
    } else {
      buffer.push(`\uFEFF${csvCell("Name")},${csvCell("Email")}\r\n`);
    }

    const FLUSH_ROWS = 1000;
    const seen = new Set();
    let index = 0;
    let written = 0;

    async function flushBuffer() {
      if (buffer.length === 0 || res.destroyed || clientClosed) return;
      const payload = buffer.join("");
      buffer.length = 0;
      if (!res.write(payload)) {
        await once(res, "drain");
      }
    }

    const cursor = Record.find(filter)
      .select({ name: 1, email: 1, _id: 0 })
      .sort({ _id: -1 })
      .maxTimeMS(55_000)
      .lean()
      .cursor({ batchSize: 5000 });

    for await (const doc of cursor) {
      if (clientClosed || res.destroyed || written >= maxRows) break;

      const name = cleanName(doc.name);
      const email = cleanEmail(doc.email);
      if (!name && !email) continue;

      const key = email || `name:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      index += 1;
      if (index <= skip) continue;

      buffer.push(
        isTsv ? `${name}\t${email}\n` : `${csvCell(name)},${csvCell(email)}\r\n`,
      );
      written += 1;

      if (buffer.length >= FLUSH_ROWS) {
        await flushBuffer();
      }
    }

    await flushBuffer();
    if (!res.writableEnded) {
      res.end();
    }
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Failed to export data",
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
};
