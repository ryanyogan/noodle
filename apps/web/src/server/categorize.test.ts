import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadTransactionsPage,
	saveRule,
	setBaseline,
	updateTransaction,
} from "@noodle/db";
import { categorizations, members, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type BucketChoice,
	type Classification,
	type Classifier,
	classifyPrompt,
	type MerchantToFile,
	memoryMerchants,
	readAnswer,
} from "./categorize-model";
import { type CategorizeDeps, categorizeImport, settleAssignment } from "./categorize-run";

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;

/** A fake model that answers from a table by merchant word, and records what it was shown. */
function fakeModel(answers: Record<string, { bucketId: string | null; confidence: number }> = {}) {
	const asked: { buckets: BucketChoice[]; merchants: MerchantToFile[] }[] = [];
	const classifier: Classifier = {
		async classify(buckets, merchants) {
			asked.push({ buckets, merchants });
			return merchants.map((merchant): Classification => {
				const word = Object.keys(answers).find((w) => merchant.key.includes(w));
				const answer = word ? answers[word] : undefined;
				return { key: merchant.key, bucketId: null, confidence: 0, ...answer };
			});
		},
	};
	return {
		classifier,
		asked,
		merchantsAsked: () => asked.flatMap((a) => a.merchants.map((m) => m.key)),
	};
}

let merchants: ReturnType<typeof memoryMerchants>;
const deps = (classifier: Classifier): CategorizeDeps => ({ db, classifier, merchants });

const line = (description: string, dollars: number, date = "2026-09-10"): StatementLine => ({
	date: date as StatementLine["date"],
	amount: -Math.round(dollars * 100),
	description,
	bankId: null,
});

/** Imports statement lines into the card Account for `by`, returning the Import's ID. */
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

/** Each imported Transaction's note, Bucket, and what categorization recorded. */
async function outcomes() {
	const [rows, decided] = await Promise.all([
		db.select().from(transactions),
		db.select().from(categorizations),
	]);
	return Object.fromEntries(
		rows
			.filter((row) => row.source === "import")
			.map((row) => {
				const categorization = decided.find((c) => c.transactionId === row.id);
				return [
					row.note,
					{
						id: row.id,
						bucketId: row.bucketId,
						outcome: categorization?.outcome ?? null,
						method: categorization?.method ?? null,
						suggestion: categorization?.bucketId ?? null,
					},
				];
			}),
	);
}

beforeEach(async () => {
	db = testDb();
	ids = 0;
	merchants = memoryMerchants();
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
	await setBaseline(db, { householdId, month, amountCents: 900_000 });
	for (const [bucketId, name] of [
		["groceries", "Groceries"],
		["gas", "Gas"],
		["fun", "Fun"],
	] as const) {
		await addBucket(db, { householdId, bucketId, name, color: 1, month, allowanceCents: 50_000 });
	}
	for (const memberId of ["alex", "sam"]) {
		await addPersonalAllowance(db, {
			householdId,
			memberId,
			bucketId: `${memberId}-pa`,
			name: memberId === "alex" ? "Alex's Secret Stash" : "Sam's Fun Money",
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

describe("categorizing an Import", () => {
	it("files by Rule over the model, and never asks the model about a ruled merchant", async () => {
		await saveRule(db, {
			id: "rule-costco",
			householdId,
			memberId: "alex",
			pattern: "Costco",
			bucketId: "groceries",
		});
		const model = fakeModel({ costco: { bucketId: "fun", confidence: 0.99 } });
		const importId = await importLines("alex", [
			line("COSTCO WHSE #0123 SEATTLE WA", 182.33),
			line("COSTCO WHSE #0456 KIRKLAND WA", 40.1, "2026-09-12"),
		]);

		const result = await categorizeImport(deps(model.classifier), alex, importId);

		expect(result).toEqual({ filed: 2, review: 0, months: ["2026-09"] });
		expect(Object.values(await outcomes())).toEqual([
			expect.objectContaining({ bucketId: "groceries", outcome: "filed", method: "rule" }),
			expect.objectContaining({ bucketId: "groceries", outcome: "filed", method: "rule" }),
		]);
		expect(model.asked).toEqual([]);
	});

	it("files by the model when it's sure, marking the Transaction in the list", async () => {
		const model = fakeModel({ shell: { bucketId: "gas", confidence: 0.93 } });
		const importId = await importLines("alex", [line("SHELL OIL 57442 HOUSTON TX", 48.2)]);

		await categorizeImport(deps(model.classifier), alex, importId);

		expect((await outcomes())["SHELL OIL 57442 HOUSTON TX"]).toMatchObject({
			bucketId: "gas",
			outcome: "filed",
			method: "model",
		});
		const page = await loadTransactionsPage(db, alex, { month, limit: 10 });
		expect(page.transactions[0]).toMatchObject({ bucketId: "gas", autoFiled: "model" });
	});

	it("leaves an unsure guess unassigned and flagged for Review, with the guess", async () => {
		const model = fakeModel({ "blue bottle": { bucketId: "fun", confidence: 0.55 } });
		const importId = await importLines("alex", [
			line("SQ *BLUE BOTTLE COFFEE", 6.5),
			line("ACME HOLDINGS 4411", 120),
		]);

		const result = await categorizeImport(deps(model.classifier), alex, importId);

		expect(result).toMatchObject({ filed: 0, review: 2 });
		const all = await outcomes();
		expect(all["SQ *BLUE BOTTLE COFFEE"]).toMatchObject({
			bucketId: null,
			outcome: "review",
			suggestion: "fun",
		});
		expect(all["ACME HOLDINGS 4411"]).toMatchObject({
			bucketId: null,
			outcome: "review",
			suggestion: null,
		});
		const page = await loadTransactionsPage(db, alex, { month, limit: 10 });
		expect(page.transactions.map((t) => t.autoFiled)).toEqual([null, null]);
	});

	it("learns from a Parent's change and files the merchant by similarity next time", async () => {
		const model = fakeModel({ target: { bucketId: "groceries", confidence: 0.9 } });
		const first = await importLines("alex", [line("TARGET T-1234 SEATTLE WA", 64.99)]);
		await categorizeImport(deps(model.classifier), alex, first);
		const [filed] = (await loadTransactionsPage(db, alex, { month, limit: 10 })).transactions;
		expect(filed).toMatchObject({ bucketId: "groceries", autoFiled: "model" });

		// Alex taps the marker and moves it to Fun: the marker goes, and the merchant is learned.
		const id = filed?.id as string;
		const edit = await updateTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: id,
			amountCents: 6_499,
			assignment: { bucketId: "fun" },
			note: "TARGET T-1234 SEATTLE WA",
			forMemberIds: [],
		});
		expect(edit.ok).toBe(true);
		const { teach } = await settleAssignment(deps(model.classifier), alex, id);
		await teach();
		expect((await outcomes())["TARGET T-1234 SEATTLE WA"]).toMatchObject({
			bucketId: "fun",
			outcome: null,
		});
		expect(merchants.size()).toBe(1);

		const second = await importLines("alex", [line("TARGET T-9876 SEATTLE WA", 12, "2026-09-20")]);
		const asked = model.merchantsAsked().length;
		await categorizeImport(deps(model.classifier), alex, second);

		expect((await outcomes())["TARGET T-9876 SEATTLE WA"]).toMatchObject({
			bucketId: "fun",
			outcome: "filed",
			method: "similar",
		});
		expect(model.merchantsAsked().length).toBe(asked);
	});

	it("asks the model once per merchant, only about money spent still unassigned, and only once", async () => {
		const model = fakeModel({ netflix: { bucketId: "fun", confidence: 0.97 } });
		const importId = await importLines("alex", [
			line("NETFLIX.COM", 22.99, "2026-09-03"),
			line("NETFLIX.COM", 22.99, "2026-09-04"),
			{ ...line("PAYMENT THANK YOU", 500), amount: 50_000 },
		]);

		const result = await categorizeImport(deps(model.classifier), alex, importId);
		const again = await categorizeImport(deps(model.classifier), alex, importId);

		expect(result).toMatchObject({ filed: 2, review: 0 });
		expect(again).toEqual({ filed: 0, review: 0, months: [] });
		expect(model.merchantsAsked()).toEqual(["netflix"]);
	});

	it("sends Review what it can't file when the model fails", async () => {
		const failing: Classifier = {
			classify: async () => {
				throw new Error("Workers AI is down");
			},
		};
		const importId = await importLines("alex", [line("SHELL OIL 57442 HOUSTON TX", 48.2)]);

		expect(await categorizeImport(deps(failing), alex, importId)).toMatchObject({
			filed: 0,
			review: 1,
		});
		expect((await outcomes())["SHELL OIL 57442 HOUSTON TX"]).toMatchObject({
			bucketId: null,
			outcome: "review",
		});
	});
});

describe("categorizing keeps the other Parent's Personal Allowance private", () => {
	it("never offers the model another Parent's Personal Allowance, by ID or name", async () => {
		const model = fakeModel();
		const importId = await importLines("sam", [line("SEPHORA 0042", 58)]);

		await categorizeImport(deps(model.classifier), sam, importId);

		const offered = model.asked.flatMap((a) => a.buckets.map((b) => b.id));
		expect(offered).toEqual(["groceries", "gas", "fun", "sam-pa"]);
		const prompt = classifyPrompt(model.asked[0]?.buckets ?? [], model.asked[0]?.merchants ?? []);
		expect(prompt).not.toContain("Alex's Secret Stash");
		expect(prompt).not.toContain("alex-pa");
	});

	it("never files into another Parent's Personal Allowance by Rule, similarity, or model", async () => {
		await saveRule(db, {
			id: "rule-sephora",
			householdId,
			memberId: "alex",
			pattern: "sephora",
			bucketId: "alex-pa",
		});
		await merchants.learn(householdId, "ulta beauty", "alex-pa");
		// A model that somehow answers with Alex's Personal Allowance.
		const model = fakeModel({ lego: { bucketId: "alex-pa", confidence: 0.99 } });
		const importId = await importLines("sam", [
			line("SEPHORA 0042", 58),
			line("ULTA BEAUTY", 31),
			line("LEGO STORE", 99),
		]);

		const result = await categorizeImport(deps(model.classifier), sam, importId);

		expect(result).toMatchObject({ filed: 0, review: 3 });
		for (const row of Object.values(await outcomes())) {
			expect(row).toMatchObject({ bucketId: null, outcome: "review", suggestion: null });
		}
		// Sephora's Rule and Ulta's filing aren't Sam's, so the model was asked about them.
		expect(model.merchantsAsked().sort()).toEqual(["lego store", "sephora", "ulta beauty"]);
	});

	it("uses the importing Parent's own Personal Allowance, but never keeps it as a guess for Review", async () => {
		const model = fakeModel({
			sephora: { bucketId: "sam-pa", confidence: 0.95 },
			lego: { bucketId: "sam-pa", confidence: 0.4 },
		});
		const importId = await importLines("sam", [line("SEPHORA 0042", 58), line("LEGO STORE", 99)]);

		await categorizeImport(deps(model.classifier), sam, importId);

		const all = await outcomes();
		expect(all["SEPHORA 0042"]).toMatchObject({ bucketId: "sam-pa", outcome: "filed" });
		expect(all["LEGO STORE"]).toMatchObject({
			bucketId: null,
			outcome: "review",
			suggestion: null,
		});
		// Alex doesn't see Sam's Personal Allowance spending, marked or not.
		const alexSees = (await loadTransactionsPage(db, alex, { month, limit: 10 })).transactions;
		expect(alexSees.map((t) => t.note)).toEqual(["LEGO STORE"]);
	});
});

describe("reading the model's answer", () => {
	const buckets = [
		{ id: "groceries", name: "Groceries" },
		{ id: "gas", name: "Gas" },
	];
	const toFile = [
		{ key: "costco", description: "COSTCO", amountCents: 100 },
		{ key: "shell", description: "SHELL", amountCents: 200 },
		{ key: "acme", description: "ACME", amountCents: 300 },
	];

	it("maps codes back to Buckets and treats anything else as no Bucket", () => {
		const text = `\`\`\`json
{"results":[{"merchant":"m1","bucket":"b1","confidence":0.9},{"merchant":"m2","bucket":"b9","confidence":0.9},{"merchant":"m3","bucket":"none","confidence":0.8}]}
\`\`\``;
		expect(readAnswer(text, buckets, toFile)).toEqual([
			{ key: "costco", bucketId: "groceries", confidence: 0.9 },
			{ key: "shell", bucketId: null, confidence: 0 },
			{ key: "acme", bucketId: null, confidence: 0 },
		]);
		expect(readAnswer("not json", buckets, toFile).every((c) => c.bucketId === null)).toBe(true);
	});

	it("lists Buckets and merchants by code in the prompt", () => {
		expect(classifyPrompt(buckets, toFile.slice(0, 1))).toBe(
			"Buckets:\nb1: Groceries\nb2: Gas\n\nMerchants:\nm1: COSTCO ($1.00)",
		);
	});
});
