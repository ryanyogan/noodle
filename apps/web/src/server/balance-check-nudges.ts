import { env } from "cloudflare:workers";
import {
	type Db,
	listBalanceCheckHouseholds,
	loadBalanceChecksDue,
	loadNudgeRecipients,
	markBalanceChecksNudged,
} from "@noodle/db";
import { checkInNudgeTime, dayKeyAt, wantsNudge } from "@noodle/domain";
import { getDb } from "./db";
import { type ScheduledNudge, scheduleBalanceCheckNudges } from "./nudge-content";

// The nightly run's Balance check part (issue 136): when a card kept by hand's statement has
// closed and its balance isn't typed yet, each Parent who wants it gets one Nudge, once per card
// per statement. It goes the way every Nudge goes: the Household Agent holds it until 9 AM (or
// the end of the Parent's quiet hours) and hands it to the Nudge Queue, which sends a Web Push to
// the devices that Parent turned Nudges on for.

/**
 * The Balance check Nudges to send in one Household now, recorded as sent as they're returned:
 * none for a statement whose Nudge went already, whose balance is typed, or that a Parent put
 * away. While no Parent would get one (no device, or the preference off) nothing is recorded,
 * so the statement still Nudges once someone turns them on.
 */
export async function balanceCheckNudgesDue(
	db: Db,
	household: { id: string; timeZone: string },
	now: Date,
): Promise<ScheduledNudge[]> {
	const today = dayKeyAt(now, household.timeZone);
	const due = (await loadBalanceChecksDue(db, household, today)).filter(
		(check) => !check.nudged && !check.putAway,
	);
	if (due.length === 0) return [];
	const recipients = ((await loadNudgeRecipients(db, household.id))?.recipients ?? []).filter(
		({ preferences }) => wantsNudge(preferences, "balance-check"),
	);
	if (recipients.length === 0) return [];
	// Recorded before they're handed over: a run that fails after this sends none, never two.
	const taken = await markBalanceChecksNudged(db, household.id, due, now);
	const statements = due.filter((check) =>
		taken.some((t) => t.accountId === check.accountId && t.day === check.day),
	);
	return scheduleBalanceCheckNudges(
		recipients,
		statements,
		checkInNudgeTime(now, household.timeZone),
	);
}

/** Asks for the statement balances due in every Household. One failing skips only it. */
export async function startBalanceCheckNudges(now: Date): Promise<void> {
	const db = getDb();
	for (const household of await listBalanceCheckHouseholds(db)) {
		try {
			const nudges = await balanceCheckNudgesDue(db, household, now);
			if (nudges.length > 0) {
				await env.HOUSEHOLD_AGENT.getByName(household.id).holdNudges(household.id, nudges);
			}
		} catch (error) {
			console.error(`Couldn’t ask for statement balances in ${household.id}`, error);
		}
	}
}
