import {
	addAccount,
	addBucket,
	addCapture,
	addPersonalAllowance,
	createCaptureToken,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadReview,
	loadTransactionsPage,
	saveRule,
	setTakeHomePay,
	updateTransaction,
} from "@noodle/db";
import { categorizations, members, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { merchantKey, type StatementLine } from "@noodle/domain";
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
import {
	type CategorizeDeps,
	categorizeCapture,
	categorizeImport,
	lookAgainAtReview,
	settleAssignment,
} from "./categorize-run";

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
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, name] of [
		["groceries", "Groceries"],
		["gas", "Gas"],
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

		expect(result).toEqual({
			filed: 2,
			review: 0,
			months: ["2026-09"],
			methods: { rule: 2, similar: 0, model: 0, none: 0 },
		});
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
		expect(again).toMatchObject({ filed: 0, review: 0, months: [] });
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

	it("uses the importing Parent's own Personal Allowance, and keeps it as a guess only they see", async () => {
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
			method: "model",
			suggestion: "sam-pa",
		});
		const [samsCard] = (await loadReview(db, sam, 10)).items;
		expect(samsCard?.guess).toMatchObject({ bucketId: "sam-pa", method: "model" });
		const [alexsCard] = (await loadReview(db, alex, 10)).items;
		expect(alexsCard).toMatchObject({ guess: null, lookedAt: "none" });
		// Alex doesn't see Sam's Personal Allowance spending, marked or not.
		const alexSees = (await loadTransactionsPage(db, alex, { month, limit: 10 })).transactions;
		expect(alexSees.map((t) => t.note)).toEqual(["LEGO STORE"]);
	});
});

describe("keeping guesses for Review, and looking again", () => {
	it("keeps a merchant alike but not alike enough as a guess, naming it, and records why", async () => {
		// Three of its four words: 0.75 alike in the memory index, at the floor, short of filing.
		await merchants.learn(householdId, "blue bottle coffee", "fun");
		const model = fakeModel({ "trader joe": { bucketId: "groceries", confidence: 0.6 } });
		const importId = await importLines("alex", [
			line("BLUE BOTTLE COFFEE OAKLAND", 18),
			line("TRADER JOE S 552", 40),
			line("ACME HOLDINGS 4411", 120),
		]);

		const result = await categorizeImport(deps(model.classifier), alex, importId);

		expect(result.methods).toEqual({ rule: 0, similar: 1, model: 1, none: 1 });
		const decided = await db.select().from(categorizations);
		const by = (note: string) => {
			const id = Object.values(decided).find((c) => c.merchant === merchantKey(note));
			return id && { method: id.method, bucketId: id.bucketId, reason: id.reason };
		};
		expect(by("BLUE BOTTLE COFFEE OAKLAND")).toEqual({
			method: "similar",
			bucketId: "fun",
			reason: "blue bottle coffee",
		});
		expect(by("TRADER JOE S 552")).toMatchObject({ method: "model", bucketId: "groceries" });
		expect(by("ACME HOLDINGS 4411")).toEqual({ method: "none", bucketId: null, reason: null });
		const page = await loadTransactionsPage(db, alex, { month, limit: 10 });
		expect(page.transactions.every((t) => t.bucketId === null)).toBe(true);
	});

	it("looks again at what waits in Review once the Plan has a Bucket for it, idempotently", async () => {
		const importId = await importLines("alex", [line("SHELL OIL 123", 50), line("ACME 9", 3)]);
		await categorizeImport(deps(fakeModel().classifier), alex, importId);
		expect((await loadReview(db, alex, 10)).items.map((i) => i.lookedAt)).toEqual(["none", "none"]);

		const model = fakeModel({
			shell: { bucketId: "gas", confidence: 0.95 },
			acme: { bucketId: "fun", confidence: 0.5 },
		});
		const again = await lookAgainAtReview(deps(model.classifier), alex);

		expect(again).toMatchObject({ filed: 1, review: 1 });
		const queue = await loadReview(db, alex, 10);
		expect(queue.items.map((i) => [i.note, i.guess?.bucketId, i.lookedAt])).toEqual([
			["ACME 9", "fun", "model"],
		]);
		expect(await lookAgainAtReview(deps(model.classifier), alex)).toMatchObject({
			filed: 0,
			review: 1,
		});
		expect((await loadReview(db, alex, 10)).items).toHaveLength(1);
		// What Alex imported is Alex's to look again at, with Alex's Rules and Allowance.
		expect(await lookAgainAtReview(deps(model.classifier), sam)).toMatchObject({ review: 0 });
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
			{ key: "shell", bucketId: null, confidence: 0, problem: "unknown Bucket code" },
			{ key: "acme", bucketId: null, confidence: 0 },
		]);
		expect(readAnswer("not json", buckets, toFile)).toEqual(
			toFile.map(({ key }) => ({ key, bucketId: null, confidence: 0, problem: "not JSON" })),
		);
		const short =
			'{"results":[{"merchant":"m1","bucket":"b2","confidence":0.6,"why":" a gas station "}]}';
		expect(readAnswer(short, buckets, toFile)).toEqual([
			{ key: "costco", bucketId: "gas", confidence: 0.6, why: "a gas station" },
			{ key: "shell", bucketId: null, confidence: 0, problem: "unanswered" },
			{ key: "acme", bucketId: null, confidence: 0, problem: "unanswered" },
		]);
	});

	it("lists Buckets and merchants by code in the prompt", () => {
		expect(classifyPrompt(buckets, toFile.slice(0, 1))).toBe(
			"Buckets:\nb1: Groceries\nb2: Gas\n\nMerchants:\nm1: COSTCO ($1.00)",
		);
	});
});

describe("categorizing a captured Quick Add", () => {
	beforeEach(async () => {
		await createCaptureToken(db, { householdId, memberId: "alex", tokenId: "t", tokenHash: "h" });
	});

	/** Captures `merchant` as Alex's Quick Add through their Shortcut, returning its ID. */
	async function capture(merchant: string, dollars: number) {
		const transactionId = newId();
		const result = await addCapture(db, {
			tokenId: "t",
			householdId,
			memberId: "alex",
			transactionId,
			date: "2026-09-10",
			amountCents: Math.round(dollars * 100),
			merchant,
			newId,
		});
		expect(result).toMatchObject({ ok: true, added: true });
		return transactionId;
	}

	async function outcome(transactionId: string) {
		const row = (await db.select().from(transactions)).find((t) => t.id === transactionId);
		const decided = (await db.select().from(categorizations)).find(
			(c) => c.transactionId === transactionId,
		);
		return {
			bucketId: row?.bucketId ?? null,
			outcome: decided?.outcome ?? null,
			method: decided?.method ?? null,
			suggestion: decided?.bucketId ?? null,
		};
	}

	it("files by Rule, then a similar merchant, then the model when it's sure; else Review", async () => {
		await saveRule(db, {
			id: "rule-costco",
			householdId,
			memberId: "alex",
			pattern: "Costco",
			bucketId: "groceries",
		});
		await merchants.learn(householdId, merchantKey("Shell Oil"), "gas");
		const model = fakeModel({
			costco: { bucketId: "fun", confidence: 0.99 },
			"blue bottle": { bucketId: "fun", confidence: 0.95 },
			nopa: { bucketId: "fun", confidence: 0.5 },
		});
		const costco = await capture("Costco", 182.33);
		const shell = await capture("Shell Oil", 40);
		const coffee = await capture("Blue Bottle Coffee", 5.75);
		const nopa = await capture("Nopa", 64);

		for (const id of [costco, shell, coffee, nopa]) {
			await categorizeCapture(deps(model.classifier), alex, id);
		}
		expect(await outcome(costco)).toMatchObject({ bucketId: "groceries", method: "rule" });
		expect(await outcome(shell)).toMatchObject({ bucketId: "gas", method: "similar" });
		expect(await outcome(coffee)).toMatchObject({
			bucketId: "fun",
			outcome: "filed",
			method: "model",
		});
		expect(await outcome(nopa)).toEqual({
			bucketId: null,
			outcome: "review",
			method: "model",
			suggestion: "fun",
		});
		expect(model.merchantsAsked()).toEqual([
			merchantKey("Blue Bottle Coffee"),
			merchantKey("Nopa"),
		]);
	});

	it("categorizes a capture once, and leaves one a Parent already assigned", async () => {
		const model = fakeModel({ "blue bottle": { bucketId: "fun", confidence: 0.95 } });
		const coffee = await capture("Blue Bottle Coffee", 5.75);
		expect(await categorizeCapture(deps(model.classifier), alex, coffee)).toMatchObject({
			filed: 1,
			months: [month],
		});
		expect(await categorizeCapture(deps(model.classifier), alex, coffee)).toMatchObject({
			filed: 0,
			review: 0,
			months: [],
		});
		expect(model.asked).toHaveLength(1);
	});

	it("never files it into, or shows the model, the other Parent's Personal Allowance", async () => {
		const model = fakeModel({ "blue bottle": { bucketId: "sam-pa", confidence: 0.99 } });
		const coffee = await capture("Blue Bottle Coffee", 5.75);
		await categorizeCapture(deps(model.classifier), alex, coffee);
		expect(await outcome(coffee)).toMatchObject({
			bucketId: null,
			outcome: "review",
			suggestion: null,
		});
		expect(model.asked[0]?.buckets.map((bucket) => bucket.id)).not.toContain("sam-pa");
	});
});
