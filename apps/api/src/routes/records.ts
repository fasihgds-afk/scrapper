import type { FastifyPluginAsync } from "fastify";
import {
  countRecords,
  iterateRecords,
  listRecords,
} from "../services/record-service.js";

/** Always-quote CSV cells — safe for Excel / Power Query / pandas. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const recordRoutes: FastifyPluginAsync = async (app) => {
  app.get("/records", async (request) => {
    const query = request.query as {
      jobId?: string;
      q?: string;
      page?: string;
      limit?: string;
    };

    return listRecords({
      jobId: query.jobId,
      q: query.q,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50,
    });
  });

  app.get("/records/stats", async (request) => {
    const query = request.query as { jobId?: string; q?: string };
    const total = await countRecords({ jobId: query.jobId, q: query.q });
    return { total };
  });

  app.get("/records/export.csv", async (request, reply) => {
    const query = request.query as {
      jobId?: string;
      q?: string;
      limit?: string;
      from?: string;
      to?: string;
    };
    const stamp = new Date().toISOString().slice(0, 10);

    const hasRange = query.from !== undefined || query.to !== undefined;
    let skip = 0;
    let maxRows = Number.POSITIVE_INFINITY;
    let filename = `contacts_${stamp}.csv`;

    if (hasRange) {
      const fromRaw = Math.floor(Number(query.from ?? 1));
      const toRaw = Math.floor(Number(query.to ?? fromRaw));
      const from = Math.max(1, Number.isFinite(fromRaw) ? fromRaw : 1);
      const to = Math.max(from, Number.isFinite(toRaw) ? toRaw : from);
      const cappedTo = Math.min(to, from + 100_000 - 1);
      skip = from - 1;
      maxRows = cappedTo - from + 1;
      filename = `contacts_${stamp}_${from}-${cappedTo}.csv`;
    } else {
      const rawLimit = query.limit?.trim().toLowerCase();
      const unlimited = !rawLimit || rawLimit === "all";
      maxRows = unlimited
        ? Number.POSITIVE_INFINITY
        : Math.min(Math.max(Number(rawLimit) || 500, 1), 100_000);
      filename = unlimited
        ? `contacts_${stamp}.csv`
        : `contacts_${stamp}_${maxRows}.csv`;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });

    // UTF-8 BOM so Excel on Windows detects encoding correctly
    reply.raw.write("\uFEFF");
    // Title-case headers, CRLF — Excel / analyst convention
    reply.raw.write(`${csvCell("Name")},${csvCell("Email")}\r\n`);

    const seen = new Set<string>();
    let index = 0;
    let written = 0;

    try {
      for await (const row of iterateRecords({
        jobId: query.jobId,
        q: query.q,
        sort: "name",
      })) {
        if (written >= maxRows) break;

        const name = cleanName(row.name);
        const email = cleanEmail(row.email);
        if (!name && !email) continue;

        // Dedupe on email when present; otherwise name+email pair
        const key = email || `name:${name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        index += 1;
        if (index <= skip) continue;

        reply.raw.write(`${csvCell(name)},${csvCell(email)}\r\n`);
        written += 1;
      }
      reply.raw.end();
    } catch (error) {
      app.log.error(error);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });
};
