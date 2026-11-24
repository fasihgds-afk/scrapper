import { createHash } from "node:crypto";
import type { ScrapedRecord } from "@scrapper/shared";
import { Types } from "mongoose";
import { BatchFailureModel, RecordModel } from "../db/models.js";

function escapeRegex(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fingerprintRecord(record: ScrapedRecord): string {
  // Deduplicate solely on email when present (name is completely ignored)
  const email = (record.email ?? "").trim().toLowerCase();
  if (email) {
    return email;
  }
  // When no email exists, fall back to hash of upn|type|tag (no name)
  const basis = `${record.tag}|${record.upn}|${record.type}`;
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

  // 1. Deduplicate within the incoming batch itself solely by email (ignoring name)
  const seenBatchEmails = new Set<string>();
  const seenBatchFps = new Set<string>();
  const deduplicatedBatch: typeof normalized = [];

  for (const r of normalized) {
    const email = r.email.trim().toLowerCase();
    if (email) {
      if (seenBatchEmails.has(email)) {
        duplicates += 1;
        continue;
      }
      seenBatchEmails.add(email);
      deduplicatedBatch.push(r);
    } else {
      if (seenBatchFps.has(r.fingerprint)) {
        duplicates += 1;
        continue;
      }
      seenBatchFps.add(r.fingerprint);
      deduplicatedBatch.push(r);
    }
  }

  const chunkSize = 200;
  for (let i = 0; i < deduplicatedBatch.length; i += chunkSize) {
    const chunk = deduplicatedBatch.slice(i, i + chunkSize);

    // 2. Check existing records in MongoDB by email (case-insensitive) to prevent saving duplicate emails
    const emailsInChunk = chunk
      .map((r) => r.email.trim().toLowerCase())
      .filter(Boolean);

    let existingEmailsInDb = new Set<string>();
    if (emailsInChunk.length > 0) {
      try {
        const existingDocs = await RecordModel.find({
          email: {
            $in: emailsInChunk.map((e) => new RegExp(`^${escapeRegex(e)}$`, "i")),
          },
        })
          .select({ email: 1 })
          .lean();

        existingEmailsInDb = new Set(
          existingDocs.map((d) => (d.email ?? "").trim().toLowerCase()),
        );
      } catch {
        // Fall back to unique fingerprint index if query fails
      }
    }

    const recordsToInsert: typeof chunk = [];
    for (const r of chunk) {
      const email = r.email.trim().toLowerCase();
      if (email && existingEmailsInDb.has(email)) {
        duplicates += 1;
      } else {
        recordsToInsert.push(r);
      }
    }

    if (recordsToInsert.length === 0) {
      continue;
    }

    try {
      const result = await RecordModel.bulkWrite(
        recordsToInsert.map((r) => ({
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
      duplicates += recordsToInsert.length - upserted;
    } catch (err) {
      // ordered:false still throws on duplicate keys; count from writeErrors
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
          const row = typeof we.index === "number" ? recordsToInsert[we.index] : null;
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
      if (accounted < recordsToInsert.length) {
        duplicates += recordsToInsert.length - accounted;
      }
    }
  }

  return { saved, duplicates, failed, found: normalized.length };
}
