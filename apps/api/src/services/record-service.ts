import { Types } from "mongoose";
import { RecordModel, type RecordDoc } from "../db/models.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function serializeRecord(
  record: RecordDoc & { createdAt?: Date },
) {
  return {
    id: String(record._id),
    jobId: String(record.jobId),
    name: record.name ?? "",
    email: record.email ?? "",
    upn: record.upn ?? "",
    type: record.type ?? "",
    sourceUrl: record.sourceUrl ?? "",
    fingerprint: record.fingerprint,
    createdAt: toIso(record.createdAt),
  };
}

export type ListRecordsOptions = {
  jobId?: string;
  q?: string;
  page?: number;
  limit?: number;
};

function buildFilter(opts: { jobId?: string; q?: string }) {
  const filter: Record<string, unknown> = {};

  if (opts.jobId) {
    if (!Types.ObjectId.isValid(opts.jobId)) {
      return null;
    }
    filter.jobId = new Types.ObjectId(opts.jobId);
  }

  const query = opts.q?.trim();
  if (query) {
    const re = new RegExp(escapeRegex(query), "i");
    filter.$or = [
      { name: re },
      { email: re },
      { upn: re },
      { type: re },
    ];
  }

  return filter;
}

export async function listRecords(opts: ListRecordsOptions) {
  const filter = buildFilter(opts);
  if (filter === null) {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: opts.limit ?? 50,
      totalPages: 1,
    };
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);

  const [docs, total] = await Promise.all([
    RecordModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RecordModel.countDocuments(filter),
  ]);

  return {
    items: docs.map((doc) => serializeRecord(doc as RecordDoc & { createdAt?: Date })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function* iterateRecords(opts: {
  jobId?: string;
  q?: string;
  batchSize?: number;
  sort?: "recent" | "name";
}) {
  const filter = buildFilter(opts);
  if (filter === null) return;

  const batchSize = Math.min(Math.max(opts.batchSize ?? 500, 1), 1000);
  const sortMode = opts.sort ?? "recent";

  if (sortMode === "name") {
    let lastName: string | null = null;
    let lastEmail: string | null = null;
    let lastId: Types.ObjectId | null = null;

    for (;;) {
      const pageFilter: Record<string, unknown> =
        lastId === null
          ? filter
          : {
              $and: [
                filter,
                {
                  $or: [
                    { name: { $gt: lastName } },
                    {
                      name: lastName,
                      email: { $gt: lastEmail },
                    },
                    {
                      name: lastName,
                      email: lastEmail,
                      _id: { $gt: lastId },
                    },
                  ],
                },
              ],
            };

      const docs = (await RecordModel.find(pageFilter)
        .sort({ name: 1, email: 1, _id: 1 })
        .limit(batchSize)
        .lean()) as Array<RecordDoc & { createdAt?: Date; _id: Types.ObjectId }>;

      if (docs.length === 0) break;

      for (const doc of docs) {
        yield serializeRecord(doc);
      }

      const last = docs[docs.length - 1]!;
      lastName = String(last.name ?? "");
      lastEmail = String(last.email ?? "");
      lastId = last._id;
      if (docs.length < batchSize) break;
    }
    return;
  }

  let lastId: Types.ObjectId | null = null;

  for (;;) {
    const pageFilter =
      lastId === null
        ? filter
        : { ...filter, _id: { $lt: lastId } };

    const docs = await RecordModel.find(pageFilter)
      .sort({ _id: -1 })
      .limit(batchSize)
      .lean();

    if (docs.length === 0) break;

    for (const doc of docs) {
      yield serializeRecord(doc as RecordDoc & { createdAt?: Date });
    }

    lastId = docs[docs.length - 1]!._id as Types.ObjectId;
    if (docs.length < batchSize) break;
  }
}

export async function countRecords(opts: { jobId?: string; q?: string } = {}) {
  const filter = buildFilter(opts);
  if (filter === null) return 0;
  return RecordModel.countDocuments(filter);
}
