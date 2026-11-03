/**
 * Read-only client for the Firefly III API, the source of the cash book.
 *
 * Not `server-only`: the CLI scripts run under tsx and import it too. It is
 * still server code -- FIREFLY_TOKEN is a full-access personal access token,
 * so nothing here may be imported from a Client Component, and nothing is
 * named NEXT_PUBLIC_*.
 */

export type FireflyConfig = { url: string; token: string };

export function fireflyConfig(): FireflyConfig | null {
  const url = process.env.FIREFLY_URL?.trim().replace(/\/+$/, "");
  const token = process.env.FIREFLY_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

export type FireflyAccount = {
  id: string;
  name: string;
  type: string;
  currencyCode: string;
  openingBalance: number;
  active: boolean;
};

/** One split of a transaction group, flattened to the fields the cash book uses. */
export type FireflySplit = {
  groupId: string;
  /** When the group was last edited in Firefly. */
  updatedAt: string | null;
  journalId: string;
  type: string;
  date: string;
  processDate: string | null;
  description: string;
  amount: string;
  currencyCode: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceType: string | null;
  destinationId: string | null;
  destinationName: string | null;
  destinationType: string | null;
  categoryName: string | null;
  tags: string[];
  notes: string | null;
};

const PAGE_SIZE = 1000;
const TIMEOUT_MS = 30_000;

type Page<T> = { data: T[]; meta?: { pagination?: { total_pages?: number } } };

async function getJson<T>(config: FireflyConfig, path: string): Promise<T> {
  const response = await fetch(`${config.url}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/vnd.api+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`Firefly ${path} answered ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return (await response.json()) as T;
}

async function getAllPages<T>(config: FireflyConfig, path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const items: T[] = [];

  for (let page = 1; ; page += 1) {
    const body = await getJson<Page<T>>(config, `${path}${separator}limit=${PAGE_SIZE}&page=${page}`);
    items.push(...body.data);
    const pages = body.meta?.pagination?.total_pages ?? 1;
    if (page >= pages || !body.data.length) return items;
  }
}

type AccountResource = {
  id: string;
  attributes: {
    name: string;
    type: string;
    active: boolean;
    currency_code: string | null;
    opening_balance: string | null;
  };
};

export async function fetchAssetAccounts(config: FireflyConfig): Promise<FireflyAccount[]> {
  const rows = await getAllPages<AccountResource>(config, "/accounts?type=asset");
  return rows.map((row) => ({
    id: row.id,
    name: row.attributes.name,
    type: row.attributes.type,
    currencyCode: row.attributes.currency_code || "THB",
    openingBalance: Number(row.attributes.opening_balance ?? 0) || 0,
    active: row.attributes.active
  }));
}

type GroupResource = {
  id: string;
  attributes: {
    updated_at: string | null;
    transactions: Array<{
      transaction_journal_id: string;
      type: string;
      date: string;
      process_date: string | null;
      description: string;
      amount: string;
      currency_code: string;
      source_id: string | null;
      source_name: string | null;
      source_type: string | null;
      destination_id: string | null;
      destination_name: string | null;
      destination_type: string | null;
      category_name: string | null;
      tags: string[] | null;
      notes: string | null;
    }>;
  };
};

export async function fetchSplits(config: FireflyConfig): Promise<FireflySplit[]> {
  const groups = await getAllPages<GroupResource>(config, "/transactions?type=all");
  return groups.flatMap((group) =>
    group.attributes.transactions.map((split) => ({
      groupId: group.id,
      updatedAt: group.attributes.updated_at,
      journalId: String(split.transaction_journal_id),
      type: split.type,
      date: split.date,
      processDate: split.process_date,
      description: split.description,
      amount: split.amount,
      currencyCode: split.currency_code,
      sourceId: split.source_id,
      sourceName: split.source_name,
      sourceType: split.source_type,
      destinationId: split.destination_id,
      destinationName: split.destination_name,
      destinationType: split.destination_type,
      categoryName: split.category_name,
      tags: split.tags ?? [],
      notes: split.notes
    }))
  );
}
