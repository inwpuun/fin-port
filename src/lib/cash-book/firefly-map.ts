import type { FireflyAccount, FireflySplit } from "@/lib/firefly";

/**
 * Turns Firefly III data into the cash book: one row per asset-account
 * movement, plus each account's balance.
 *
 * Pure on purpose, so the page, the THB cash rebuild and the CLI all read the
 * same thing. The rows keep the shape of the MoneyWiz export this replaced:
 *
 *  - an expense or income is one row on its asset account; a transfer is two
 *    (money out of the source, money into the destination);
 *  - the transfer's destination row reads "Transfer from <source>" when the
 *    source row reads "Transfer to ...", as MoneyWiz wrote it, and is dated by
 *    `process_date` when set -- MoneyWiz let the two sides of a transfer carry
 *    different times, and the import keeps the arriving side's time there;
 *  - "Parent ► Child" categories split into category / subcategory;
 *  - tags are written "A; B; " like the export.
 *
 * Opening balances are not rows (MoneyWiz had none); they are folded into the
 * account's balance instead.
 */

export type CashBookRow = {
  /** `ff:<journal id>:<src|dst>` */
  id: string;
  journalId: number;
  account: string;
  transferAccount: string | null;
  description: string;
  category: string | null;
  subcategory: string | null;
  /** Asia/Bangkok calendar date, YYYY-MM-DD. */
  date: string;
  /** Asia/Bangkok time, HH:mm:ss. Seconds carry the order of same-minute rows. */
  time: string;
  memo: string | null;
  amount: number;
  currency: string;
  tags: string | null;
  /** The account's balance after this row. */
  balance: number;
};

export type CashBookAccount = {
  name: string;
  currency: string;
  /** Balance after every row, future-dated ones included. */
  balance: number;
};

export type CashBook = {
  rows: CashBookRow[];
  accounts: CashBookAccount[];
  /** Latest edit to any transaction in Firefly, for the "Updated" label. */
  updatedAt: string | null;
};

const CATEGORY_SEPARATOR = "►";
const ASSET = "Asset account";
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Split types that move money on an asset account. Opening balances are handled per account. */
const LEDGER_TYPES = new Set(["withdrawal", "deposit", "transfer", "reconciliation"]);

/** Calendar date and HH:mm:ss in Asia/Bangkok (UTC+7 all year, no DST). */
export function bangkokParts(iso: string): { date: string; time: string } {
  const shifted = new Date(Date.parse(iso) + BANGKOK_OFFSET_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 19) };
}

function splitCategory(raw: string | null) {
  const parts = (raw ?? "").split(CATEGORY_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  return { category: parts[0] ?? null, subcategory: parts[1] ?? null };
}

function joinTags(tags: string[]) {
  const clean = tags.map((tag) => tag.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
  return clean.length ? `${clean.join("; ")}; ` : null;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function mapFirefly(accounts: FireflyAccount[], splits: FireflySplit[]): CashBook {
  const assetIds = new Set(accounts.map((account) => account.id));
  const isAsset = (id: string | null, type: string | null) => Boolean(id && assetIds.has(id)) || type === ASSET;

  const rows: CashBookRow[] = [];
  let updatedAt: string | null = null;

  for (const split of splits) {
    if (split.updatedAt && (!updatedAt || Date.parse(split.updatedAt) > Date.parse(updatedAt))) {
      updatedAt = split.updatedAt;
    }
    if (!LEDGER_TYPES.has(split.type)) continue;

    const sourceIsAsset = isAsset(split.sourceId, split.sourceType);
    const destinationIsAsset = isAsset(split.destinationId, split.destinationType);
    if (!sourceIsAsset && !destinationIsAsset) continue;

    const amount = Math.abs(Number(split.amount));
    const description = split.description.trim();
    const { category, subcategory } = splitCategory(split.categoryName);
    const memo = split.notes?.trim() || null;
    const tags = joinTags(split.tags);
    const bothAssets = sourceIsAsset && destinationIsAsset;

    const push = (side: "src" | "dst", account: string, signed: number, other: string | null, text: string, iso: string) => {
      const { date, time } = bangkokParts(iso);
      rows.push({
        id: `ff:${split.journalId}:${side}`,
        journalId: Number(split.journalId),
        account,
        transferAccount: other,
        description: text,
        category,
        subcategory,
        date,
        time,
        memo,
        amount: round4(signed),
        currency: split.currencyCode || "THB",
        tags,
        balance: 0
      });
    };

    if (sourceIsAsset) {
      push("src", split.sourceName!, -amount, bothAssets ? split.destinationName : null, description, split.date);
    }

    if (destinationIsAsset) {
      const arriving =
        bothAssets && /^transfer to /i.test(description) ? `Transfer from ${split.sourceName}` : description;
      push(
        "dst",
        split.destinationName!,
        amount,
        bothAssets ? split.sourceName : null,
        arriving,
        bothAssets ? split.processDate || split.date : split.date
      );
    }
  }

  // Oldest first; the running balance per account starts at its opening balance.
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.journalId - b.journalId);
  const balances = new Map(accounts.map((account) => [account.name, account.openingBalance]));
  for (const row of rows) {
    row.balance = round4((balances.get(row.account) ?? 0) + row.amount);
    balances.set(row.account, row.balance);
  }

  return {
    rows,
    accounts: accounts.map((account) => ({
      name: account.name,
      currency: account.currencyCode,
      balance: balances.get(account.name) ?? account.openingBalance
    })),
    updatedAt
  };
}
