import { loadBell, markBellSeen as markBellSeenInDb } from "@noodle/db";
import { type Bell, bell } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { releases } from "../changelog";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";

// The bell (issue 157, ADR-0065): the releases this Parent hasn't seen and the Nudges sent to
// them. Read for the signed-in Parent only, whose member ID comes from their session: a Nudge
// about a Personal Allowance was recorded for its owner alone (ADR-0003). The releases are the
// Changelog's, read when the app was built, so this costs two small reads by the Member.

export const getBell = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<Bell> => {
		const { nudges, seen } = await loadBell(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
		});
		return bell({ seen, releases, nudges, timeZone: context.household.timeZone });
	});

/**
 * This Parent opened the bell: what it showed is read (`Bell.seen`, as it was listed, so a Nudge
 * sent since stays unread). Their other screens are told, so the dot goes there too.
 */
export const markBellSeen = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			nudgesUpTo: z.number().int().min(0),
			release: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.nullable(),
		}),
	)
	.handler(async ({ data, context }) => {
		const latest = releases[0]?.date ?? null;
		await markBellSeenInDb(
			getDb(),
			{ householdId: context.household.id, memberId: context.parent.id },
			{
				// Never past now or the latest release: nothing not yet sent can be read.
				nudgesUpTo: Math.min(data.nudgesUpTo, Date.now()),
				release:
					data.release !== null && latest !== null && data.release > latest ? latest : data.release,
			},
		);
		await notifyHousehold(context.household.id, ["bell"]);
	});
