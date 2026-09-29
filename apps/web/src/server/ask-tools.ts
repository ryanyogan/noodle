import {
	type Db,
	type GoalRecords,
	listMembers,
	loadCharges,
	loadGoals,
	loadPlanRecords,
	loadSpendingBetween,
	loadUnassignedBetween,
	type MemberSummary,
	type Viewer,
} from "@noodle/db";
import {
	addMonths,
	anythingCheck,
	type Cents,
	type DayKey,
	dayKeyAt,
	earmarkOf,
	goalProgress,
	type MonthKey,
	moneyFreed,
	monthKeyAt,
	monthState,
	monthsBetween,
	type Plan,
	type PlanRecords,
	type ProjectionGoal,
	planAhead,
	planForMonth,
	project,
	typicalFreeToSpend,
	type Verdict,
} from "@noodle/domain";
import { z } from "zod";
import { formatMoney, monthName } from "../format";
import { loadMonth } from "./month";

// Ask's tools: the only way the model learns the Household's numbers. Each computes its figures
// exactly, with @noodle/domain, from reads made for the asking Parent as the Viewer (ADR-0003),
// so another Parent's Personal Allowance reaches the model only as its totals, never as
// Transactions. Tools hand the model amounts already formatted, and a one-line summary, so it
// only has to phrase them, never add them up (ADR-0012).

/** Who is asking, in which Household, and when. */
export type AskContext = {
	db: Db;
	household: { id: string; timeZone: string };
	parentId: string;
	now: Date;
};

/** An exact figure a tool computed, shown under the answer as it is. */
export type AskFact = { label: string; amount: Cents };

/** A screen that shows more, opened from the answer. */
export type AskLink =
	| { kind: "month"; month: MonthKey }
	| { kind: "transactions"; month: MonthKey }
	| { kind: "goals" }
	| { kind: "explore" }
	| { kind: "afford"; name: string; price: Cents };

export type ToolOutcome = {
	/** One sentence with the answer's figures, for the model to build on (and the fallback answer). */
	summary: string;
	/** The details the model may draw on, amounts as formatted text. */
	data: Record<string, unknown>;
	facts: AskFact[];
	links: AskLink[];
};

/** A tool as the model is offered it: a name, what it's for, and its arguments' JSON Schema. */
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

const monthPattern = "^\\d{4}-(0[1-9]|1[0-2])$";
const monthArg = z
	.string()
	.regex(new RegExp(monthPattern))
	.transform((m) => m as MonthKey);
/** Dollars as the model writes them: a number, or text like "$4,000". */
const dollarsArg = z
	.union([z.number(), z.string().transform((s) => Number(s.replace(/[$,\s]/g, "")))])
	.pipe(z.number().positive().max(100_000_000))
	.transform((d) => Math.round(d * 100) as Cents);
/** Models send absent optional arguments as null or "" as often as they leave them out. */
const optional = <T extends z.ZodType>(schema: T) =>
	z.preprocess((v) => (v === null || v === "" ? undefined : v), schema.optional());

const monthProperty = (description: string) => ({
	type: "string",
	pattern: monthPattern,
	description: `${description} As YYYY-MM.`,
});

export const TOOL_SPECS: ToolSpec[] = [
	{
		name: "month_overview",
		description:
			"A month of the Plan: Baseline, Free to Spend, what's left across Buckets, each Bucket's allowance, spent, left and Pace, and each Commitment's expected and charged amounts.",
		parameters: {
			type: "object",
			properties: { month: monthProperty("The month; the current month if left out.") },
		},
	},
	{
		name: "spending",
		description:
			"How much was spent over a range of months: in one Bucket or Commitment (by name), or in all Buckets together, optionally only what was For one Member. Gives the total, per month, and per Bucket.",
		parameters: {
			type: "object",
			properties: {
				name: { type: "string", description: "A Bucket or Commitment name, e.g. Hockey." },
				member: { type: "string", description: "Only spending For this Member (by name)." },
				from: monthProperty("First month; January of this year if left out."),
				to: monthProperty("Last month; the current month if left out."),
			},
		},
	},
	{
		name: "goals",
		description:
			"Every active Goal: its target, what's saved (its Earmark), what's left to save, its target date, what it needs each month, and whether it's on track.",
		parameters: { type: "object", properties: {} },
	},
	{
		name: "affordability_check",
		description:
			"An Affordability Check for buying something at a price: Comfortable, Stretch or Not Yet, and the month it's affordable by setting aside Free to Spend (plus a Goal's Earmark if one is named).",
		parameters: {
			type: "object",
			properties: {
				price: { type: "number", description: "The price in dollars." },
				name: { type: "string", description: "What it is, e.g. Disney trip." },
				by: monthProperty("The month it's wanted by, if the Parent said one."),
				goal: { type: "string", description: "A Goal already saving for it, by name." },
			},
			required: ["price"],
		},
	},
	{
		name: "allowance_scenario",
		description:
			"A Scenario: what changing one Bucket's monthly allowance would free up (or cost) over the next year, and which Goals it would reach sooner or later.",
		parameters: {
			type: "object",
			properties: {
				bucket: { type: "string", description: "The Bucket's name." },
				allowance: { type: "number", description: "The new monthly allowance in dollars." },
			},
			required: ["bucket", "allowance"],
		},
	},
];

const argSchemas = {
	month_overview: z.object({ month: optional(monthArg) }),
	spending: z.object({
		name: optional(z.string().trim().max(60)),
		member: optional(z.string().trim().max(60)),
		from: optional(monthArg),
		to: optional(monthArg),
	}),
	goals: z.object({}),
	affordability_check: z.object({
		price: dollarsArg,
		name: optional(z.string().trim().max(40)),
		by: optional(monthArg),
		goal: optional(z.string().trim().max(60)),
	}),
	allowance_scenario: z.object({
		bucket: z.string().trim().min(1).max(60),
		allowance: z
			.union([z.number(), z.string().transform((s) => Number(s.replace(/[$,\s]/g, "")))])
			.pipe(z.number().min(0).max(100_000_000))
			.transform((d) => Math.round(d * 100) as Cents),
	}),
} as const;

export type ToolName = keyof typeof argSchemas;

export const isToolName = (name: string): name is ToolName => Object.hasOwn(argSchemas, name);

/** What the Parent sees while a tool runs. */
export const toolStep: Record<ToolName, string> = {
	month_overview: "Reading the month",
	spending: "Adding up spending",
	goals: "Checking Goals",
	affordability_check: "Running an Affordability Check",
	allowance_scenario: "Projecting a Scenario",
};

/** Thrown for arguments a tool can't use; the model is told why and may try again. */
export class ToolArgumentError extends Error {}

/** Runs a tool with the model's (JSON) arguments, for the asking Parent. */
export async function runTool(
	name: ToolName,
	rawArguments: unknown,
	ctx: AskContext,
): Promise<ToolOutcome> {
	const parsed = argSchemas[name].safeParse(rawArguments ?? {});
	if (!parsed.success) {
		throw new ToolArgumentError(`Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`);
	}
	const args = parsed.data as never;
	switch (name) {
		case "month_overview":
			return monthOverview(ctx, args);
		case "spending":
			return spending(ctx, args);
		case "goals":
			return goals(ctx);
		case "affordability_check":
			return affordabilityCheck(ctx, args);
		case "allowance_scenario":
			return allowanceScenario(ctx, args);
	}
}

// ---------------------------------------------------------------------------------------------
// Helpers

const viewerOf = (ctx: AskContext): Viewer => ({
	householdId: ctx.household.id,
	memberId: ctx.parentId,
});

export const currentMonth = (ctx: AskContext) => monthKeyAt(ctx.now, ctx.household.timeZone);

const money = formatMoney;
const monthLabel = (month: MonthKey) => `${monthName(month)} ${month.slice(0, 4)}`;

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The item a Parent (or the model) most likely means by `query`: same name, else a partial match. */
export function findByName<T extends { name: string }>(items: T[], query: string): T | undefined {
	const q = normalize(query);
	if (!q) return undefined;
	return (
		items.find((item) => normalize(item.name) === q) ??
		items.find((item) => normalize(item.name).includes(q)) ??
		items.find((item) => q.includes(normalize(item.name)) && normalize(item.name).length > 2)
	);
}

/** Every month from `from` to `to`, both included. */
function monthsFrom(from: MonthKey, to: MonthKey): MonthKey[] {
	const count = monthsBetween(from, to) + 1;
	return Array.from({ length: count }, (_, i) => addMonths(from, i));
}

/** Whose Personal Allowance a Bucket is, as the asking Parent would say it. */
function ownerLabel(owner: string | undefined, ctx: AskContext, members: MemberSummary[]) {
	if (!owner) return undefined;
	if (owner === ctx.parentId) return "yours";
	return members.find((m) => m.id === owner)?.name ?? "the other Parent";
}

const statusText = { "on-pace": "on Pace", ahead: "ahead of Pace", over: "overspent" } as const;
const verdictName: Record<Verdict, string> = {
	comfortable: "Comfortable",
	stretch: "Stretch",
	"not-yet": "Not Yet",
};

/** The Goals still being saved for, as a projection starts them this month. */
function projectionGoals(
	records: GoalRecords,
	month: MonthKey,
): (ProjectionGoal & { name: string })[] {
	return records.goals
		.filter((g) => !g.completed && !g.archived)
		.map((g) => ({
			id: g.id,
			name: g.name,
			target: g.target,
			targetDate: g.targetDate,
			saved: earmarkOf(g.id, records.changes),
			fundedThisMonth: earmarkOf(
				g.id,
				records.changes.filter((c) => c.kind === "funding" && c.month === month),
			),
		}));
}

/** The next year of the Plan, ready to project, with the Goals it funds. */
async function yearAhead(ctx: AskContext) {
	const month = currentMonth(ctx);
	const [records, goalRecords] = await Promise.all([
		loadPlanRecords(ctx.db, ctx.household.id, addMonths(month, 11)),
		loadGoals(ctx.db, viewerOf(ctx)),
	]);
	const goals = projectionGoals(goalRecords, month);
	return { month, records, goals, ahead: planAhead(records, goals, month, 12) };
}

// ---------------------------------------------------------------------------------------------
// Tools

async function monthOverview(ctx: AskContext, args: { month?: MonthKey }): Promise<ToolOutcome> {
	const month = args.month ?? currentMonth(ctx);
	const [data, members] = await Promise.all([
		loadMonth(ctx.db, ctx.household, ctx.parentId, month),
		listMembers(ctx.db, ctx.household.id),
	]);
	const links: AskLink[] = [{ kind: "month", month }];
	if (data.plan.baseline === null) {
		return {
			summary: `There's no Plan for ${monthLabel(month)} yet.`,
			data: { month: monthLabel(month), planned: false },
			facts: [],
			links,
		};
	}
	const state = monthState(data);
	const summary = `In ${monthLabel(month)}, Free to Spend is ${money(state.freeToSpend)} and ${money(state.leftInBuckets)} is left across Buckets.`;
	return {
		summary,
		data: {
			month: monthLabel(month),
			asOf: data.asOf,
			daysLeft: state.daysLeft,
			baseline: money(state.baseline ?? 0),
			freeToSpend: money(state.freeToSpend),
			leftInBuckets: money(state.leftInBuckets),
			buckets: state.buckets.map((b) => ({
				name: b.name,
				available: money(b.available),
				spent: money(b.spent),
				left: money(b.left),
				status: statusText[b.status],
				personalAllowanceOf: ownerLabel(b.owner, ctx, members),
			})),
			commitments: state.commitments
				.filter((c) => c.status !== "not-due")
				.map((c) => ({
					name: c.name,
					expected: money(c.expected),
					charged: money(c.actual),
				})),
		},
		facts: [
			{ label: "Free to Spend", amount: state.freeToSpend },
			{ label: "Left in Buckets", amount: state.leftInBuckets },
			{ label: "Baseline", amount: state.baseline ?? 0 },
		],
		links,
	};
}

async function spending(
	ctx: AskContext,
	args: { name?: string; member?: string; from?: MonthKey; to?: MonthKey },
): Promise<ToolOutcome> {
	const current = currentMonth(ctx);
	let to = args.to ?? current;
	let from = args.from ?? (`${to.slice(0, 4)}-01` as MonthKey);
	if (from > to) [from, to] = [to, from];
	// Two years at most, ending at `to`.
	if (monthsBetween(from, to) > 23) from = addMonths(to, -23);
	const months = monthsFrom(from, to);
	const viewer = viewerOf(ctx);

	const start = `${from}-01` as DayKey;
	const until = `${addMonths(to, 1)}-01` as DayKey;
	const [records, members, spent, unassigned] = await Promise.all([
		loadPlanRecords(ctx.db, ctx.household.id, to),
		listMembers(ctx.db, ctx.household.id),
		loadSpendingBetween(ctx.db, viewer, start, until),
		loadUnassignedBetween(ctx.db, viewer, start, until),
	]);
	const plans = months.map((m) => planForMonth(records, m));
	const buckets = uniqueById(plans.flatMap((p) => p.buckets));
	const commitments = uniqueById(plans.flatMap((p) => p.commitments));
	const period = from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`;
	const links: AskLink[] = [{ kind: "transactions", month: to }];

	const member = args.member ? findByName(members, args.member) : undefined;
	if (args.member && !member) {
		throw new ToolArgumentError(
			`No Member named "${args.member}". Members: ${members.map((m) => m.name).join(", ")}.`,
		);
	}
	const bucket = args.name ? findByName(buckets, args.name) : undefined;
	const commitment = args.name && !bucket ? findByName(commitments, args.name) : undefined;
	if (args.name && !bucket && !commitment) {
		throw new ToolArgumentError(
			`No Bucket or Commitment named "${args.name}". Buckets: ${buckets.map((b) => b.name).join(", ")}. Commitments: ${commitments.map((c) => c.name).join(", ") || "none"}.`,
		);
	}

	if (commitment) {
		const charges = (await Promise.all(months.map((m) => loadCharges(ctx.db, viewer, m)))).map(
			(list) => list.filter((c) => c.commitmentId === commitment.id),
		);
		const byMonth = charges.map((list) => list.reduce((sum, c) => sum + c.amount, 0));
		const total = byMonth.reduce((sum, a) => sum + a, 0);
		return {
			summary: `${commitment.name} took ${money(total)} from ${period}.`,
			data: {
				commitment: commitment.name,
				period,
				total: money(total),
				byMonth: months.map((m, i) => ({ month: monthLabel(m), charged: money(byMonth[i] ?? 0) })),
				note: member ? "Commitment charges aren't tracked For Members." : undefined,
			},
			facts: [{ label: `${commitment.name}, ${period}`, amount: total }],
			links,
		};
	}

	const counted = spent.filter(
		(s) => (!bucket || s.bucketId === bucket.id) && (!member || s.for.includes(member.id)),
	);
	const total = counted.reduce((sum, s) => sum + s.amount, 0);
	const byMonth = months.map((m) =>
		counted.filter((s) => s.date.startsWith(m)).reduce((sum, s) => sum + s.amount, 0),
	);
	const byBucket = buckets
		.map((b) => ({
			name: b.name,
			amount: counted.filter((s) => s.bucketId === b.id).reduce((sum, s) => sum + s.amount, 0),
		}))
		.filter((b) => b.amount !== 0)
		.sort((a, b) => b.amount - a.amount);
	// Another Parent's Personal Allowance is only known as a total per month, For no one.
	const privateBuckets = buckets.filter((b) => b.owner && b.owner !== ctx.parentId);
	const what = bucket ? bucket.name : "Buckets";
	const forWhom = member ? ` For ${member.name}` : "";
	// Imported Transactions count once a Parent assigns them; until then they're only mentioned.
	const unassignedLine =
		unassigned.count === 0
			? ""
			: ` ${unassigned.count} imported Transaction${unassigned.count === 1 ? "" : "s"} (${money(unassigned.amount)}) ${unassigned.count === 1 ? "isn't" : "aren't"} assigned yet, so ${unassigned.count === 1 ? "it isn't" : "they aren't"} counted.`;
	return {
		summary: `${what}${forWhom}: ${money(total)} spent from ${period}.${unassignedLine}`,
		data: {
			bucket: bucket?.name,
			member: member?.name,
			period,
			total: money(total),
			byMonth: months.map((m, i) => ({ month: monthLabel(m), spent: money(byMonth[i] ?? 0) })),
			byBucket: bucket
				? undefined
				: byBucket.map((b) => ({ name: b.name, spent: money(b.amount) })),
			notCounted:
				unassigned.count === 0
					? undefined
					: { unassignedImportedTransactions: unassigned.count, amount: money(unassigned.amount) },
			note:
				member && privateBuckets.length > 0
					? `Spending in ${privateBuckets.map((b) => b.name).join(", ")} isn't counted For anyone: only its total is known.`
					: undefined,
		},
		facts: [
			{ label: `${what}${forWhom}, ${period}`, amount: total },
			...(bucket ? [] : byBucket.slice(0, 5).map((b) => ({ label: b.name, amount: b.amount }))),
		],
		links,
	};
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
	return [...new Map(items.map((item) => [item.id, item])).values()];
}

async function goals(ctx: AskContext): Promise<ToolOutcome> {
	const month = currentMonth(ctx);
	const records = await loadGoals(ctx.db, viewerOf(ctx));
	const active = records.goals.filter((g) => !g.completed && !g.archived);
	const rows = active.map((g) => ({ goal: g, progress: goalProgress(g, records.changes, month) }));
	const saved = rows.reduce((sum, r) => sum + r.progress.saved, 0);
	const statusName = {
		reached: "reached",
		"on-track": "on track",
		behind: "behind",
		"past-due": "past its date",
		saving: "saving, with no date",
	} as const;
	return {
		summary:
			rows.length === 0
				? "There are no active Goals."
				: `${rows.length} active Goal${rows.length === 1 ? "" : "s"} with ${money(saved)} saved: ${rows
						.map((r) => `${r.goal.name} ${money(r.progress.saved)} of ${money(r.goal.target)}`)
						.join("; ")}.`,
		data: {
			goals: rows.map(({ goal, progress }) => ({
				name: goal.name,
				target: money(goal.target),
				saved: money(progress.saved),
				leftToSave: money(progress.remaining),
				targetDate: goal.targetDate,
				neededEachMonth: progress.monthly === null ? undefined : money(progress.monthly),
				status: statusName[progress.status],
			})),
			completed: records.goals.filter((g) => g.completed && !g.archived).map((g) => g.name),
		},
		facts: rows.map(({ goal, progress }) => ({
			label: `${goal.name}, saved of ${money(goal.target)}`,
			amount: progress.saved,
		})),
		links: [{ kind: "goals" }],
	};
}

async function affordabilityCheck(
	ctx: AskContext,
	args: { price: Cents; name?: string; by?: MonthKey; goal?: string },
): Promise<ToolOutcome> {
	const { month, ahead, goals } = await yearAhead(ctx);
	const goal = args.goal ? findByName(goals, args.goal) : undefined;
	const saved = goal?.saved ?? 0;
	const monthly = Math.max(0, typicalFreeToSpend(project(ahead)));
	const check = anythingCheck({ price: args.price, saved, monthly, month });
	const name = args.name ? args.name.charAt(0).toUpperCase() + args.name.slice(1) : "It";
	const inTime =
		args.by === undefined
			? undefined
			: check.affordableIn !== null && check.affordableIn <= args.by;
	const byLine =
		args.by === undefined
			? ""
			: inTime
				? ` That's in time for ${monthLabel(args.by)}.`
				: ` That's not in time for ${monthLabel(args.by)}.`;
	const reasons = check.reasons.map((r) => r.text).join(" ");
	return {
		summary: `${name} at ${money(args.price)}: ${verdictName[check.verdict]}. ${reasons}${byLine}`,
		data: {
			what: args.name,
			price: money(args.price),
			verdict: verdictName[check.verdict],
			reasons,
			setAside: money(saved),
			fromGoal: goal?.name,
			stillToSave: money(check.shortfall),
			typicalFreeToSpendEachMonth: money(monthly),
			affordableIn: check.affordableIn ? monthLabel(check.affordableIn) : "no date yet",
			wantedBy: args.by ? monthLabel(args.by) : undefined,
			inTime,
		},
		facts: [
			{ label: "Price", amount: args.price },
			{ label: "Set aside", amount: Math.min(saved, args.price) },
			{ label: "Still to save", amount: check.shortfall },
			{ label: "Free to Spend in a typical month", amount: monthly },
		],
		links: [{ kind: "afford", name: args.name ?? "", price: args.price }],
	};
}

async function allowanceScenario(
	ctx: AskContext,
	args: { bucket: string; allowance: Cents },
): Promise<ToolOutcome> {
	const { month, records, ahead, goals } = await yearAhead(ctx);
	const plan: Plan = planForMonth(records as PlanRecords, month);
	const bucket = findByName(plan.buckets, args.bucket);
	if (!bucket) {
		throw new ToolArgumentError(
			`No Bucket named "${args.bucket}". Buckets: ${plan.buckets.map((b) => b.name).join(", ")}.`,
		);
	}
	const before = project(ahead);
	const after = project(ahead, [
		{ kind: "allowance", bucketId: bucket.id, amount: args.allowance },
	]);
	const freed = moneyFreed(before, after);
	const overYear = freed[freed.length - 1] ?? 0;
	const perMonth = bucket.allowance - args.allowance;
	const goalChanges = after.goals.flatMap((g) => {
		const was = before.goals.find((b) => b.goalId === g.goalId)?.reachedIn ?? null;
		if (was === g.reachedIn) return [];
		const name = goals.find((goal) => goal.id === g.goalId)?.name ?? "A Goal";
		return [
			{
				goal: name,
				reachedBefore: was ? monthLabel(was) : "not within a year",
				reachedAfter: g.reachedIn ? monthLabel(g.reachedIn) : "not within a year",
			},
		];
	});
	const change =
		overYear >= 0
			? `frees ${money(overYear)} over the next 12 months`
			: `costs ${money(-overYear)} over the next 12 months`;
	return {
		summary: `${bucket.name} at ${money(args.allowance)} a month instead of ${money(bucket.allowance)} ${change}.`,
		data: {
			bucket: bucket.name,
			allowanceNow: money(bucket.allowance),
			allowanceInScenario: money(args.allowance),
			freeToSpendChangeEachMonth: money(perMonth),
			freeToSpendThisMonthNow: money(before.months[0]?.freeToSpend ?? 0),
			freeToSpendThisMonthInScenario: money(after.months[0]?.freeToSpend ?? 0),
			overNext12Months: money(overYear),
			goalChanges,
		},
		facts: [
			{ label: `${bucket.name} allowance now`, amount: bucket.allowance },
			{ label: "In the Scenario", amount: args.allowance },
			{ label: "Over the next 12 months", amount: overYear },
		],
		links: [{ kind: "explore" }],
	};
}

/** Names the model can pass to the tools, for its instructions. */
export async function askVocabulary(ctx: AskContext) {
	const month = currentMonth(ctx);
	const [records, members, goalRecords] = await Promise.all([
		loadPlanRecords(ctx.db, ctx.household.id, month),
		listMembers(ctx.db, ctx.household.id),
		loadGoals(ctx.db, viewerOf(ctx)),
	]);
	const plan = planForMonth(records, month);
	return {
		month,
		today: dayKeyAt(ctx.now, ctx.household.timeZone),
		members: members
			.filter((m) => !m.removed)
			.map((m) => ({ name: m.name, kind: m.kind, you: m.id === ctx.parentId })),
		buckets: plan.buckets.map((b) => ({ name: b.name, owner: ownerLabel(b.owner, ctx, members) })),
		commitments: plan.commitments.map((c) => c.name),
		goals: goalRecords.goals.filter((g) => !g.completed && !g.archived).map((g) => g.name),
	};
}
