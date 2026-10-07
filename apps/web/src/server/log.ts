import { loadLog } from "@noodle/db";
import { type DayKey, dayKeyAt, LOG_ITEM_KINDS, type LogCursor, type LogRow } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";

/** A row of the Log with the day it was made, in the Household's time zone. */
export type DatedLogRow = LogRow & { day: DayKey };

export type LogPageView = { rows: DatedLogRow[]; next: LogCursor | null };

const cursorSchema = z.object({
	at: z.number().int().nonnegative(),
	rank: z.number().int().min(0).max(8),
	id: z.string().min(1).max(64),
});

/**
 * A page of the Household's Log, newest first, as the signed-in Parent may see it: the other
 * Parent's Personal Allowance only as changed, and none of its Rules (ADR-0003, in the read).
 */
export const getLog = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			month: monthKeySchema.optional(),
			who: z.string().min(1).max(64).optional(),
			kind: z.enum(LOG_ITEM_KINDS).optional(),
			after: cursorSchema.optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<LogPageView> => {
		const { household } = context;
		const page = await loadLog(
			getDb(),
			{ householdId: household.id, memberId: context.parent.id },
			{ month: data.month, memberId: data.who, item: data.kind, after: data.after },
		);
		// Days in the Household's time zone, so server and browser render the same dates.
		return {
			rows: page.rows.map((row) => ({
				...row,
				day: dayKeyAt(new Date(row.at), household.timeZone),
			})),
			next: page.next,
		};
	});
