import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseCashBookCsv } from "../src/lib/cash-book/parse";
import { parseCsvRecords } from "../src/lib/csv";

const dir = path.resolve(import.meta.dirname, "..", "data");
const files = (await readdir(path.join(dir, "cash-book"))).filter((f) => f.endsWith(".csv")).sort();

const ids = new Map<string, string>();
let total = 0, collisions = 0, skipped = 0;
let minDate = "9999", maxDate = "0000", sum = 0;

for (const f of files) {
  const content = await readFile(path.join(dir, "cash-book", f), "utf8");
  const r = parseCashBookCsv(content, f);
  total += r.transactions.length; collisions += r.collisions; skipped += r.skipped;
  console.log(`${f}: ${r.transactions.length} tx, ${r.accounts.length} accounts, skipped=${r.skipped}, collisions=${r.collisions}`);
  for (const t of r.transactions) {
    if (ids.has(t.id) && ids.get(t.id) !== f) console.log("  cross-file dup id", t.id, f);
    ids.set(t.id, f);
    if (t.occurred_on < minDate) minDate = t.occurred_on;
    if (t.occurred_on > maxDate) maxDate = t.occurred_on;
    sum += t.amount;
  }
  if (f.includes("2026")) {
    console.log("  sample:", JSON.stringify(r.transactions[0], null, 1).replace(/\n\s*/g, " "));
    console.log("  accounts:", r.accounts.map(a => `${a.name}=${a.current_balance}`).join(", "));
  }
}
console.log(`\nTOTAL tx=${total} uniqueIds=${ids.size} collisions=${collisions} skipped=${skipped}`);
console.log(`date range ${minDate} .. ${maxDate}  net sum ${sum.toFixed(2)}`);

// idempotency: parse twice, ids must be identical
const c = await readFile(path.join(dir, "cash-book", files[0]), "utf8");
const a1 = parseCashBookCsv(c, files[0]).transactions.map(t => t.id).join();
const a2 = parseCashBookCsv(c, files[0]).transactions.map(t => t.id).join();
console.log("deterministic ids:", a1 === a2 ? "YES" : "NO");

for (const n of ["my-port.csv", "my-allocation.csv", "my-watchlist.csv"]) {
  const recs = parseCsvRecords(await readFile(path.join(dir, n), "utf8"));
  console.log(`${n}: ${recs.length} records, first =`, JSON.stringify(recs[0]));
}
