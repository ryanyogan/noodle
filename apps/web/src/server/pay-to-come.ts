import {
	addPayToCome as addPayToComeInDb,
	changePayToCome as changePayToComeInDb,
	loadParentPay,
	loadPayLines,
	loadPayToCome,
	PAY_FROM_MAX,
	type PayToComeChanged,
	removePayToCome as removePayToComeInDb,
	sayNotThisPay as sayNotThisPayInDb,
	sayPayArrived as sayPayArrivedInDb,
} from "@noodle/db";
import {
	type Cents,
	type DayKey,
	dayKeyAt,
	MAX_CENTS,
	type PayFit,
	payToComeChoices,
	payToComeMonth,
	payToComeOffers,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Pay to come on Plan › Income (issue 159, phase a; ADR-0066): pay a Parent has earned that is
// not in yet. Like Income and how each Parent is paid, it is the Household's, never private, so
// both Parents read all of it and either records it for either.

/** A line of Income as it is offered or picked. */
export type PayToComeLineChoice = {
	incomeId: string;
	amount: Cents;
	date: DayKey;
	note: string | null;
	fit: PayFit;
};

export type PayToComeWaiting = {
	id: string;
	from: string;
	/** What was earned, and what is still to come of it. */
	amount: Cents;
	left: Cents;
	expectedOn: DayKey | null;
	/** Days past its expected day; null when it isn't late. */
	lateBy: number | null;
	/** Income that looks like all of it arriving: "Is this it?". */
	offers: PayToComeLineChoice[];
};

export type PayToComeArrived = {
	id: string;
	from: string;
	incomeId: string;
	/** How much of the Pay to come the line is, the line's own amount and the day it landed. */
	covers: Cents;
	amount: Cents;
	date: DayKey;
};

/** One Parent's Pay to come in a month. */
export type ParentPayToCome = {
	memberId: string;
	name: string;
	/** Hourly, or pay that varies: the Parent can record more. */
	varies: boolean;
	waiting: PayToComeWaiting[];
	/** The total still to come. It counts nowhere. */
	total: Cents;
	arrived: PayToComeArrived[];
};

export type PayToComeRead = {
	parents: ParentPayToCome[];
	/** Who pay has come from before, for the next one. */
	names: string[];
};

/** Each Parent's Pay to come as the month reads it: earned and not in yet, and what arrived. */
export const getPayToCome = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<PayToComeRead> => {
		const db = getDb();
		const { id: householdId, timeZone } = context.household;
		const [parents, all] = await Promise.all([
			loadParentPay(db, householdId),
			loadPayToCome(db, householdId),
		]);
		const lines = await loadPayLines(db, householdId, all);
		const noteOf = new Map(lines.map((line) => [line.id, line.note]));
		const today = dayKeyAt(new Date(), timeZone);
		return {
			names: [...new Set(all.map((pay) => pay.from))].sort((a, b) => a.localeCompare(b)),
			parents: parents.map((parent) => {
				const own = all.filter((pay) => pay.memberId === parent.memberId);
				const read = payToComeMonth(own, data.month, today);
				return {
					memberId: parent.memberId,
					name: parent.name,
					varies: parent.pay === null,
					total: read.total,
					waiting: read.waiting.map(({ pay, left, lateBy }) => ({
						id: pay.id,
						from: pay.from,
						amount: pay.amount,
						left,
						expectedOn: pay.expectedOn,
						lateBy,
						offers: payToComeOffers(pay, all, lines).map((line) => ({
							incomeId: line.id,
							amount: line.amount,
							date: line.date,
							note: noteOf.get(line.id) ?? null,
							fit: line.amount === left ? "exact" : "close",
						})),
					})),
					arrived: read.arrived.map(({ pay, arrival }) => ({
						id: pay.id,
						from: pay.from,
						...arrival,
					})),
				};
			}),
		};
	});

/** The lines of Income a Parent can say one arrived as, newest first. */
export const getPayToComeChoices = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema }))
	.handler(async ({ data, context }): Promise<PayToComeLineChoice[]> => {
		const db = getDb();
		const all = await loadPayToCome(db, context.household.id);
		const pay = all.find((one) => one.id === data.id);
		if (!pay) return [];
		const lines = await loadPayLines(db, context.household.id, all);
		const noteOf = new Map(lines.map((line) => [line.id, line.note]));
		return payToComeChoices(pay, all, lines).map(({ line, fit }) => ({
			incomeId: line.id,
			amount: line.amount,
			date: line.date,
			note: noteOf.get(line.id) ?? null,
			fit,
		}));
	});

const daySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.nullable();
const details = {
	from: z.string().trim().min(1).max(PAY_FROM_MAX),
	amountCents: z.number().int().positive().max(MAX_CENTS),
	expectedOn: daySchema,
};

/** Records pay a Parent has earned that is not in yet. */
export const addPayToCome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema, memberId: ulidSchema, ...details }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const result = await addPayToComeInDb(getDb(), viewerOf(context), {
			id: data.id,
			memberId: data.memberId,
			from: data.from,
			amountCents: data.amountCents as Cents,
			expectedOn: data.expectedOn as DayKey | null,
			recordedOn: dayKeyAt(new Date(), context.household.timeZone),
		});
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});

/** Changes who it is from, the amount or the day it is expected. */
export const changePayToCome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema, ...details }))
	.handler(async ({ data, context }): Promise<PayToComeChanged> => {
		const result = await changePayToComeInDb(getDb(), context.household.id, {
			id: data.id,
			from: data.from,
			amountCents: data.amountCents as Cents,
			expectedOn: data.expectedOn as DayKey | null,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});

export const removePayToCome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const result = await removePayToComeInDb(getDb(), context.household.id, data.id);
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});

/**
 * A Parent says a line of Income is one arriving (all of it, or a part), or that it is not: the
 * answer to "Is this it?", and the undo of an arrival. The Income itself only ever gains whose
 * pay it is, when nobody had said.
 */
export const sayPayToCome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({ id: ulidSchema, incomeId: ulidSchema, is: z.enum(["all", "part", "not-this"]) }),
	)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const pair = { payToComeId: data.id, incomeId: data.incomeId };
		const result =
			data.is === "not-this"
				? await sayNotThisPayInDb(getDb(), context.household.id, pair)
				: await sayPayArrivedInDb(getDb(), context.household.id, {
						...pair,
						all: data.is === "all",
					});
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});
