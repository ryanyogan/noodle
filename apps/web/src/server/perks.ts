import {
	addPerkSource as addPerkSourceInDb,
	addPerkUse,
	decidePerkSource as decidePerkSourceInDb,
	loadInsightSpends,
	loadPerkSources,
	type PerkSourceItem,
	removePerkUse as removePerkUseInDb,
	setPerkSourceFee as setPerkSourceFeeInDb,
	setPerkValue as setPerkValueInDb,
	updatePerkSource as updatePerkSourceInDb,
} from "@noodle/db";
import { addDays, dayKeyAt, PERK_RENEWALS, PERK_SOURCE_KINDS } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { startPerkResearch } from "./perk-research-workflow";
import { ulidSchema } from "./schemas";

// Perk Sources for the screen: Parents confirm or dismiss the ones the app spotted, add their
// own, say which plan tier one is, link its benefits page, or ask for it to be checked again.
// Each of those starts the Perk research Workflow, which stores its Perks (with the page they
// came from and when) and looks for the Perk Overlaps they make.

/** A benefits page a Parent links: a web address the Worker can fetch. */
const pageUrlSchema = z
	.string()
	.trim()
	.pipe(z.url({ protocol: /^https$/ }).max(2048));

const planSchema = z.string().trim().min(1).max(80);

const research = (household: HouseholdSummary, perkSourceId: string) =>
	startPerkResearch({ householdId: household.id, timeZone: household.timeZone, perkSourceId });

/** The Perk Sources the Parent may read that weren't dismissed, suggestions first, with their Perks. */
export const getPerkSources = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<PerkSourceItem[]> => {
		const db = getDb();
		const viewer = viewerOf(context);
		const asOf = dayKeyAt(new Date(), context.household.timeZone);
		// Four years back: a Perk that renews every four years may have been used that long ago.
		const spends = await loadInsightSpends(db, viewer, addDays(asOf, -4 * 366));
		return loadPerkSources(db, viewer, { asOf, spends });
	});

/** A Parent marks a Perk used today, by hand, with a short note. */
export const markPerkUsed = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			id: ulidSchema,
			perkId: z.string().min(1).max(64),
			note: z.string().trim().max(120).nullable(),
		}),
	)
	.handler(async ({ data, context }) => {
		const on = dayKeyAt(new Date(), context.household.timeZone);
		const stored = await addPerkUse(getDb(), viewerOf(context), {
			...data,
			note: data.note || null,
			on,
		});
		if (stored) await notifyHousehold(context.household.id, ["perks"]);
	});

/** Takes back a use marked by hand. */
export const removePerkUse = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema }))
	.handler(async ({ data, context }) => {
		if (await removePerkUseInDb(getDb(), viewerOf(context), data.id)) {
			await notifyHousehold(context.household.id, ["perks"]);
		}
	});

/** A Parent says what a card's annual fee is, or clears it. */
export const setPerkSourceFee = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({ id: ulidSchema, annualFeeCents: z.number().int().min(0).max(1_000_000).nullable() }),
	)
	.handler(async ({ data, context }) => {
		if (await setPerkSourceFeeInDb(getDb(), viewerOf(context), data)) {
			await notifyHousehold(context.household.id, ["perks"]);
		}
	});

/** A Parent types a perk's value and how often it renews, when its page states none. */
export const setPerkValue = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			id: z.string().min(1).max(64),
			valueCents: z.number().int().min(0).max(10_000_000).nullable(),
			renews: z.enum(PERK_RENEWALS).nullable(),
		}),
	)
	.handler(async ({ data, context }) => {
		if (await setPerkValueInDb(getDb(), viewerOf(context), data)) {
			await notifyHousehold(context.household.id, ["perks"]);
		}
	});

/** Confirms a suggested Perk Source (and researches its Perks), or dismisses or removes one. */
export const decidePerkSource = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema, status: z.enum(["confirmed", "dismissed"]) }))
	.handler(async ({ data, context }) => {
		const changed = await decidePerkSourceInDb(getDb(), viewerOf(context), data);
		if (!changed) return;
		// Removing one takes its Perks, so the Insights resting on them may go too.
		await notifyHousehold(context.household.id, ["perks", "insights"]);
		if (data.status === "confirmed") await research(context.household, data.id);
	});

/** Adds a Perk Source for the Household, and researches its Perks. */
export const addPerkSource = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			id: ulidSchema,
			name: z.string().trim().min(1).max(80),
			kind: z.enum(PERK_SOURCE_KINDS),
			plan: planSchema.nullable(),
			pageUrl: pageUrlSchema.nullable(),
		}),
	)
	.handler(async ({ data, context }) => {
		const id = await addPerkSourceInDb(getDb(), viewerOf(context), data);
		await notifyHousehold(context.household.id, ["perks"]);
		await research(context.household, id);
	});

/** Says which plan tier a Perk Source is, links its page, or checks it again: then researches it. */
export const updatePerkSource = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({ id: ulidSchema, plan: planSchema.optional(), pageUrl: pageUrlSchema.optional() }),
	)
	.handler(async ({ data, context }) => {
		const changed = await updatePerkSourceInDb(getDb(), viewerOf(context), data);
		if (!changed) return;
		await notifyHousehold(context.household.id, ["perks"]);
		await research(context.household, data.id);
	});
