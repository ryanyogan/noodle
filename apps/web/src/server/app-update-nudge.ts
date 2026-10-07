import type { NudgeRecipient } from "@noodle/db";
import { nudgeDeliveryTime, wantsNudge } from "@noodle/domain";
import type { NudgeMessage, ScheduledNudge } from "./nudge-content";

// The Nudge that says the app was updated (issue 140). Pure, so who gets it and when is tested;
// the Household Agent keeps `ToldBuild` in its own storage and holds the Nudges (nudge-agent.ts).

/** No Nudge for an update within this long of the last one the Household was told about. */
export const QUIET_AFTER_TOLD_MS = 60 * 60 * 1000;

/** The build a Household's Agent last ran as, and when its Parents were last told of an update. */
export type ToldBuild = { build: string; toldAt: number | null };

export const appUpdateNudge = (): NudgeMessage => ({
	kind: "app-update",
	title: "Noodle was updated",
	body: "Open Noodle to use the newest version.",
	// One tag for every update: a newer one replaces a Nudge still showing.
	tag: "app-update",
	url: "/month",
});

/** Whether the Agent now runs another build than it remembers: only then is anything read. */
export const buildChanged = (told: ToldBuild | undefined, build: string) => told?.build !== build;

/**
 * What to remember, and whom to Nudge, when a Household's Agent finds itself on `build`. Nothing
 * the first time (a Household that never ran another build wasn't updated), nothing for the same
 * build twice, and nothing within an hour of the last time. The Parent whose screen brought the
 * news (`except`) is told on that screen instead; everyone after their quiet hours.
 */
export function appUpdateNudges({
	told,
	build,
	recipients,
	except,
	now,
}: {
	told: ToldBuild | undefined;
	build: string;
	recipients: readonly NudgeRecipient[];
	except?: string;
	now: Date;
}): { told: ToldBuild; nudges: ScheduledNudge[] } {
	if (!told) return { told: { build, toldAt: null }, nudges: [] };
	if (told.build === build) return { told, nudges: [] };
	if (told.toldAt !== null && now.getTime() - told.toldAt < QUIET_AFTER_TOLD_MS) {
		return { told: { build, toldAt: told.toldAt }, nudges: [] };
	}
	const nudges = recipients
		.filter(
			({ memberId, preferences }) => memberId !== except && wantsNudge(preferences, "app-update"),
		)
		.map(({ memberId, preferences }) => ({
			memberId,
			nudge: appUpdateNudge(),
			deliverAt: nudgeDeliveryTime(now, preferences.quietHours, preferences.timeZone).getTime(),
		}));
	return { told: { build, toldAt: now.getTime() }, nudges };
}
