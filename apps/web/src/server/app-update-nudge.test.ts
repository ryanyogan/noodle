import type { NudgeRecipient } from "@noodle/db";
import { defaultNudgePreferences } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { appUpdateNudges, buildChanged, QUIET_AFTER_TOLD_MS } from "./app-update-nudge";

const parent = (
	memberId: string,
	quietHours = null as NudgeRecipient["preferences"]["quietHours"],
) =>
	({
		memberId,
		name: memberId,
		preferences: { ...defaultNudgePreferences("America/Chicago"), quietHours },
	}) satisfies NudgeRecipient;

// 15:00 in Chicago.
const now = new Date("2026-10-06T20:00:00Z");
const recipients = [parent("ryan"), parent("cori")];

describe("appUpdateNudges", () => {
	it("says nothing the first time a Household's Agent runs any build", () => {
		expect(appUpdateNudges({ told: undefined, build: "a", recipients, now })).toEqual({
			told: { build: "a", toldAt: null },
			nudges: [],
		});
	});

	it("Nudges each Parent once when the build changed", () => {
		const first = appUpdateNudges({
			told: { build: "a", toldAt: null },
			build: "b",
			recipients,
			now,
		});
		expect(first.told).toEqual({ build: "b", toldAt: now.getTime() });
		expect(first.nudges.map((nudge) => nudge.memberId)).toEqual(["ryan", "cori"]);
		expect(first.nudges[0]?.nudge).toMatchObject({
			kind: "app-update",
			title: "Noodle was updated",
			tag: "app-update",
		});
		expect(first.nudges[0]?.deliverAt).toBe(now.getTime());
		// The same build again: nothing more.
		expect(buildChanged(first.told, "b")).toBe(false);
		expect(appUpdateNudges({ told: first.told, build: "b", recipients, now }).nudges).toEqual([]);
	});

	it("leaves out the Parent whose screen brought the news", () => {
		const { nudges } = appUpdateNudges({
			told: { build: "a", toldAt: null },
			build: "b",
			recipients,
			except: "ryan",
			now,
		});
		expect(nudges.map((nudge) => nudge.memberId)).toEqual(["cori"]);
	});

	it("says nothing for an update within an hour of the last one told, and remembers the build", () => {
		const told = { build: "a", toldAt: now.getTime() - QUIET_AFTER_TOLD_MS + 1 };
		expect(appUpdateNudges({ told, build: "b", recipients, now })).toEqual({
			told: { build: "b", toldAt: told.toldAt },
			nudges: [],
		});
		const later = { build: "b", toldAt: now.getTime() - QUIET_AFTER_TOLD_MS };
		expect(appUpdateNudges({ told: later, build: "c", recipients, now }).nudges).toHaveLength(2);
	});

	it("holds a Parent's Nudge until their quiet hours end", () => {
		// Quiet 14:00 to 16:00 Chicago: 15:00 is inside, so it waits for 16:00 (21:00 UTC).
		const quiet = [parent("ryan", { start: 14 * 60, end: 16 * 60 })];
		const { nudges } = appUpdateNudges({
			told: { build: "a", toldAt: null },
			build: "b",
			recipients: quiet,
			now,
		});
		expect(nudges[0]?.deliverAt).toBe(new Date("2026-10-06T21:00:00Z").getTime());
	});
});
