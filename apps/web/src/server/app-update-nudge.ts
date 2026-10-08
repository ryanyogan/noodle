import type { NudgeRecipient } from "@noodle/db";
import { type BellRelease, nudgeDeliveryTime, releaseUrl, wantsNudge } from "@noodle/domain";
import type { NudgeMessage, ScheduledNudge } from "./nudge-content";

// The Nudge that says the app was updated (issue 140). Pure, so who gets it and when is tested;
// the Household Agent keeps `ToldBuild` in its own storage and holds the Nudges (nudge-agent.ts).
// When the update brought a release the Household wasn't told of, the Nudge names it and leads to
// it in the Changelog (issue 157); the bell lists that release itself, so this Nudge isn't recorded.

/** No Nudge for an update within this long of the last one the Household was told about. */
export const QUIET_AFTER_TOLD_MS = 60 * 60 * 1000;

/**
 * The build a Household's Agent last ran as, when its Parents were last told of an update, and the
 * day of the latest release they were told of (none on a record from before the Changelog).
 */
export type ToldBuild = { build: string; toldAt: number | null; release?: string };

/** The update Nudge: for a `release` the Household wasn't told of, its title and its place in the Changelog. */
export const appUpdateNudge = (release?: BellRelease): NudgeMessage => ({
	kind: "app-update",
	title: release ? `New in Noodle: ${release.title}` : "Noodle was updated",
	body: release ? "See what changed." : "Open Noodle to use the newest version.",
	// One tag for every update: a newer one replaces a Nudge still showing.
	tag: "app-update",
	url: release ? releaseUrl(release.date) : "/month",
});

/** Whether the Agent now runs another build than it remembers: only then is anything read. */
export const buildChanged = (told: ToldBuild | undefined, build: string) => told?.build !== build;

/**
 * What to remember, and whom to Nudge, when a Household's Agent finds itself on `build`. Nothing
 * the first time (a Household that never ran another build wasn't updated), nothing for the same
 * build twice, and nothing within an hour of the last time. The Parent whose screen brought the
 * news (`except`) is told on that screen instead; everyone after their quiet hours. `release` is
 * the Changelog's latest: the Nudge names it when it is newer than the one last told of, and an
 * update that brought no release says only that Noodle was updated, as before. An update that
 * goes untold (the first, or within the hour) leaves its release to be named by the next.
 */
export function appUpdateNudges({
	told,
	build,
	recipients,
	except,
	now,
	release,
}: {
	told: ToldBuild | undefined;
	build: string;
	release?: BellRelease;
	recipients: readonly NudgeRecipient[];
	except?: string;
	now: Date;
}): { told: ToldBuild; nudges: ScheduledNudge[] } {
	// A Household new to Noodle wasn't updated, and has nothing to catch up on in the Changelog.
	if (!told) return { told: { build, toldAt: null, release: release?.date }, nudges: [] };
	if (told.build === build) return { told, nudges: [] };
	if (told.toldAt !== null && now.getTime() - told.toldAt < QUIET_AFTER_TOLD_MS) {
		return { told: { ...told, build }, nudges: [] };
	}
	const isNew =
		release !== undefined && (told.release === undefined || release.date > told.release);
	const nudge = appUpdateNudge(isNew ? release : undefined);
	const nudges = recipients
		.filter(
			({ memberId, preferences }) => memberId !== except && wantsNudge(preferences, "app-update"),
		)
		.map(({ memberId, preferences }) => ({
			memberId,
			nudge,
			deliverAt: nudgeDeliveryTime(now, preferences.quietHours, preferences.timeZone).getTime(),
		}));
	return { told: { build, toldAt: now.getTime(), release: release?.date ?? told.release }, nudges };
}
