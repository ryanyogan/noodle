import { loadSetupJobs, loadSetupProgress, saveSetupProgress } from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	type SetupAnswers,
	type SetupJobView,
	setupAnswersSchema,
	setupPathSchema,
	setupStepSchema,
} from "../setup";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { startSetupWorkflow } from "./setup-workflow";

// The get-started wizard's server functions (#53): read and save where the Household is in it,
// and start the Setup Workflow. The answers themselves land through the Plan's own writes
// (setTakeHomePay, …); what's saved here is only so leaving and coming back resumes.

export type SetupState = {
	step: number;
	answers: SetupAnswers;
	skipped: number[];
	finished: boolean;
	jobs: SetupJobView[];
};

/** Where the Household is in the wizard, and how the Setup Workflow's jobs stand. */
export const getSetup = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<SetupState> => {
		const db = getDb();
		const [progress, jobs] = await Promise.all([
			loadSetupProgress(db, context.household.id),
			loadSetupJobs(db, context.household.id),
		]);
		const answers = setupAnswersSchema.safeParse(progress?.answers ?? {});
		return {
			step: progress?.step ?? 1,
			answers: answers.success ? answers.data : {},
			skipped: progress?.skipped ?? [],
			finished: progress?.finishedAt != null,
			jobs,
		};
	});

/** Saves the wizard's step, answers and skipped steps, after every step. Idempotent. */
export const saveSetup = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			step: setupStepSchema,
			answers: setupAnswersSchema,
			skipped: z.array(setupStepSchema).max(20),
			finished: z.boolean().optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		await saveSetupProgress(getDb(), context.household.id, {
			...data,
			skipped: [...new Set(data.skipped)].sort((a, b) => a - b),
		});
		await notifyHousehold(context.household.id, ["setup"]);
	});

/**
 * Starts the Setup Workflow when Hello chooses a bank or a statement: it waits for the history,
 * files it and drafts the Plan in the background. One per Household; starting again is a no-op.
 */
export const startSetup = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ path: setupPathSchema.exclude(["hand"]) }))
	.handler(async ({ context }) => {
		await startSetupWorkflow({
			householdId: context.household.id,
			memberId: context.parent.id,
			timeZone: context.household.timeZone,
		});
	});
