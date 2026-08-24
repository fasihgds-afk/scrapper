import { createHash } from "node:crypto";
import type { ScrapedRecord } from "@scrapper/shared";
import { Types } from "mongoose";
import { BatchFailureModel, RecordModel } from "../db/models.js";

export function fingerprintRecord(record: ScrapedRecord): string {
  if (record.fingerprint && record.fingerprint.trim()) {
    return record.fingerprint.trim();
  }
  const basis = `${record.tag}|${record.email}|${record.upn}|${record.name}|${record.type}`;
  return createHash("sha256").update(basis).digest("hex");
}

export function normalizeRecord(record: ScrapedRecord, fallbackSourceUrl: string) {
  const email = (record.email ?? "").trim();
  const upn = (record.upn ?? "").trim();
  const tag = (record.tag ?? "").trim();
  return {
    name: (record.name ?? "").trim(),
    email,
    upn,
    type: (record.type ?? "").trim(),
    tag,
    sourceUrl: (record.sourceUrl || fallbackSourceUrl || "").trim(),
    fingerprint: fingerprintRecord({ ...record, email, upn, tag }),
  };
}

export async function ingestRecords(
  jobId: string,
  batchId: string,
  records: ScrapedRecord[],
  sourceUrl: string,
) {
  const normalized = records.map((r) => normalizeRecord(r, sourceUrl));
  const jobObjectId = new Types.ObjectId(jobId);
  const batchObjectId = new Types.ObjectId(batchId);

  let saved = 0;
  let duplicates = 0;
  let failed = 0;

  const chunkSize = 200;
  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize);
    try {
      const result = await RecordModel.bulkWrite(
        chunk.map((r) => ({
          updateOne: {
            filter: { fingerprint: r.fingerprint },
            update: {
              $setOnInsert: {
                jobId: jobObjectId,
                name: r.name,
                email: r.email,
                upn: r.upn,
                type: r.type,
                tag: r.tag,
                sourceUrl: r.sourceUrl,
                fingerprint: r.fingerprint,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      const upserted = result.upsertedCount ?? 0;
      saved += upserted;
      duplicates += chunk.length - upserted;
    } catch (err) {
      // ordered:false still throws on duplicate keys sometimes; count from writeErrors
      const bulkErr = err as {
        result?: { upsertedCount?: number };
        writeErrors?: Array<{ code?: number; index?: number }>;
        message?: string;
      };
      const upserted = bulkErr.result?.upsertedCount ?? 0;
      saved += upserted;

      const writeErrors = bulkErr.writeErrors ?? [];
      let dupFromErrors = 0;
      let failFromErrors = 0;
      for (const we of writeErrors) {
        if (we.code === 11000) {
          dupFromErrors += 1;
        } else {
          failFromErrors += 1;
          const row = typeof we.index === "number" ? chunk[we.index] : null;
          await BatchFailureModel.create({
            batchId: batchObjectId,
            payload: row ?? { error: "unknown row" },
            error: bulkErr.message ?? "bulk write error",
            attempts: 1,
          });
        }
      }

      duplicates += dupFromErrors;
      failed += failFromErrors;

      const accounted = upserted + dupFromErrors + failFromErrors;
      if (accounted < chunk.length) {
        duplicates += chunk.length - accounted;
      }
    }
  }

  return { saved, duplicates, failed, found: normalized.length };
}
