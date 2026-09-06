import { NextRequest } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { importCashBook, type SourceFile } from "@/lib/cash-book/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel caps a serverless request body at ~4.5 MB; refuse early and clearly. */
const MAX_BYTES = 4 * 1024 * 1024;

async function readSources(request: NextRequest): Promise<SourceFile[]> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const entries = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    const single = form.get("file");
    if (single instanceof File) entries.push(single);

    const total = entries.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_BYTES) {
      throw new Error(`Upload is ${Math.round(total / 1024)} KB; the limit is ${MAX_BYTES / 1024} KB. Import fewer files at a time, or use the CLI.`);
    }

    return Promise.all(
      entries.map(async (file) => ({ name: file.name, content: await file.text() }))
    );
  }

  const body = await request.json();
  const files = Array.isArray(body?.files) ? body.files : [];

  return files
    .filter((file: unknown): file is { name?: string; content?: string } => Boolean(file))
    .map((file: { name?: string; content?: string }, index: number) => ({
      name: String(file.name ?? `upload-${index + 1}.csv`),
      content: String(file.content ?? "")
    }))
    .filter((file: SourceFile) => file.content.trim().length > 0);
}

/**
 * Converts one or more cash-book CSV exports into Postgres rows in upsert
 * mode. Row ids are content hashes, so importing the same file twice is a
 * no-op and importing a corrected export updates the affected rows in place.
 *
 * Accepts multipart/form-data with a `files` field, or
 * JSON: { "files": [{ "name": "report-2026.csv", "content": "..." }] }
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorized();

  try {
    const sources = await readSources(request);
    if (!sources.length) {
      return Response.json({ error: "No CSV content received" }, { status: 400 });
    }

    const report = await importCashBook(supabaseAdmin(), sources);
    return Response.json({ ok: true, report });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
