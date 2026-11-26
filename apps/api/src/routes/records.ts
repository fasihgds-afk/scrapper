import { once } from "node:events";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  countRecords,
  listRecords,
  streamExportRecords,
} from "../services/record-service.js";

/** Always-quote CSV cells — safe for Excel / Power Query / pandas. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanEmail(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

type ExportQuery = {
  jobId?: string;
  q?: string;
  university?: string;
  mode?: string;
  startDate?: string;
  endDate?: string;
  from_date?: string;
  to_date?: string;
  dateFrom?: string;
  dateTo?: string;
  dateLabel?: string;
  limit?: string;
  from?: string;
  to?: string;
  /** Pass dedupe=0 to skip email-deduplication and stream every raw row */
  dedupe?: string;
};

function resolveExportParams(query: ExportQuery, ext: "csv" | "tsv") {
  const stamp = new Date().toISOString().slice(0, 10);
  const startDate = query.startDate || query.from_date || query.dateFrom;
  const endDate = query.endDate || query.to_date || query.dateTo;
  const isDateMode = query.mode === "date" || Boolean(startDate || endDate);

  let skip = 0;
  let maxRows = Number.POSITIVE_INFINITY;
  let filename = `contacts_${stamp}.${ext}`;

  if (isDateMode) {
    skip = 0;
    maxRows = Number.POSITIVE_INFINITY;
    const cleanLabel = (
      query.dateLabel || `${startDate || "start"}_${endDate || "end"}`
    )
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 60);
    filename = `contacts_date_${cleanLabel}.${ext}`;
  } else {
    const hasRange = query.from !== undefined || query.to !== undefined;
    if (hasRange) {
      const fromRaw = Math.floor(Number(query.from ?? 1));
      const toRaw = Math.floor(Number(query.to ?? fromRaw));
      const from = Math.max(1, Number.isFinite(fromRaw) ? fromRaw : 1);
      const to = Math.max(from, Number.isFinite(toRaw) ? toRaw : from);
      skip = from - 1;
      maxRows = to - from + 1;
      filename = `contacts_${stamp}_${from}-${to}.${ext}`;
    } else {
      const rawLimit = query.limit?.trim().toLowerCase();
      const unlimited = !rawLimit || rawLimit === "all";
      maxRows = unlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(Number(rawLimit) || 500, 1);
      filename = unlimited
        ? `contacts_${stamp}.${ext}`
        : `contacts_${stamp}_${maxRows}.${ext}`;
    }
  }

  return { startDate, endDate, skip, maxRows, filename };
}

async function streamExportResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  format: "csv" | "tsv",
) {
  const query = request.query as ExportQuery;
  const { startDate, endDate, skip, maxRows, filename } = resolveExportParams(
    query,
    format,
  );
  const isTsv = format === "tsv";

  let clientClosed = false;
  request.raw.on("close", () => {
    if (!request.raw.complete) clientClosed = true;
  });

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": isTsv
      ? "text/tab-separated-values; charset=utf-8"
      : "text/csv; charset=utf-8",
    "Content-Disposition": isTsv
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });

  const buffer: string[] = [];
  if (isTsv) {
    buffer.push("Name\tEmail\n");
  } else {
    // UTF-8 BOM + Title-case headers, CRLF — Excel / analyst convention
    buffer.push(`\uFEFF${csvCell("Name")},${csvCell("Email")}\r\n`);
  }

  // dedupe=0 → stream every raw row (all data, no skipping duplicates)
  // dedupe=1 (default) → skip rows with the same email/name key
  const doDedupe = query.dedupe !== "0";

  const FLUSH_ROWS = 1000;
  const seen = doDedupe ? new Set<string>() : null;
  let index = 0;
  let written = 0;

  async function flushBuffer() {
    if (buffer.length === 0 || reply.raw.destroyed || clientClosed) return;
    const payload = buffer.join("");
    buffer.length = 0;
    if (!reply.raw.write(payload)) {
      await once(reply.raw, "drain");
    }
  }

  try {
    for await (const row of streamExportRecords({
      jobId: query.jobId,
      q: query.q,
      university: query.university,
      startDate,
      endDate,
    })) {
      if (clientClosed || reply.raw.destroyed || written >= maxRows) break;

      const name = cleanName(row.name);
      const email = cleanEmail(row.email);
      if (!name && !email) continue;

      if (seen) {
        // Dedupe on email when present; otherwise name-based key
        const key = email || `name:${name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }

      index += 1;
      if (index <= skip) continue;

      buffer.push(
        isTsv
          ? `${name}\t${email}\n`
          : `${csvCell(name)},${csvCell(email)}\r\n`,
      );
      written += 1;

      if (buffer.length >= FLUSH_ROWS) {
        await flushBuffer();
      }
    }

    await flushBuffer();
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  } catch (error) {
    request.log.error(error);
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
}

export const recordRoutes: FastifyPluginAsync = async (app) => {
  app.get("/records", async (request) => {
    const query = request.query as {
      jobId?: string;
      q?: string;
      university?: string;
      startDate?: string;
      endDate?: string;
      from_date?: string;
      to_date?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      limit?: string;
    };

    return listRecords({
      jobId: query.jobId,
      q: query.q,
      university: query.university,
      startDate: query.startDate || query.from_date || query.dateFrom,
      endDate: query.endDate || query.to_date || query.dateTo,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50,
    });
  });

  app.get("/records/stats", async (request) => {
    const query = request.query as {
      jobId?: string;
      q?: string;
      university?: string;
      startDate?: string;
      endDate?: string;
      from_date?: string;
      to_date?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    const total = await countRecords({
      jobId: query.jobId,
      q: query.q,
      university: query.university,
      startDate: query.startDate || query.from_date || query.dateFrom,
      endDate: query.endDate || query.to_date || query.dateTo,
    });
    return { total };
  });

  app.get("/records/export.csv", async (request, reply) => {
    return streamExportResponse(request, reply, "csv");
  });

  app.get("/records/export.tsv", async (request, reply) => {
    return streamExportResponse(request, reply, "tsv");
  });
};
