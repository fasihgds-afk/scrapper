import { z } from "zod";

/** Accepts UUID or Mongo ObjectId hex strings */
export const idSchema = z
  .string()
  .min(1)
  .refine(
    (v) =>
      /^[0-9a-fA-F-]{24,36}$/.test(v) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        v,
      ),
    { message: "Invalid id" },
  );

export const scrapedRecordSchema = z.object({
  name: z.string().default(""),
  email: z.string().default(""),
  upn: z.string().default(""),
  type: z.string().default(""),
  sourceUrl: z.string().url().optional().or(z.literal("")),
  fingerprint: z.string().min(1).optional(),
});

export type ScrapedRecord = z.infer<typeof scrapedRecordSchema>;

export const batchPayloadSchema = z.object({
  externalBatchId: z.string().uuid(),
  records: z.array(scrapedRecordSchema).min(1).max(1000),
  checkpoint: z
    .object({
      scrollY: z.number().nonnegative().optional(),
      seenCount: z.number().int().nonnegative().optional(),
      lastFingerprint: z.string().optional(),
    })
    .optional(),
});

export type BatchPayload = z.infer<typeof batchPayloadSchema>;

export const batchAcceptedSchema = z.object({
  batchId: z.string().min(1),
  externalBatchId: z.string().uuid(),
  status: z.enum(["queued", "duplicate"]),
  recordCount: z.number().int().nonnegative(),
});

export type BatchAccepted = z.infer<typeof batchAcceptedSchema>;
