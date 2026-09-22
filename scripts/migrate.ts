/**
 * Schema migrations.
 *
 *   npm run db:migrate           # apply everything not yet applied
 *   npm run db:migrate -- --list # show what is applied and what is pending
 *
 * Files live in db/migrations/ and run in filename order. Each is applied in
 * its own transaction and recorded in schema_migrations, so a failure leaves
 * the database on the last complete migration rather than halfway through one.
 *
 * Docker Compose also mounts db/migrations/ at /docker-entrypoint-initdb.d, so
 * a fresh volume gets the schema before the app ever starts. That path does
 * not write schema_migrations, so the first run of this script re-applies
 * those files -- which is safe, because every migration here is idempotent
 * (create ... if not exists, create or replace, drop ... if exists). Keep new
 * migrations idempotent for the same reason.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { connect, loadEnv, projectRoot } from "./db";

const migrationsDir = path.join(projectRoot, "db", "migrations");

/**
 * Any session that runs migrations takes this lock first. Two `db:migrate`
 * runs at once -- a deploy racing a developer -- would otherwise both see the
 * same migration as pending and both try to apply it. Arbitrary constant; it
 * only has to be the same number in every copy of this script.
 */
const LOCK_KEY = "8233071004117";

async function main() {
  loadEnv();

  const listOnly = process.argv.slice(2).includes("--list");

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (!files.length) throw new Error(`No .sql files found in db/migrations`);

  const client = await connect();

  try {
    await client.query(`select pg_advisory_lock($1::bigint)`, [LOCK_KEY]);

    await client.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ version: string }>(
      `select version from schema_migrations`
    );
    const applied = new Set(rows.map((row) => row.version));

    if (listOnly) {
      for (const file of files) {
        console.log(`  ${applied.has(file) ? "applied" : "PENDING"}  ${file}`);
      }
      return;
    }

    let count = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip   ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const startedAt = Date.now();

      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(`insert into schema_migrations (version) values ($1)`, [file]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw new Error(`${file} failed: ${error instanceof Error ? error.message : error}`);
      }

      console.log(`  ok     ${file} (${Date.now() - startedAt} ms)`);
      count += 1;
    }

    console.log(count ? `\n${count} migration(s) applied.` : "\nAlready up to date.");
  } finally {
    await client.query(`select pg_advisory_unlock($1::bigint)`, [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\nmigrate failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
