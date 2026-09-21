#!/usr/bin/env node
/**
 * Offline backup for the Drift Tickets Supabase project.
 *
 * The project now lives on a Free-plan organisation, which has no daily
 * backups, so this script is the safety net: it pulls every public table, the
 * Auth user list and every Storage object through the service-role API and
 * writes them to a timestamped folder OUTSIDE the repo (and outside OneDrive).
 *
 *   npm run backup                 # full backup
 *   npm run backup -- --dry-run    # count rows/files, write nothing
 *   node scripts/backup.mjs --out D:\drift-backups --keep 30
 *
 * Restore = run the migrations on an empty project, then psql the data.sql this
 * writes. Each backup folder gets a RESTORE.md with the exact steps.
 *
 * No npm dependencies on purpose: it uses global fetch, so it still runs when
 * node_modules is missing or half-dehydrated by OneDrive.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Tables in foreign-key-safe insert order: a child never precedes its parent.
 * If a migration adds a table, add it here too; the script warns when the API
 * exposes a public table this list does not mention.
 */
const TABLES = [
  "events",
  "ticket_types",
  "ticket_numbers",
  "staff",
  "orders",
  "order_items",
  "tickets",
  "walkin_sales",
  "audit_log",
  "app_settings",
];

/** Sequences that must be fast-forwarded after a data restore. */
const SEQUENCES = [{ name: "public.audit_log_id_seq", table: "audit_log", column: "id" }];

/**
 * A backup that silently captured nothing is worse than no backup, so the run
 * fails when a table that must never be empty comes back with zero rows.
 * Tune this list as the event data changes.
 */
const MUST_NOT_BE_EMPTY = ["events", "ticket_types", "ticket_numbers", "staff"];

const PAGE = 1000;

/* ----------------------------------------------------------------- config */

function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function parseArgs(argv) {
  const args = { dryRun: false, out: null, keep: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--keep") args.keep = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log("Usage: node scripts/backup.mjs [--dry-run] [--out <dir>] [--keep <n>]");
  process.exit(0);
}

const fileEnv = parseEnvFile(path.join(ROOT, ".env.local"));
const env = { ...fileEnv, ...process.env };

const SUPABASE_URL = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local or environment).");
  process.exit(1);
}

// Default outside the repo AND outside OneDrive: OneDrive dehydrates large
// folders and would fight the nightly run for file locks.
const BASE_DIR =
  args.out || env.DRIFT_BACKUP_DIR || path.join(process.env.LOCALAPPDATA || homedir(), "drift-backups");
const KEEP = Number.isFinite(args.keep) ? args.keep : Number(env.DRIFT_BACKUP_KEEP || 14);

const auth = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/* ------------------------------------------------------------------ utils */

/** Manila-time folder name, e.g. 2026-09-21_2143. */
function stamp(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(d)
    .reduce((acc, x) => ((acc[x.type] = x.value), acc), {});
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

async function api(url, init = {}, attempt = 1) {
  try {
    const res = await fetch(url, { ...init, headers: { ...auth, ...(init.headers || {}) } });
    if (!res.ok) {
      // 5xx and 429 are worth another try; 4xx means we asked for the wrong thing.
      if ((res.status >= 500 || res.status === 429) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        return api(url, init, attempt + 1);
      }
      throw new Error(`${init.method || "GET"} ${url.replace(SUPABASE_URL, "")} -> ${res.status} ${await res.text()}`);
    }
    return res;
  } catch (err) {
    if (attempt < 4 && err instanceof TypeError) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      return api(url, init, attempt + 1);
    }
    throw err;
  }
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const human = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* ------------------------------------------------------------- SQL output */

/** Render one JS value as a Postgres literal. Objects/arrays become jsonb. */
export function sqlLiteral(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "object") return `${quote(JSON.stringify(v))}::jsonb`;
  return quote(String(v));
}

/** Single-quoted Postgres string; doubles embedded quotes, E-escapes backslashes. */
function quote(s) {
  const escaped = s.replace(/'/g, "''");
  return escaped.includes("\\") ? `E'${escaped.replace(/\\/g, "\\\\")}'` : `'${escaped}'`;
}

export function insertStatements(table, rows) {
  if (!rows.length) return `-- ${table}: no rows\n`;
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const lines = [`-- ${table}: ${rows.length} row(s)`];
  // Chunked multi-row INSERTs: one statement per row is slow to replay, one
  // giant statement is hard to recover from when a single row is bad.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map((r) => `  (${cols.map((c) => sqlLiteral(r[c])).join(", ")})`).join(",\n");
    lines.push(`insert into public."${table}" (${colList}) values\n${values}\non conflict do nothing;`);
  }
  return lines.join("\n") + "\n";
}

/* ----------------------------------------------------------------- pulls */

async function listPublicTables() {
  const res = await api(`${SUPABASE_URL}/rest/v1/`, { headers: { Accept: "application/json" } });
  const spec = await res.json();
  return Object.keys(spec.definitions || spec.components?.schemas || {});
}

async function fetchTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await api(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { Range: `${from}-${from + PAGE - 1}`, Prefer: "count=exact" },
    });
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function fetchAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const res = await api(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`);
    const body = await res.json();
    const batch = body.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function listBucketObjects(bucket, prefix = "") {
  const found = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await api(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const items = await res.json();
    for (const item of items) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      // A folder placeholder has no id/metadata; recurse into it.
      if (item.id === null || item.metadata === null) found.push(...(await listBucketObjects(bucket, full)));
      else found.push({ path: full, size: Number(item.metadata?.size ?? 0), mimetype: item.metadata?.mimetype ?? null });
    }
    if (items.length < PAGE) break;
  }
  return found;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const startedAt = new Date();
  const dir = path.join(BASE_DIR, stamp(startedAt));
  const label = args.dryRun ? "DRY RUN" : dir;
  console.log(`Drift Tickets backup -> ${label}`);
  console.log(`Project: ${SUPABASE_URL}`);

  if (!args.dryRun) await mkdir(path.join(dir, "tables"), { recursive: true });

  const manifest = {
    project_url: SUPABASE_URL,
    started_at: startedAt.toISOString(),
    tables: {},
    auth_users: 0,
    storage: {},
    files: {},
    warnings: [],
  };

  // Warn about tables the API exposes but this script does not know about, so a
  // new migration cannot quietly drop out of the backup.
  try {
    const exposed = await listPublicTables();
    const unknown = exposed.filter((t) => !TABLES.includes(t) && !t.startsWith("v_"));
    if (unknown.length) manifest.warnings.push(`Not backed up (add to TABLES in scripts/backup.mjs): ${unknown.join(", ")}`);
  } catch (err) {
    manifest.warnings.push(`Could not read the API schema: ${err.message}`);
  }

  // ---- tables
  let sql = [
    "-- Drift Tickets data restore.",
    `-- Source: ${SUPABASE_URL}`,
    `-- Taken:  ${startedAt.toISOString()}`,
    "-- Run the migrations on the target project FIRST, then replay this file.",
    "begin;",
    "set session_replication_role = replica;  -- defer FK checks during the load",
    "",
  ].join("\n");

  for (const table of TABLES) {
    const rows = await fetchTable(table);
    manifest.tables[table] = rows.length;
    if (MUST_NOT_BE_EMPTY.includes(table) && rows.length === 0) {
      throw new Error(`Table "${table}" came back empty. Refusing to write a backup that looks broken.`);
    }
    if (!args.dryRun) {
      await writeFile(path.join(dir, "tables", `${table}.json`), JSON.stringify(rows, null, 2));
    }
    sql += insertStatements(table, rows) + "\n";
    console.log(`  table ${table.padEnd(16)} ${String(rows.length).padStart(6)} rows`);
  }

  sql += SEQUENCES.map(
    (s) => `select setval('${s.name}', (select coalesce(max("${s.column}"), 1) from public."${s.table}"));`
  ).join("\n");
  sql += "\nset session_replication_role = origin;\ncommit;\n";

  // ---- auth users (metadata only: the API never returns password hashes)
  const users = await fetchAuthUsers();
  manifest.auth_users = users.length;
  console.log(`  auth users${" ".repeat(11)}${String(users.length).padStart(6)} (no password hashes, see RESTORE.md)`);
  if (!args.dryRun) await writeFile(path.join(dir, "auth-users.json"), JSON.stringify(users, null, 2));

  // ---- storage
  const buckets = await (await api(`${SUPABASE_URL}/storage/v1/bucket`)).json();
  let storageBytes = 0;
  for (const bucket of buckets) {
    const objects = await listBucketObjects(bucket.id);
    manifest.storage[bucket.id] = { public: bucket.public, objects: objects.length };
    for (const obj of objects) {
      storageBytes += obj.size;
      if (args.dryRun) continue;
      const res = await api(`${SUPABASE_URL}/storage/v1/object/${bucket.id}/${encodeURI(obj.path)}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const dest = path.join(dir, "storage", bucket.id, obj.path);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, buf);
      manifest.files[`storage/${bucket.id}/${obj.path}`] = { bytes: buf.length, sha256: sha256(buf) };
    }
    console.log(`  bucket ${bucket.id.padEnd(15)} ${String(objects.length).padStart(6)} file(s)`);
  }

  if (args.dryRun) {
    console.log(`\nDry run only. Would have written ${human(storageBytes)} of storage files.`);
    return;
  }

  // ---- write data.sql, manifest, restore notes
  await writeFile(path.join(dir, "data.sql"), sql);
  manifest.files["data.sql"] = { bytes: Buffer.byteLength(sql), sha256: sha256(Buffer.from(sql)) };
  manifest.finished_at = new Date().toISOString();
  manifest.storage_bytes = storageBytes;
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(dir, "RESTORE.md"), restoreDoc(manifest));

  // ---- prune old backups
  const kept = [];
  if (KEEP > 0) {
    const entries = (await readdir(BASE_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const old of entries.slice(0, Math.max(0, entries.length - KEEP))) {
      await rm(path.join(BASE_DIR, old), { recursive: true, force: true });
      kept.push(old);
    }
  }

  const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`\nDone. ${rows} rows, ${users.length} auth users, ${human(storageBytes)} of files.`);
  console.log(`Folder: ${dir}`);
  if (kept.length) console.log(`Pruned ${kept.length} backup(s) older than the last ${KEEP}.`);
  for (const w of manifest.warnings) console.warn(`WARNING: ${w}`);
}

function restoreDoc(m) {
  return `# Restoring this backup

Taken ${m.started_at} from ${m.project_url}.

Contents: \`data.sql\` (all public tables as INSERTs), \`tables/*.json\` (same data,
easier to read), \`auth-users.json\` (staff accounts, metadata only),
\`storage/<bucket>/...\` (every Storage object), \`manifest.json\` (counts + SHA-256).

## Into a fresh Supabase project

1. Create the project, then apply the schema from the repo:
   \`npx supabase link --project-ref <new-ref>\` then \`npx supabase db push\`.
   The migrations in \`supabase/migrations/\` are the source of truth for the schema;
   this backup holds data only.
2. Load the data, using the Session pooler connection string from the dashboard
   (Connect button):
   \`psql "<connection-string>" -f data.sql\`
   It runs in one transaction with FK checks deferred, so it either loads fully
   or not at all.
3. Re-upload the files. From this folder:
   \`npx supabase storage cp -r storage/payment-proofs ss://payment-proofs --experimental\`
   Repeat per bucket. The buckets themselves are created by the migrations.
4. Point the app at the new project: update \`NEXT_PUBLIC_SUPABASE_URL\`,
   \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` and \`SUPABASE_SERVICE_ROLE_KEY\` in \`.env.local\`
   and in the Vercel project, then redeploy.

## Staff logins are NOT in this backup

The Auth admin API does not return password hashes, so \`auth-users.json\` lists the
${m.auth_users} accounts (id, email, created_at) but cannot recreate their passwords.
After a restore, recreate each account in Supabase Auth with the SAME user id as in
\`auth-users.json\` (the \`staff\` table and every \`audit_log\` row reference those ids),
then have each person set a new password.

## What stays valid after a restore

Ticket QR codes encode \`<site>/t/<qr_token>\`, and \`qr_token\` is restored with the
\`tickets\` rows, so every ticket already emailed to a customer keeps working as long
as the site URL does not change.
`;
}

// Only back up when run directly; importing this file (e.g. to unit-test the
// SQL escaping) must not fire off a backup.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nBackup FAILED: ${err.message}`);
    process.exit(1);
  });
}
