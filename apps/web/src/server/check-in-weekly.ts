import { env } from "cloudflare:workers";
import { clerkClient } from "@clerk/tanstack-react-start/server";
import {
	type Db,
	listCheckInHouseholds,
	listParents,
	loadCheckIns,
	loadNudgeRecipients,
} from "@noodle/db";
import {
	type CheckInCard,
	checkInCards,
	checkInNudgeTime,
	checkInWeek,
	type DayKey,
	dayKeyAt,
	isCheckInDay,
	type Weekday,
} from "@noodle/domain";
import { loadCheckInWaiting } from "./check-in";
import { type CheckInEmail, checkInEmail } from "./check-in-email";
import { getDb } from "./db";
import { sendEmail } from "./email/send";
import { scheduleCheckInNudges } from "./nudge-content";

// The nightly run's Check-in part (server.ts runs it after Insights, so it counts what they
// found): on each Household's Check-in day, every Parent who hasn't done this week's gets one
// Nudge, which the Household Agent holds until 9 AM, and an email summary.

/** Starts the Check-in in every Household whose Check-in day it is. One failing skips only it. */
export async function startCheckIns(now: Date): Promise<void> {
	const db = getDb();
	for (const household of await listCheckInHouseholds(db)) {
		const today = dayKeyAt(now, household.timeZone);
		if (!isCheckInDay(today, household.checkInDay)) continue;
		try {
			await startCheckIn(db, household, checkInWeek(today, household.checkInDay), now);
		} catch (error) {
			console.error(`Couldn’t start the Check-in for ${household.id}`, error);
		}
	}
}

async function startCheckIn(
	db: Db,
	household: { id: string; timeZone: string; checkInDay: Weekday },
	week: DayKey,
	now: Date,
) {
	const [parents, done, nudges] = await Promise.all([
		listParents(db, household.id),
		loadCheckIns(db, household.id, week),
		loadNudgeRecipients(db, household.id),
	]);
	const finished = new Set(done.filter((p) => p.completedAt !== null).map((p) => p.memberId));
	const waiting = parents.filter((parent) => !finished.has(parent.id));
	// Read for each Parent, so each Nudge and email has only what they may see (ADR-0003).
	const cards = new Map<string, CheckInCard[]>();
	for (const parent of waiting) {
		cards.set(parent.id, checkInCards(await loadCheckInWaiting(db, household, parent.id, now)));
	}
	const scheduled = scheduleCheckInNudges(
		nudges?.recipients ?? [],
		cards,
		week,
		checkInNudgeTime(now, household.timeZone),
	);
	const took = await env.HOUSEHOLD_AGENT.getByName(household.id).checkIn(
		household.id,
		week,
		scheduled,
	);
	// This week's went out already: a retried run mustn't email twice.
	if (!took) return;
	await Promise.all(
		waiting.map(async (parent) => {
			if (!parent.clerkUserId) return;
			const email = checkInEmail({
				name: parent.name,
				week,
				cards: cards.get(parent.id) ?? [],
				link: appLink("/check-in"),
			});
			await sendCheckInEmail(parent.clerkUserId, email).catch((error) => {
				console.error(`Couldn’t email ${parent.id} their Check-in`, error);
			});
		}),
	);
}

const appLink = (path: string) => {
	const origin = (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN;
	return origin ? new URL(path, origin).toString() : null;
};

/**
 * Emails a Parent at their primary address in Clerk, once it's verified, through the shared
 * sender (server/email/send.ts). Without the `send_email` binding (or EMAIL_FROM) it sends none.
 */
async function sendCheckInEmail(clerkUserId: string, email: CheckInEmail): Promise<void> {
	const user = await clerkClient().users.getUser(clerkUserId);
	const address = user.primaryEmailAddress;
	if (address?.verification?.status !== "verified") return;
	await sendEmail(address.emailAddress, email);
}
