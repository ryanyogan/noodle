import { env } from "cloudflare:workers";
import { type ImportRecord, importStatement, loadCsvMapping, loadImports } from "@noodle/db";
import { type CsvMapping, readStatement } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Statement uploads: a Parent brings a CSV or OFX statement into a hand-entered Account. The file
// is kept in R2 and read here again (the preview the Parent saw was read in the browser), then its
// lines are imported in one atomic batch. Statements are small (a month is a few hundred lines),
// so this runs in the request rather than through a Queue or Workflow; a Bank Connection's
// Imports can reuse importStatement from one later. Idempotent per `importId`, and re-uploading a
// statement adds nothing twice.

export type { ImportRecord };

/** A statement file's text; a year of OFX is a few hundred kilobytes. */
export const MAX_STATEMENT_CHARS = 4_000_000;

export type AccountImportsData = { imports: ImportRecord[]; csvMapping: CsvMapping | null };

const column = z.number().int().min(0).max(199);

const csvMappingSchema: z.ZodType<CsvMapping> = z.object({
	hasHeader: z.boolean(),
	dateColumn: column,
	descriptionColumn: column,
	dateFormat: z.enum(["mdy", "dmy", "ymd"]),
	amount: z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("signed"),
			column,
			moneyOut: z.enum(["negative", "positive"]),
		}),
		z.object({ kind: z.literal("debit-credit"), debitColumn: column, creditColumn: column }),
	]),
});

/** An Account's Imports, newest first, and the CSV mapping it remembers. */
export const getAccountImports = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ accountId: ulidSchema }))
	.handler(async ({ data, context }): Promise<AccountImportsData> => {
		const db = getDb();
		const [imports, csvMapping] = await Promise.all([
			loadImports(db, context.household.id, data.accountId),
			loadCsvMapping(db, context.household.id, data.accountId),
		]);
		return { imports, csvMapping };
	});

export type UploadStatementResult =
	| { ok: true; import: ImportRecord }
	| { ok: false; reason: "no-account" | "nothing-to-import" };

/** Imports a statement file into an Account; a CSV needs its column mapping. */
export const uploadStatement = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			importId: ulidSchema,
			accountId: ulidSchema,
			fileName: z.string().trim().max(200),
			content: z.string().min(1).max(MAX_STATEMENT_CHARS),
			csvMapping: csvMappingSchema.nullable(),
		}),
	)
	.handler(async ({ data, context }): Promise<UploadStatementResult> => {
		const { household } = context;
		const { format, statement } = readStatement(data.content, data.csvMapping);
		if (statement.lines.length === 0) return { ok: false, reason: "nothing-to-import" };
		// Kept per Household and Account; a retry writes the same object again.
		const fileKey = `${household.id}/${data.accountId}/${data.importId}.${format}`;
		await env.STATEMENTS.put(fileKey, data.content, {
			httpMetadata: { contentType: format === "ofx" ? "application/x-ofx" : "text/csv" },
			customMetadata: { fileName: data.fileName },
		});
		const result = await importStatement(getDb(), {
			householdId: household.id,
			importId: data.importId,
			accountId: data.accountId,
			source: format,
			fileName: data.fileName || null,
			fileKey,
			lines: statement.lines,
			closingBalance: statement.closingBalance,
			csvMapping: format === "csv" ? data.csvMapping : null,
			createdByMemberId: context.parent.id,
			newId: ulid,
		});
		if (!result.ok) {
			await env.STATEMENTS.delete(fileKey);
			return result;
		}
		const changes: HouseholdChange[] = [
			"imports",
			...result.months.map((month) => `month:${month}` as HouseholdChange),
		];
		await notifyHousehold(household.id, changes);
		return { ok: true, import: result.import };
	});
