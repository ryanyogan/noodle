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

/** Everything answered so far. Later steps add their own (optional) fields here. */
export const setupAnswersSchema = z.object({
	path: setupPathSchema.optional(),
	takeHomePayCents: z.number().int().min(0).optional(),
});
export type SetupAnswers = z.infer<typeof setupAnswersSchema>;

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
