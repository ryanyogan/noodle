import { loadOpenSuggestions, type SuggestionItem } from "@noodle/db";
import { CADENCES, type Cadence, type DayKey } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { centsSchema } from "./plan";
import { dayKeySchema } from "./schemas";
import { applyDecision } from "./suggestion-decision";

// Suggestions (ADR-0027): each Parent reads the Household's open ones and their own (ADR-0003).
// Accepting one adds what it suggests to this month's Plan with the usual Plan change, through the
// same writes as adding it by hand; dismissing one keeps it away until its evidence changes a lot.

export const getSuggestions = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<SuggestionItem[]> => loadOpenSuggestions(getDb(), viewerOf(context)),
	);

export type Terms = {
	name: string;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
	commitmentId?: string;
	merchant?: string;
	bucketId?: string;
	/** A new Commitment proposed as "about" (a utility). */
	about?: boolean | undefined;
};

export const decisionSchema = z.object({
	suggestionId: z.string().min(1).max(64),
	decision: z.enum(["add", "not-now"]),
	terms: z
		.object({
			name: z.string().trim().min(1).max(40),
			amountCents: centsSchema,
			cadence: z.enum(CADENCES as [Cadence, ...Cadence[]]).optional(),
			dueDate: dayKeySchema.optional(),
			about: z.boolean().optional(),
		})
		.optional(),
});

/** What a Parent decided about one suggestion, as the app sends it. */
export type Decision = z.infer<typeof decisionSchema>;

export const decideSuggestion = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(decisionSchema)
	.handler(({ data, context }) =>
		applyDecision(
			getDb(),
			{ viewer: viewerOf(context), timeZone: context.household.timeZone },
			data,
		),
	);
