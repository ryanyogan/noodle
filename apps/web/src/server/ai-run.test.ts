import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	countSameMerchant,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadMerchantNames,
	loadParentNames,
	nameSameMerchant,
	PARENT_NAME,
	returnToReview,
	saveMerchantNames,
	saveRule,
	setTakeHomePay,
	updateBucket,
	updateTransaction,
} from "@noodle/db";
import { categorizations, members, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { bankMerchantKey, cleanMerchant, type StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import type { HouseholdChange } from "../household-changes";
import { ModelBudget } from "./ai-budget";
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

	it("leaves a card a Parent put back with Undo in Review, whatever it has learned since (issue 105)", async () => {
		const model = namingModel();
		const importId = await importLines("alex", [line("ZZ MART #12", 12), line("ZZ MART #40", 30)]);
		const run = (batch: AiBatch) => runAiBatch(deps(model.classifier), batch);
		await run(batchOf({ householdId, memberId: "alex", kind: "imported", ids: [importId] }));
		const rows = await db.select().from(transactions);
		const putBack = rows.find((row) => row.note === "ZZ MART #12");

		// Alex's Undo of a filing, then a Rule for the same merchant.
		await returnToReview(
			db,
			{ householdId, memberId: "alex" },
			{
				transactionId: putBack?.id as string,
				merchant: "zz mart",
				guess: null,
				forMemberIds: [],
			},
		);
		await saveRule(db, {
			id: "rule-zz",
			householdId,
			memberId: "alex",
			pattern: "ZZ Mart",
			bucketId: "groceries",
		});
		await run(batchOf({ householdId, memberId: "alex", kind: "rule-added" }));

		const after = await outcomes();
		expect(after["ZZ MART #12"]).toEqual({ bucketId: null, outcome: "review" });
		expect(after["ZZ MART #40"]).toEqual({ bucketId: "groceries", outcome: "filed" });
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

describe("a background AI run keeps to the day's model budget", () => {
	const storage = () => {
		const data = new Map<string, unknown>();
		return {
			get: async <T>(key: string) => data.get(key) as T | undefined,
			put: async <T>(key: string, value: T) => void data.set(key, value),
		};
	};
	const limits = { modelCallsPerDay: 0, insightRefreshesPerDay: 3, insightRefreshGapMs: 0 };

	it("sends what the model would file to Review, quietly, once the budget is spent", async () => {
		const model = namingModel();
		const importId = await importLines("alex", [line("FUN ZONE ARCADE", 30)]);
		const budget = await ModelBudget.open(storage(), limits);

		const result = await runAiBatch(
			{ ...deps(model.classifier), budget },
			batchOf({ householdId, memberId: "alex", kind: "imported", ids: [importId] }),
		);

		expect(result).toMatchObject({ filed: 0, review: 1 });
		expect(model.offered).toHaveLength(0);
		expect(budget.steps.file.skipped).toBe(1);
	});

	it("refreshes Insights when it filed something, debounced, and says so", async () => {
		const store = storage();
		let refreshed = 0;
		const refreshInsights = async () => {
			refreshed += 1;
			return 1;
		};
		const gap = { ...limits, modelCallsPerDay: 10, insightRefreshGapMs: 60 * 60 * 1000 };
		const importId = await importLines("alex", [line("FUN ZONE ARCADE", 30)]);
		const budget = await ModelBudget.open(store, gap);
		await runAiBatch(
			{ ...deps(namingModel().classifier), budget, refreshInsights },
			batchOf({ householdId, memberId: "alex", kind: "imported", ids: [importId] }),
		);
		await budget.save();
		expect(refreshed).toBe(1);
		expect(notified).toContainEqual(["insights", "perks"]);

		// A second burst within the hour: marked stale, refreshed later.
		const second = await importLines("alex", [line("FUN ZONE BOWLING", 20)]);
		const again = await ModelBudget.open(store, gap);
		await runAiBatch(
			{ ...deps(namingModel().classifier), budget: again, refreshInsights },
			batchOf({ householdId, memberId: "alex", kind: "imported", ids: [second] }),
		);
		expect(refreshed).toBe(1);
		expect(again.shouldRefreshInsights()).toBe(false);
	});
});

describe("a name a Parent gave (#95)", () => {
	const amex = (ref: string) => `AMERICAN EXPRESS ACH PMT ${ref} WEB ID: 2005032111`;
	const imported = (id: string) =>
		batchOf({ householdId, kind: "imported", memberId: "alex", ids: [id] });
	const fromBank = async () =>
		(await db.select().from(transactions))
			.filter((t) => t.source === "import")
			.sort((a, b) => (a.note ?? "").localeCompare(b.note ?? ""));
	const run = (id: string, namer = stubNamer) =>
		runAiBatch({ ...deps(namingModel().classifier), namer }, imported(id));
	const rename = (
		row: { id: string; amountCents: number; note: string | null },
		name: string,
		expectedVersion: number,
	) =>
		updateTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: row.id,
			amountCents: row.amountCents,
			assignment: { bucketId: "groceries" },
			note: row.note,
			forMemberIds: [],
			expectedVersion,
			name,
		});

	it("renames one on the version it was made on, and keeps the bank's wording", async () => {
		await run(await importLines("alex", [line(amex("M8054"), 250), line(amex("M9120"), 80)]));
		const [one, other] = await fromBank();
		expect([one?.merchant, other?.merchant]).toEqual([
			"American Express payment",
			"American Express payment",
		]);
		if (!one || !other) throw new Error("not imported");

		expect(await rename(one, "Amex card", one.version)).toEqual({
			ok: true,
			version: one.version + 1,
		});
		// The same change again lands the same (a retry), and one made on the old version is refused.
		expect(await rename(one, "Amex card", one.version)).toEqual({
			ok: true,
			version: one.version + 1,
		});
		expect(await rename(one, "Something else", one.version)).toEqual({
			ok: false,
			reason: "changed-elsewhere",
		});
		const [renamed, untouched] = await fromBank();
		expect(renamed).toMatchObject({ merchant: "Amex card", note: amex("M8054") });
		expect(untouched).toMatchObject({
			merchant: "American Express payment",
			version: other.version,
		});
	});

	it("is given to the merchant's others, remembered for later Imports, and never AI's to change", async () => {
		await run(await importLines("alex", [line(amex("M8054"), 250), line(amex("M9120"), 80)]));
		await run(await importLines("alex", [line("COSTCO WHSE #1042 SEATTLE WA", 120)]));
		const [one] = await fromBank();
		if (!one) throw new Error("not imported");
		await rename(one, "Amex card", one.version);
		const same = { householdId, memberId: "alex", transactionId: one.id, name: "Amex card" };
		expect(await countSameMerchant(db, same)).toBe(1);
		expect(await nameSameMerchant(db, same)).toBe(1);
		expect(await countSameMerchant(db, same)).toBe(0);
		expect((await fromBank()).map((t) => t.merchant)).toEqual(["Amex card", "Amex card", "Costco"]);

		// A later line from the merchant takes the Parent's name without the model being asked.
		const asked: string[][] = [];
		const namer = {
			name: async (raws: string[]) => {
				asked.push(raws);
				return new Map(raws.map((raw) => [raw, "American Express"]));
			},
		};
		await run(await importLines("alex", [line(amex("M7777"), 40)]), namer);
		expect(asked).toEqual([]);
		expect((await fromBank()).map((t) => t.merchant)).toEqual([
			"Amex card",
			"Amex card",
			"Amex card",
			"Costco",
		]);

		// Background AI's names can't be kept over a Parent's.
		const key = bankMerchantKey(amex("M8054"));
		await saveMerchantNames(db, householdId, [
			{ raw: PARENT_NAME + key, name: "American Express" },
		]);
		expect((await loadParentNames(db, householdId)).get(key)).toBe("Amex card");
		// The Parent's next name for it replaces their last.
		await nameSameMerchant(db, { ...same, name: "Amex" });
		expect((await loadParentNames(db, householdId)).get(key)).toBe("Amex");
	});

	it("leaves the merchant's Rule working: the next line is still filed by it", async () => {
		await run(await importLines("alex", [line(amex("M8054"), 250)]));
		await saveRule(db, {
			id: "rule-amex",
			householdId,
			memberId: "alex",
			pattern: "American Express payment",
			bucketId: "fun",
		});
		const [one] = await fromBank();
		if (!one) throw new Error("not imported");
		await rename(one, "Amex card", one.version);
		await nameSameMerchant(db, {
			householdId,
			memberId: "alex",
			transactionId: one.id,
			name: "Amex card",
		});

		await run(await importLines("alex", [line(amex("M9120"), 80)]));
		const next = (await fromBank()).find((t) => t.note === amex("M9120"));
		expect(next).toMatchObject({ merchant: "Amex card", bucketId: "fun" });
		expect((await outcomes())[amex("M9120")]).toEqual({ bucketId: "fun", outcome: "filed" });
	});

	it("drops a name the model made up for the cleaner's, and doesn't keep it", async () => {
		const raw = "MRKTPLC SVCS 88123";
		const namer = {
			name: async (raws: string[]) => new Map(raws.map((r) => [r, "Sunrise Bakery"])),
		};
		await run(await importLines("alex", [line(raw, 9)]), namer);
		const [named] = await fromBank();
		expect(named?.merchant).toBe(cleanMerchant(raw).name);
		expect((await loadMerchantNames(db, householdId, [raw])).size).toBe(0);
	});
});
