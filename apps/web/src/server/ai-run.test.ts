import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	type Db,
	importStatement,
	saveRule,
	setTakeHomePay,
	updateBucket,
} from "@noodle/db";
import { categorizations, members, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import type { HouseholdChange } from "../household-changes";
import { type AiBatch, foldEvent } from "./ai-coalescer";
import { runAiBatch } from "./ai-run";
import { type BucketChoice, type Classifier, memoryMerchants } from "./categorize-model";
import { stubNamer } from "./merchant-model";

const householdId = "household";
const month = "2026-09";
let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;

/** A fake model that files a merchant into the offered Bucket named in it, and records what it saw. */
function namingModel() {
	const offered: BucketChoice[][] = [];
	const classifier: Classifier = {
		async classify(buckets, merchants) {
			offered.push(buckets);
			return merchants.map((merchant) => {
				const bucket = buckets.find((b) => merchant.key.includes(b.name.toLowerCase()));
				return bucket
					? { key: merchant.key, bucketId: bucket.id, confidence: 0.97 }
					: { key: merchant.key, bucketId: null, confidence: 0 };
			});
		},
	};
	return { classifier, offered };
}

let notified: HouseholdChange[][];
const deps = (classifier: Classifier) => ({
	db,
	classifier,
	merchants: memoryMerchants(),
	namer: stubNamer,
	parents: async () => ["alex", "sam"],
	notify: async (changes: HouseholdChange[]) => void notified.push(changes),
});

const line = (description: string, dollars: number): StatementLine => ({
	date: "2026-09-10" as StatementLine["date"],
	amount: -Math.round(dollars * 100),
	description,
	bankId: null,
});

async function importLines(by: string, lines: StatementLine[]) {
	const importId = newId();
	const result = await importStatement(db, {
		householdId,
		importId,
		accountId: "card",
		source: "csv",
		fileName: "statement.csv",
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: by,
		newId,
	});
	expect(result.ok).toBe(true);
	return importId;
}

const batchOf = (...events: Parameters<typeof foldEvent>[1][]): AiBatch =>
	events.reduce(foldEvent, {
		householdId,
		imports: [],
		captures: [],
		lookAgain: false,
		events: {},
		attempt: 0,
	});

/** Each imported Transaction's Bucket and categorization outcome, by note. */
async function outcomes() {
	const [rows, decided] = await Promise.all([
		db.select().from(transactions),
		db.select().from(categorizations),
	]);
	return Object.fromEntries(
		rows.map((row) => [
			row.note,
			{
				bucketId: row.bucketId,
				outcome: decided.find((c) => c.transactionId === row.id)?.outcome ?? null,
			},
		]),
	);
}

beforeEach(async () => {
	db = testDb();
	ids = 0;
	notified = [];
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db
		.insert(members)
		.values({ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" });
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, name] of [
		["groceries", "Groceries"],
		["fun", "Fun"],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId,
			name,
			color: 1,
			month,
			allowanceCents: 50_000,
		});
	}
	for (const memberId of ["alex", "sam"]) {
		await addPersonalAllowance(db, {
			householdId,
			memberId,
			bucketId: `${memberId}-pa`,
			name: memberId === "alex" ? "Stash" : "Sephora",
			color: 2,
			month,
			allowanceCents: 20_000,
		});
	}
	await addAccount(db, {
		householdId,
		accountId: "card",
		name: "Visa",
		kind: "credit-card",
		balanceCents: 0,
		balanceId: "balance-card",
		createdByMemberId: "alex",
	});
});

describe("a background AI run", () => {
	it("files new Imports, then tells the Household", async () => {
		const model = namingModel();
		const importId = await importLines("alex", [line("FUN ZONE ARCADE", 30), line("ZZ MART", 12)]);

		const result = await runAiBatch(
			deps(model.classifier),
			batchOf({ householdId, memberId: "alex", kind: "imported", ids: [importId] }),
		);

		expect(result).toMatchObject({ filed: 1, review: 1 });
		expect(await outcomes()).toMatchObject({
			"FUN ZONE ARCADE": { bucketId: "fun", outcome: "filed" },
			"ZZ MART": { bucketId: null, outcome: "review" },
		});
		expect(notified).toEqual([["months", "for-earlier", "bucket-uses"]]);
	});

	it("looks again at Review after a Bucket is renamed", async () => {
		const model = namingModel();
		const importId = await importLines("alex", [line("BLUE BOTTLE COFFEE", 6)]);
		const run = (batch: AiBatch) => runAiBatch(deps(model.classifier), batch);
		await run(batchOf({ householdId, memberId: "alex", kind: "imported", ids: [importId] }));
		expect((await outcomes())["BLUE BOTTLE COFFEE"]).toMatchObject({ outcome: "review" });

		await updateBucket(db, {
			householdId,
			memberId: "alex",
			month,
			bucketId: "fun",
			name: "Coffee",
		});
		await run(batchOf({ householdId, memberId: "alex", kind: "buckets-changed" }));

		expect((await outcomes())["BLUE BOTTLE COFFEE"]).toEqual({ bucketId: "fun", outcome: "filed" });
	});

	it("looks again at Review after a Rule is added", async () => {
		const model = namingModel();
		const importId = await importLines("sam", [line("ZZ MART #12", 12)]);
		const run = (batch: AiBatch) => runAiBatch(deps(model.classifier), batch);
		await run(batchOf({ householdId, memberId: "sam", kind: "imported", ids: [importId] }));
		expect((await outcomes())["ZZ MART #12"]).toMatchObject({ outcome: "review" });

		await saveRule(db, {
			id: "rule-zz",
			householdId,
			memberId: "alex",
			pattern: "ZZ Mart",
			bucketId: "groceries",
		});
		await run(batchOf({ householdId, memberId: "alex", kind: "rule-added" }));

		// Sam's Review row, looked at again in Sam's view, with the Household Rule.
		expect((await outcomes())["ZZ MART #12"]).toEqual({ bucketId: "groceries", outcome: "filed" });
	});

	it("does nothing, and tells no one, when nothing's new", async () => {
		const result = await runAiBatch(
			deps(namingModel().classifier),
			batchOf({ householdId, memberId: "alex", kind: "commitment-changed", ids: ["c"] }),
		);
		expect(result).toMatchObject({ filed: 0, review: 0 });
		expect(notified).toEqual([]);
	});
});

describe("a background AI run keeps each Parent's Personal Allowance private", () => {
	it("files and looks again for each Parent in their own view only", async () => {
		const model = namingModel();
		// Sam's private Rule into their own Personal Allowance.
		await saveRule(db, {
			id: "rule-sephora",
			householdId,
			memberId: "sam",
			pattern: "Sephora",
			bucketId: "sam-pa",
		});
		const samsImport = await importLines("sam", [line("SEPHORA 0042", 58), line("QQ SHOP", 9)]);
		const alexsImport = await importLines("alex", [
			line("SEPHORA ONLINE", 40),
			line("STASH CO", 8),
		]);

		await runAiBatch(
			deps(model.classifier),
			batchOf(
				{ householdId, memberId: "sam", kind: "imported", ids: [samsImport] },
				{ householdId, memberId: "alex", kind: "imported", ids: [alexsImport] },
				{ householdId, memberId: "alex", kind: "buckets-changed" },
			),
		);

		const all = await outcomes();
		expect(all["SEPHORA 0042"]).toMatchObject({ bucketId: "sam-pa", outcome: "filed" });
		expect(all["STASH CO"]).toMatchObject({ bucketId: "alex-pa", outcome: "filed" });
		// Neither Sam's Rule nor the model files Alex's line into Sam's Personal Allowance.
		expect(all["SEPHORA ONLINE"]?.bucketId).not.toBe("sam-pa");
		// No prompt ever offered both Parents' Personal Allowances.
		for (const buckets of model.offered) {
			const allowances = buckets.filter((b) => b.id.endsWith("-pa"));
			expect(allowances.length).toBeLessThanOrEqual(1);
		}
		expect(model.offered.some((b) => b.some((x) => x.id === "sam-pa"))).toBe(true);
		expect(model.offered.some((b) => b.some((x) => x.id === "alex-pa"))).toBe(true);
	});
});

describe("a background AI run names merchants first", () => {
	const merchantOf = async (note: string) =>
		(await db.select().from(transactions)).filter((t) => t.note === note).map((t) => t.merchant);
	const imported = (id: string) =>
		batchOf({ householdId, kind: "imported", memberId: "alex", ids: [id] });

	it("names what the normaliser settles without asking the model", async () => {
		const asked: string[][] = [];
		const namer = {
			name: async (raws: string[]) => {
				asked.push(raws);
				return new Map<string, string>();
			},
		};
		const id = await importLines("alex", [line("COSTCO WHSE #1042 SEATTLE WA", 120)]);
		await runAiBatch({ ...deps(namingModel().classifier), namer }, imported(id));
		expect(await merchantOf("COSTCO WHSE #1042 SEATTLE WA")).toEqual(["Costco"]);
		expect(asked).toEqual([]);
	});

	it("asks the model for leftovers once, in one prompt, and keeps its names for the Household", async () => {
		const asked: string[][] = [];
		const namer = {
			name: async (raws: string[]) => {
				asked.push(raws);
				return new Map(raws.map((raw) => [raw, "Patreon"]));
			},
		};
		const first = await importLines("alex", [
			line("CKO*PATREON* MEMBERSHIP", 5),
			line("MRKTPLC SVCS 88123", 9),
		]);
		await runAiBatch({ ...deps(namingModel().classifier), namer }, imported(first));
		expect(asked).toHaveLength(1);
		expect(asked[0]).toHaveLength(2);
		expect(await merchantOf("CKO*PATREON* MEMBERSHIP")).toEqual(["Patreon"]);

		const fresh = {
			...line("CKO*PATREON* MEMBERSHIP", 5),
			date: "2026-09-20" as StatementLine["date"],
		};
		const second = await importLines("alex", [fresh]);
		await runAiBatch({ ...deps(namingModel().classifier), namer }, imported(second));
		expect(asked).toHaveLength(1);
		expect(await merchantOf("CKO*PATREON* MEMBERSHIP")).toEqual(["Patreon", "Patreon"]);
	});

	it("keeps the normaliser's guess when the model fails, and leaves Quick Adds' notes alone", async () => {
		const namer = {
			name: async (): Promise<Map<string, string>> => {
				throw new Error("down");
			},
		};
		const id = await importLines("alex", [line("CKO*PATREON* MEMBERSHIP", 5)]);
		await runAiBatch({ ...deps(namingModel().classifier), namer }, imported(id));
		const [named] = await merchantOf("CKO*PATREON* MEMBERSHIP");
		expect(named).toBeTruthy();
		expect(
			(await db.select().from(transactions)).filter((t) => t.source === "quick-add" && t.merchant),
		).toEqual([]);
	});
});
