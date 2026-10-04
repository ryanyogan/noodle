import { env } from "cloudflare:workers";
import { z } from "zod";

// SQL run through the Worker's own D1 binding, for E2E: specs used to seed (and read) the local
// database with `wrangler d1 execute --local`, a second process opening the same SQLite file. That
// took seconds a call and, with several tests at once, made D1 answer SQLITE_BUSY. Only with
// AI_MODEL=stub (server.ts), so not in production builds.

export const DEV_SQL_PATH = "/api/dev/sql";

const devSqlSchema = z.object({ statements: z.array(z.string().trim().min(1)).min(1).max(2000) });

/** POST {statements}: runs them in one batch (all or nothing) and answers each one's rows. */
export async function handleDevSql(request: Request): Promise<Response> {
	if (request.method !== "POST") return new Response("POST only", { status: 405 });
	const parsed = devSqlSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json(parsed.error.issues, { status: 400 });
	try {
		const results = await env.DB.batch(
			parsed.data.statements.map((sql) => env.DB.prepare(sql.replace(/;\s*$/, ""))),
		);
		return Response.json({ results: results.map((result) => result.results) });
	} catch (error) {
		return new Response(error instanceof Error ? error.message : String(error), { status: 500 });
	}
}
