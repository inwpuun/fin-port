"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { adminToken } from "@/lib/env";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { importCashBook, type SourceFile } from "@/lib/cash-book/import";

async function assertUnlocked() {
  const store = await cookies();
  const ok = await verifySessionCookie(store.get(SESSION_COOKIE)?.value, adminToken());
  if (!ok) throw new Error("Session expired. Reload and unlock again.");
}

export type ImportState = {
  error?: string;
  summary?: string;
  details?: string[];
};

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Upload handler behind the cash-book page. Runs the same upsert path as the
 * CLI and the API route, so a file imported here and a file imported there
 * produce identical rows and identical ids.
 */
export async function importCashBookAction(
  _previous: ImportState,
  formData: FormData
): Promise<ImportState> {
  await assertUnlocked();

  const uploads = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!uploads.length) return { error: "Choose at least one CSV export." };

  const totalBytes = uploads.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_BYTES) {
    return {
      error: `Upload is ${Math.round(totalBytes / 1024)} KB, over the ${MAX_BYTES / 1024} KB request limit. Import fewer files at once, or run npm run db:cash-book.`
    };
  }

  try {
    const sources: SourceFile[] = await Promise.all(
      uploads.map(async (file) => ({ name: file.name, content: await file.text() }))
    );

    const report = await importCashBook(supabaseAdmin(), sources);
    revalidatePath("/cash-book");

    return {
      summary: `${report.transactionsUpserted} transactions and ${report.accountsUpserted} accounts upserted in ${report.durationMs} ms.`,
      details: report.files.map(
        (file) =>
          `${file.name}: ${file.transactions} transactions, ${file.accounts} accounts` +
          (file.skipped ? `, ${file.skipped} unparseable rows skipped` : "") +
          (file.collisions ? `, ${file.collisions} natural-key collisions kept apart` : "")
      )
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Import failed." };
  }
}
