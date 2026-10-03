import { z } from "zod";

// The get-started wizard (#53): its steps, what each one's answer looks like, and how the Setup
// Workflow's background jobs read to a Parent. Shared by the wizard's screens and its server
// functions, so both agree on what a saved answer is.

/** The wizard's steps, in order. Steps are numbered from 1 in the URL and in D1. */
export const SETUP_STEPS = [
	{ key: "hello", title: "Hello", minutes: 1 },
	{ key: "take-home-pay", title: "Take-home pay", minutes: 1 },
	{ key: "bills", title: "Bills", minutes: 2 },
	{ key: "buckets", title: "Buckets", minutes: 2 },
	{ key: "goal", title: "A Goal", minutes: 1 },
	{ key: "invite", title: "Invite the other Parent", minutes: 1 },
	{ key: "done", title: "Done", minutes: 0 },
] as const;

export const SETUP_STEP_COUNT = SETUP_STEPS.length;

/** Only Take-home pay can't be skipped (and Hello, which chooses the way in). */
export const canSkip = (step: number) => step !== 1 && step !== 2 && step !== SETUP_STEP_COUNT;

/** Roughly how many minutes are left from the start of `step` to the end. */
export const minutesLeft = (step: number) =>
	SETUP_STEPS.slice(Math.max(0, step - 1)).reduce((sum, { minutes }) => sum + minutes, 0);

/** How the Household will bring in spending, chosen on Hello. */
export const setupPathSchema = z.enum(["bank", "statement", "hand"]);
export type SetupPath = z.infer<typeof setupPathSchema>;

const idSchema = z.string().min(1).max(40);
const nameSchema = z.string().trim().min(1).max(40);
const centsSchema = z.number().int().min(0).max(1_000_000_000_00);

/**
 * A bill on step 3, as it was last written to the Plan: `id` is the Commitment's, made on the
 * client so writing it again never makes a second one. Unticked bills aren't in the Plan.
 */
export const setupBillSchema = z.object({
	key: z.string().min(1).max(80),
	id: idSchema,
	name: nameSchema,
	amountCents: centsSchema,
	cadence: z.enum(["monthly", "biweekly", "annual"]),
	dueDay: z.number().int().min(1).max(31),
	/** A detected Commitment's own date, which sets a biweekly or yearly schedule. */
	dueDate: z.string().max(10).optional(),
	ticked: z.boolean(),
	/** The Parent typed in this row; unset in older saves, which count as typed. */
	touched: z.boolean().optional(),
	/** Which plan-draft suggestion it came from, so adding it takes the suggestion away. */
	draftKey: z.string().max(200).optional(),
});
export type SetupBill = z.infer<typeof setupBillSchema>;

/** A Bucket on step 4, as it was last written to the Plan (see setupBillSchema). */
export const setupBucketSchema = z.object({
	key: z.string().min(1).max(80),
	id: idSchema,
	name: nameSchema,
	amountCents: centsSchema,
	rolling: z.boolean(),
	/** The signed-in Parent's Personal Allowance. */
	personal: z.boolean(),
	kept: z.boolean(),
	/** The Parent typed in this row; unset in older saves, which count as typed. */
	touched: z.boolean().optional(),
	draftKey: z.string().max(200).optional(),
});
export type SetupBucket = z.infer<typeof setupBucketSchema>;

export const setupGoalKindSchema = z.enum(["emergency", "save", "payoff"]);
export type SetupGoalKind = z.infer<typeof setupGoalKindSchema>;

/** The Goal added on step 5, with the ids used, so adding it again changes nothing. */
export const setupGoalSchema = z.object({
	kind: setupGoalKindSchema,
	goalId: idSchema,
	accountId: idSchema,
	balanceId: idSchema,
	claimId: idSchema,
	name: nameSchema,
	accountName: nameSchema,
	targetCents: centsSchema,
	accountKind: z.enum(["savings", "credit-card", "loan"]),
});
export type SetupGoal = z.infer<typeof setupGoalSchema>;

/** Everything answered so far. Later steps add their own (optional) fields here. */
export const setupAnswersSchema = z.object({
	path: setupPathSchema.optional(),
	takeHomePayCents: z.number().int().min(0).optional(),
	bills: z.array(setupBillSchema).max(60).optional(),
	buckets: z.array(setupBucketSchema).max(60).optional(),
	goal: setupGoalSchema.optional(),
	/** How many times "Run setup again" was pressed: each run gets its own Setup Workflow. */
	run: z.number().int().min(0).max(10_000).optional(),
	/** A Parent pressed "Don’t ask again" on This Month's Finish setting up (#72). */
	dismissed: z.boolean().optional(),
	/** A Parent dismissed This Month's "Apply suggested amounts" (#72). */
	amountsDismissed: z.boolean().optional(),
});
export type SetupAnswers = z.infer<typeof setupAnswersSchema>;

/**
 * Whether This Month offers "Continue setup" (#72): from the wizard's saved step until Done is
 * reached or a Parent dismisses it. What the Plan has doesn't count: take-home pay set from the
 * checklist after "Set up later" leaves the steps after it still to do.
 */
export const continueSetupShown = (setup: { finished: boolean; answers: SetupAnswers }) =>
	!setup.finished && setup.answers.dismissed !== true;

export const setupStepSchema = z.number().int().min(1).max(SETUP_STEP_COUNT);

/** The Setup Workflow's jobs, in the order it runs them. */
export const SETUP_JOBS = ["history", "categorize", "draft"] as const;
export type SetupJobKey = (typeof SETUP_JOBS)[number];

export type SetupJobView = { job: string; status: "waiting" | "running" | "done" | "skipped" };

/**
 * One line on how the background work stands, for the progress header; null when there is none
 * (by hand, or before it starts).
 */
export function backgroundStatus(jobs: SetupJobView[]): string | null {
	if (jobs.length === 0) return null;
	if (jobs.some((job) => job.status === "skipped")) {
		return "We’ll suggest amounts once your spending is in.";
	}
	const done = jobs.filter((job) => job.status === "done").length;
	if (done === jobs.length) return "Your spending is in. We’ll use it to suggest amounts.";
	const history = jobs.find((job) => job.job === "history");
	const reading = history?.status === "done" ? "Sorting your spending" : "Reading your spending";
	return `${reading}… ${done} of ${jobs.length} done`;
}

type PlanItem = { id: string; name: string };

/**
 * The steps whose answers aren't on the Plan (2 Take-home pay, 3 Bills, 4 Buckets), for Done to
 * check before it finishes: each step writes as the Parent goes, so normally none. A bill or
 * Bucket counts as there by its id, or by its name when the Plan already had one. Only monthly
 * bills are checked (a yearly one needn't fall in this month), and the Personal Allowance is
 * matched by its owner where it is written, not here.
 */
export function setupUnsaved(
	answers: SetupAnswers,
	plan: { baseline: number | null; commitments: PlanItem[]; buckets: PlanItem[] },
): number[] {
	const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
	const has = (items: PlanItem[], row: PlanItem) =>
		items.some((item) => item.id === row.id || same(item.name, row.name));
	const steps: number[] = [];
	if (answers.takeHomePayCents !== undefined && plan.baseline === null) steps.push(2);
	if (
		(answers.bills ?? []).some(
			(bill) => bill.ticked && bill.cadence === "monthly" && !has(plan.commitments, bill),
		)
	) {
		steps.push(3);
	}
	if (
		(answers.buckets ?? []).some(
			(bucket) => bucket.kept && !bucket.personal && !has(plan.buckets, bucket),
		)
	) {
		steps.push(4);
	}
	return steps;
}
