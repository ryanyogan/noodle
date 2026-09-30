// Loads a seed scenario into the LOCAL D1 the dev server uses (#46): `bun run seed <fresh|starter|busy>`.
// See docs/seed-data.md for what each scenario holds.
//
// It can't touch remote or production D1: it never calls Cloudflare's API or `wrangler d1
// execute`. It opens the local database's own SQLite file under .wrangler/state (Miniflare's
// storage for `vite dev`) and writes to that file, so there is no remote code path to misuse.
// It refuses any extra argument (`--remote`, `--env …`) and a production Clerk key.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createClerkClient } from "@clerk/backend";
import {
	buildSeed,
	SEED_SCENARIOS,
	type SeedParent,
	type SeedScenario,
	wipeAll,
	writeSeed,
} from "@noodle/db/seed";
import { sqliteDb } from "@noodle/db/test-db";
import { dayKeyAt } from "@noodle/domain";
import { config } from "dotenv";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(web, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const TIME_ZONE = "America/Chicago";
/** The seed Parents' password: dev-instance test users only (their emails can't receive mail). */
const PASSWORD = "noodle-seed-parent";
const PARENTS = [
	{ name: "Alex", email: "seed-alex+clerk_test@example.com" },
	{ name: "Jordan", email: "seed-jordan+clerk_test@example.com" },
] as const;

function fail(message: string): never {
	console.error(`seed: ${message}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const scenario = args[0] as SeedScenario;
if (args.length !== 1 || !SEED_SCENARIOS.includes(scenario)) {
	fail(
		`usage: bun run seed <${SEED_SCENARIOS.join("|")}>. It only ever writes the local D1; ` +
			"there is no --remote.",
	);
}

/** The local D1's SQLite file: the one under .wrangler/state holding the migrations table. */
function localDatabase(): string {
	const files = readdirSync(STATE)
		.filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
		.map((name) => join(STATE, name))
		.filter((file) => {
			const db = new DatabaseSync(file, { readOnly: true });
			try {
				return !!db.prepare("select 1 from sqlite_master where name = 'd1_migrations'").get();
			} finally {
				db.close();
			}
		});
	if (files.length !== 1)
		fail(`expected one local D1 database in ${relative(web, STATE)}, found ${files.length}`);
	const file = files[0] as string;
	// Belt and braces: whatever happens above, only a file under .wrangler/state is ever opened.
	if (!resolve(file).startsWith(`${join(web, ".wrangler", "state")}/`))
		fail("refusing to write outside the local .wrangler/state");
	return file;
}

async function clerkParents(): Promise<[SeedParent, SeedParent]> {
	config({ path: join(web, ".dev.vars"), quiet: true });
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) fail("CLERK_SECRET_KEY is missing from apps/web/.dev.vars");
	// Only a development instance: its keys start sk_test_. Never a production one.
	if (!secretKey.startsWith("sk_test_"))
		fail("CLERK_SECRET_KEY is not a Clerk development key; the seed only runs on dev");
	const clerk = createClerkClient({ secretKey });
	const found = await Promise.all(
		PARENTS.map(async ({ name, email }) => {
			const { data } = await clerk.users.getUserList({ emailAddress: [email] });
			const existing = data[0];
			// Reset the password too, so the documented one always works.
			const user = existing
				? await clerk.users.updateUser(existing.id, {
						password: PASSWORD,
						skipPasswordChecks: true,
					})
				: await clerk.users.createUser({
						emailAddress: [email],
						password: PASSWORD,
						firstName: name,
						skipPasswordChecks: true,
					});
			return { clerkUserId: user.id, name, email };
		}),
	);
	return found as [SeedParent, SeedParent];
}

const started = Date.now();
console.log(`seed: applying migrations to the local D1…`);
execFileSync("bunx", ["wrangler", "d1", "migrations", "apply", "noodle", "--local"], {
	cwd: web,
	stdio: "ignore",
	env: { ...process.env, CI: "true" },
});
const file = localDatabase();
const parents = await clerkParents();
const now = Date.now();
const rows = buildSeed(scenario, {
	today: dayKeyAt(new Date(now), TIME_ZONE),
	now,
	timeZone: TIME_ZONE,
	parents,
});

const sqlite = new DatabaseSync(file);
sqlite.exec("pragma foreign_keys = on; pragma busy_timeout = 10000;");
const db = sqliteDb(sqlite);
sqlite.exec("begin immediate");
try {
	await wipeAll(db);
	await writeSeed(db, rows);
	const orphans = sqlite.prepare("pragma foreign_key_check").all();
	if (orphans.length) throw new Error(`orphan rows: ${JSON.stringify(orphans.slice(0, 3))}`);
	sqlite.exec("commit");
} catch (error) {
	sqlite.exec("rollback");
	throw error;
} finally {
	sqlite.close();
}

const count = (list: unknown[]) => list.length.toLocaleString("en-US");
const signIn = scenario === "busy" ? parents : [parents[0]];
console.log(`
seed: loaded "${scenario}" into the local D1 in ${((Date.now() - started) / 1000).toFixed(1)} s
  ${count(rows.transactions)} Transactions, ${count(rows.accounts)} Accounts, ${count(rows.buckets)} Buckets, ${count(rows.commitments)} Commitments, ${count(rows.goals)} Goals

Sign in at http://localhost:5173/sign-in (bun run dev) as:
${signIn.map((p) => `  ${p.name}: ${p.email}`).join("\n")}
with the password in docs/seed-data.md; if Clerk asks for a code, it's 424242.`);
