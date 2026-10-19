import { openDB, type IDBPDatabase } from "idb";
import { z } from "zod";

const text = z.string().max(50000);
const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z
  .string()
  .max(40)
  .refine(
    (value) => value === "" || Number.isFinite(Date.parse(value)),
    "Tanggal tidak valid",
  );
const cell = z.union([z.string().max(50000), z.number().finite(), z.null()]);

const lessonSchema = z.object({
  status: z.enum(["not-started", "learning", "completed"]),
  attempts: z.number().int().min(0).max(1000000),
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  draft: text,
  hintsUsed: z.number().int().min(0).max(100),
  updatedAt: timestamp,
  solutionViewed: z.boolean().default(false),
  understood: z.boolean().default(false),
});
const evidenceSchema = z
  .object({
    columns: z.array(z.string().max(200)).max(100),
    values: z.array(z.array(cell).max(100)).max(300),
    queryHash: text,
    datasetVersion: z.string().max(100),
    executedAt: timestamp.optional(),
  })
  .refine(
    (value) => value.values.every((row) => row.length === value.columns.length),
    "Dimensions du résultat invalides",
  );
const stageSchema = z.object({
  status: z.enum(["locked", "available", "completed"]),
  notes: text,
  query: text,
  result: evidenceSchema.optional(),
});
const progressSchema = z
  .object({
    version: z.literal(1),
    lessons: z.record(identifier, lessonSchema),
    lastLessonId: identifier,
    portfolio: z.record(identifier, stageSchema),
    activities: z
      .array(
        z.object({ id: identifier, text: z.string().max(500), at: timestamp }),
      )
      .max(2000),
    theme: z.enum(["light", "dark"]),
  })
  .refine(
    (value) =>
      Object.keys(value.lessons).length <= 500 &&
      Object.keys(value.portfolio).length <= 100,
    "Terlalu banyak entri progres",
  );

// Optional fields retain compatibility with early version-1 records.
export interface LessonProgress {
  status: "not-started" | "learning" | "completed";
  attempts: number;
  passed: boolean;
  score: number;
  draft: string;
  hintsUsed: number;
  updatedAt: string;
  solutionViewed?: boolean;
  understood?: boolean;
}
export interface PortfolioStage {
  status: "locked" | "available" | "completed";
  notes: string;
  query: string;
  result?: {
    columns: string[];
    values: unknown[][];
    queryHash: string;
    datasetVersion: string;
    executedAt?: string;
  };
}
export interface AppProgress {
  version: 1;
  lessons: Record<string, LessonProgress>;
  lastLessonId: string;
  portfolio: Record<string, PortfolioStage>;
  activities: { id: string; text: string; at: string }[];
  theme: "light" | "dark";
}

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const DB_NAME = "sql-analyst-academy";
const STORE = "app";
const KEY = "progress";
const legacyFallbackKey = "sql-analyst-academy-progress";

export const initialProgress = (): AppProgress => ({
  version: 1,
  lessons: {},
  lastLessonId: "l1",
  portfolio: {},
  activities: [],
  theme: "light",
});

let dbPromise: Promise<IDBPDatabase> | undefined;
function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
    terminated() {
      dbPromise = undefined;
    },
  }).catch((error: unknown) => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

export function validateProgress(value: unknown): AppProgress {
  const parsed = progressSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Backup/progres tidak valid pada ${first?.path.join(".") || "struktur utama"}. Data lama tidak diubah.`,
    );
  }
  return parsed.data;
}

export async function loadProgress(): Promise<AppProgress> {
  const db = await getDb();
  const saved: unknown = await db.get(STORE, KEY);
  if (saved !== undefined) return validateProgress(saved);
  // One-time migration from the old fallback. Do not silently create competing stores.
  const legacy =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(legacyFallbackKey);
  if (legacy) {
    const migrated = parseProgress(legacy);
    await db.put(STORE, migrated, KEY);
    localStorage.removeItem(legacyFallbackKey);
    return migrated;
  }
  return initialProgress();
}

let writeQueue: Promise<void> = Promise.resolve();
export function saveProgress(progress: AppProgress): Promise<void> {
  let snapshot: AppProgress;
  try {
    snapshot = validateProgress(progress);
  } catch (error) {
    return Promise.reject(error);
  }
  const write = writeQueue.then(async () => {
    const db = await getDb();
    await db.put(STORE, snapshot, KEY);
  });
  // A failed write must be reported to its caller without blocking later retries.
  writeQueue = write.catch(() => undefined);
  return write;
}

export function serializeProgress(progress: AppProgress): string {
  return JSON.stringify(
    {
      ...validateProgress(progress),
      exportedAt: new Date().toISOString(),
      app: "SQL Analyst Academy",
    },
    null,
    2,
  );
}

export function parseProgress(raw: string): AppProgress {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("Backup melebihi batas 5 MB. Data lama tidak diubah.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("File bukan JSON yang valid. Data lama tidak diubah.");
  }
  return validateProgress(parsed);
}

export function downloadText(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
