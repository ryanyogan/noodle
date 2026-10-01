import {
	addAccount,
	addBucket,
	addCommitment,
	addGoal,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	setTakeHomePay,
} from "@noodle/db";
import { members, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { type AskModel, stubModel, textOfEvents } from "./ask-model";
import { type AskEvent, runAsk } from "./ask-run";
import { type AskContext, runTool, ToolArgumentError, type ToolName } from "./ask-tools";

const householdId = "household";
const month = "2026-09";
// Sunday 20 September 2026, midday in Chicago.
const now = new Date("2026-09-20T17:00:00Z");

let db: Db;
const as = (parentId: string): AskContext => ({
	db,
	household: { id: householdId, timeZone: "America/Chicago" },
	parentId,
	now,
});

const quickAdd = (
	by: string,
	transactionId: string,
	bucketId: string,
	amountCents: number,
	note: string | null = null,
	date: DayKey = "2026-09-10",
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date,
		amountCents,
		note,
		forMemberIds: [],
		createdByMemberId: by,
	});

/** A Transaction brought in from a statement: assigned to `bucketId`, or unassigned. */
const imported = (id: string, amountCents: number, bucketId: string | null, date = "2026-09-05") =>
	db.insert(transactions).values({
		id,
		householdId,
		source: "import",
		date,
		amountCents,
		bucketId,
		note: `Statement line ${id}`,
	});

beforeEach(async () => {
	db = testDb();
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
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	for (const [memberId, allowanceCents] of [
		["alex", 20_000],
		["sam", 15_000],
	] as const) {
		await addPersonalAllowance(db, {
			householdId,
			memberId,
			bucketId: `${memberId}-pa`,
			name: memberId === "alex" ? "Alex's Fun" : "Sam's Fun",
			color: 2,
			month,
			allowanceCents,
		});
	}
	await quickAdd("alex", "gift-for-sam", "alex-pa", 4_200, "Birthday gift for Sam");
	await quickAdd("alex", "book", "alex-pa", 1_800, "Novel", "2026-09-12");
	await quickAdd("alex", "milk", "groceries", 650);
	await quickAdd("sam", "coffee", "sam-pa", 500, "Coffee");
	await addAccount(db, {
		householdId,
		accountId: "savings",
		name: "Savings",
		kind: "savings",
		balanceCents: 1_000_000,
		balanceId: "balance-savings",
		createdByMemberId: "alex",
	});
	await addGoal(db, {
		householdId,
		goalId: "disney",
		accountId: "savings",
		name: "Disney",
		targetCents: 600_000,
		targetDate: "2027-03-15",
		fromMonth: month,
		claimId: "claim-disney",
		claimCents: 150_000,
		createdByMemberId: "alex",
	});
});

const factAmount = (outcome: { facts: { label: string; amount: number }[] }, label: string) =>
	outcome.facts.find((f) => f.label.startsWith(label))?.amount;

describe("Ask's tools", () => {
	it("gives the month's Free to Spend and what's left in Buckets", async () => {
		const outcome = await runTool("month_overview", {}, as("alex"));
		// take-home pay − allowances; spending inside Buckets doesn't change Free to Spend.
		expect(factAmount(outcome, "Free to Spend")).toBe(900_000 - 120_000 - 20_000 - 15_000);
		expect(factAmount(outcome, "Left in Buckets")).toBe(155_000 - 4_200 - 1_800 - 650 - 500);
		expect(outcome.links).toEqual([{ kind: "month", month }]);
	});

	it("adds up a Bucket's spending, imported Transactions once they're assigned", async () => {
		await imported("costco", 8_000, "groceries");
		await imported("unassigned", 9_900, null);
		const outcome = await runTool(
			"spending",
			{ name: "groceries", from: "2026-01", to: null },
			as("alex"),
		);
		expect(outcome.facts[0]?.amount).toBe(650 + 8_000);
		expect(outcome.summary).toContain("1 imported Transaction ($99) isn't assigned yet");
		expect(outcome.links).toEqual([{ kind: "transactions", month }]);
	});

	it("tells the model which names exist when one doesn't", async () => {
		await expect(runTool("spending", { name: "Hockey" }, as("alex"))).rejects.toThrow(
			ToolArgumentError,
		);
		await expect(
			runTool("allowance_scenario", { bucket: "Hockey", allowance: 100 }, as("alex")),
		).rejects.toThrow(/Buckets: Groceries/);
	});

	it("reads Goals with their what Goals have set aside", async () => {
		const outcome = await runTool("goals", {}, as("sam"));
		expect(outcome.facts).toEqual([{ label: "Disney, set aside toward $6,000", amount: 150_000 }]);
	});

	it("checks affordability at a price the model writes as text", async () => {
		const outcome = await runTool(
			"affordability_check",
			{ price: "$4,000", name: "Disney trip", goal: "disney", by: "" },
			as("alex"),
		);
		expect(factAmount(outcome, "Price")).toBe(400_000);
		expect(factAmount(outcome, "Set aside")).toBe(150_000);
		expect(factAmount(outcome, "Still to save")).toBe(250_000);
		expect(outcome.links).toEqual([{ kind: "afford", name: "Disney trip", price: 400_000 }]);
	});

	it("projects an allowance Scenario", async () => {
		const outcome = await runTool(
			"allowance_scenario",
			{ bucket: "Groceries", allowance: 1_000 },
			as("alex"),
		);
		expect(factAmount(outcome, "In the Scenario")).toBe(100_000);
		expect(outcome.data.freeToSpendChangeEachMonth).toBe("$200");
		// "Try in Explore": the same change, as a Change preset built here, never by the model.
		expect(outcome.links).toEqual([
			{ kind: "explore", name: "Groceries at $1,000", lever: "allowance:groceries:100000:2026-09" },
		]);
	});

	it("offers no Scenario of the other Parent's Personal Allowance to try", async () => {
		const outcome = await runTool(
			"allowance_scenario",
			{ bucket: "Alex's Fun", allowance: 100 },
			as("sam"),
		);
		expect(outcome.links).toEqual([{ kind: "explore" }]);
	});
});

describe("Ask's Commitment Scenarios", () => {
	beforeEach(async () => {
		await addCommitment(db, {
			householdId,
			memberId: "alex",
			commitmentId: "netflix",
			name: "Netflix",
			month,
			amountCents: 1_799,
			cadence: "monthly",
			dueDate: "2026-09-15",
		});
	});

	it("projects ending a Commitment, to try in Explore", async () => {
		const outcome = await runTool("commitment_scenario", { commitment: "netflix" }, as("alex"));
		expect(factAmount(outcome, "Over the next 12 months")).toBe(12 * 1_799);
		expect(outcome.summary).toBe("Ending Netflix frees $215.88 over the next 12 months.");
		expect(outcome.links).toEqual([
			{ kind: "explore", name: "Without Netflix", lever: "end-commitment:netflix:2026-09" },
		]);
	});

	it("projects a Commitment at a new price, in cents worked out here", async () => {
		const outcome = await runTool(
			"commitment_scenario",
			{ commitment: "Netflix", amount: "$19.99" },
			as("alex"),
		);
		expect(factAmount(outcome, "In the Scenario")).toBe(1_999);
		expect(factAmount(outcome, "Over the next 12 months")).toBe(-12 * 200);
		expect(outcome.links).toEqual([
			{
				kind: "explore",
				name: "Netflix at $19.99",
				lever: "commitment-terms:netflix:1999:2026-09",
			},
		]);
	});

	it("tells the model which Commitments exist when one doesn't", async () => {
		await expect(
			runTool("commitment_scenario", { commitment: "Hulu" }, as("alex")),
		).rejects.toThrow(/Commitments: Netflix/);
	});

	it("answers “what if we cancel” with a Scenario to try in Explore", async () => {
		const events: AskEvent[] = [];
		for await (const event of runAsk({
			ctx: as("alex"),
			model: stubModel,
			question: "What if we cancel Netflix?",
			history: [],
		})) {
			events.push(event);
		}
		expect(events[0]).toEqual({ type: "step", label: "Projecting a Scenario" });
		const result = events.find((e) => e.type === "result");
		expect(result?.type === "result" && result.links).toEqual([
			{ kind: "explore", name: "Without Netflix", lever: "end-commitment:netflix:2026-09" },
		]);
	});

	it("reads “what if” at a price as the Commitment's new terms", async () => {
		const events: AskEvent[] = [];
		for await (const event of runAsk({
			ctx: as("alex"),
			model: stubModel,
			question: "What if Netflix was $20?",
			history: [],
		})) {
			events.push(event);
		}
		const result = events.find((e) => e.type === "result");
		expect(result?.type === "result" && result.links[0]).toMatchObject({
			lever: "commitment-terms:netflix:2000:2026-09",
		});
	});
});

describe("Ask and Personal Allowance privacy", () => {
	const calls: [ToolName, Record<string, unknown>][] = [
		["month_overview", {}],
		["spending", {}],
		["spending", { name: "Alex's Fun" }],
		["spending", { member: "Sam" }],
		["goals", {}],
		["affordability_check", { price: 50 }],
		["allowance_scenario", { bucket: "Alex's Fun", allowance: 100 }],
	];

	it("hands the model only the other Parent's Personal Allowance totals, never its items", async () => {
		for (const [name, args] of calls) {
			const outcome = JSON.stringify(await runTool(name, args, as("sam")));
			expect(outcome).not.toMatch(/gift|Birthday|Novel|book/i);
		}
		const alexsFun = await runTool("spending", { name: "Alex's Fun" }, as("sam"));
		expect(alexsFun.facts[0]?.amount).toBe(4_200 + 1_800);
	});

	it("streams nothing private through a whole Ask", async () => {
		const events: AskEvent[] = [];
		for await (const event of runAsk({
			ctx: as("sam"),
			model: stubModel,
			question: "How much did we spend on Alex's Fun?",
			history: [],
		})) {
			events.push(event);
		}
		expect(JSON.stringify(events)).not.toMatch(/gift|Birthday|Novel/i);
		expect(events.at(-1)).toEqual({ type: "done" });
	});
});

describe("runAsk", () => {
	const ask = async (question: string, model: AskModel = stubModel) => {
		const events: AskEvent[] = [];
		for await (const event of runAsk({ ctx: as("alex"), model, question, history: [] })) {
			events.push(event);
		}
		return events;
	};
	const textOf = (events: AskEvent[]) =>
		events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");

	it("shows the step, then the figures, then streams the answer", async () => {
		const events = await ask("How much have we spent on Groceries this year?");
		expect(events.map((e) => e.type)).toEqual([
			"step",
			"result",
			...events.slice(2, -1).map(() => "text"),
			"done",
		]);
		expect(events[0]).toEqual({ type: "step", label: "Adding up spending" });
		expect(textOf(events)).toBe("Groceries: $6.50 spent from January 2026 to September 2026.");
	});

	it("asks for a price rather than guessing one", async () => {
		const events = await ask("Can we afford Disney in March?");
		expect(events).toEqual([
			{ type: "text", text: "What does it cost? Tell me the price and I'll check." },
			{ type: "done" },
		]);
	});

	it("answers with the tools' own sentences when the model says nothing", async () => {
		const silent: AskModel = { ...stubModel, answer: async function* () {} };
		const events = await ask("How are we doing this month?", silent);
		expect(textOf(events)).toMatch(/^In September 2026, Free to Spend is \$7,450 /);
	});

	it("never passes on figures the model states without a tool", async () => {
		let turns = 0;
		const guessing: AskModel = {
			...stubModel,
			turn: async (messages, tools) => {
				turns++;
				// Guesses first; told to use a tool, it does.
				return turns === 1
					? { toolCalls: [], text: "Groceries is $50 a month." }
					: stubModel.turn(messages, tools);
			},
		};
		const events = await ask("What if Groceries went to $1,000?", guessing);
		expect(textOf(events)).toMatch(/^Groceries at \$1,000 a month instead of \$1,200/);

		const stubborn: AskModel = {
			...stubModel,
			turn: async () => ({ toolCalls: [], text: "About $50." }),
		};
		expect(textOf(await ask("What's left?", stubborn))).toBe(
			"I couldn't work that out from the Household's numbers. Try asking another way.",
		);
	});

	it("reports a failure when the model can't be reached", async () => {
		const down: AskModel = {
			...stubModel,
			turn: async () => {
				throw new Error("503");
			},
		};
		expect(await ask("What's left?", down)).toEqual([{ type: "error" }]);
	});
});

describe("textOfEvents", () => {
	const streamOf = (...chunks: string[]) =>
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
				controller.close();
			},
		});
	const read = async (stream: ReadableStream<Uint8Array>) => {
		const texts: string[] = [];
		for await (const text of textOfEvents(stream)) texts.push(text);
		return texts;
	};

	it("reads the answer's text across chunks, leaving out reasoning", async () => {
		const texts = await read(
			streamOf(
				'data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"You have "}}]}\n\ndata: {"choi',
				'ces":[{"delta":{"content":"$12.00"}}]}\n\n',
				"data: [DONE]\n\n",
				'data: {"choices":[{"delta":{"content":"after done"}}]}\n\n',
			),
		);
		expect(texts).toEqual(["You have ", "$12.00"]);
	});

	it("reads the older Workers AI event shape", async () => {
		expect(await read(streamOf('data: {"response":"Hi"}\r\n\r\ndata: {"response":"!"}'))).toEqual([
			"Hi",
			"!",
		]);
	});
});
