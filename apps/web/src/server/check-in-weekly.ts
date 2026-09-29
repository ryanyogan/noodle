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
			await sendEmail(parent.clerkUserId, email).catch((error) => {
				console.error(`Couldn’t email ${parent.id} their Check-in`, error);
			});
		}),
	);
}

/**
 * What sending email needs, all optional: a checkout without them (local dev, E2E) sends none.
 * EMAIL is the `send_email` binding (Cloudflare Email Service), CHECK_IN_EMAIL_FROM an address on
 * a domain onboarded to it, and APP_ORIGIN the app's own address, for links.
 */
type EmailEnv = { EMAIL?: SendEmail; CHECK_IN_EMAIL_FROM?: string; APP_ORIGIN?: string };

const emailEnv = () => env as unknown as EmailEnv;

const appLink = (path: string) => {
	const origin = emailEnv().APP_ORIGIN;
	return origin ? new URL(path, origin).toString() : null;
};

/** Emails a Parent at their primary address in Clerk, once it's verified. */
async function sendEmail(clerkUserId: string, email: CheckInEmail): Promise<void> {
	const { EMAIL, CHECK_IN_EMAIL_FROM } = emailEnv();
	if (!EMAIL || !CHECK_IN_EMAIL_FROM) return;
	const user = await clerkClient().users.getUser(clerkUserId);
	const address = user.primaryEmailAddress;
	if (address?.verification?.status !== "verified") return;
	await EMAIL.send({
		to: address.emailAddress,
		from: { email: CHECK_IN_EMAIL_FROM, name: "Noodle" },
		subject: email.subject,
		text: email.text,
		html: email.html,
	});
}
