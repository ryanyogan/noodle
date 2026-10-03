import { describe, expect, it } from "vitest";
import { inviteTiming } from "./invite-timing";

const DAY = 86_400_000;
const sentAt = Date.UTC(2026, 9, 1, 12);
const invite = { sentAt, expiresAt: sentAt + 7 * DAY };

describe("inviteTiming", () => {
	it("says when it was sent and when it runs out, in days", () => {
		expect(inviteTiming(invite, sentAt + 5_000)).toEqual({
			state: "open",
			sent: "sent today",
			expires: "expires in 7 days",
		});
		expect(inviteTiming(invite, sentAt + DAY + 60_000)).toMatchObject({
			sent: "sent yesterday",
			expires: "expires in 6 days",
		});
		expect(inviteTiming(invite, sentAt + 2 * DAY)).toMatchObject({
			sent: "sent 2 days ago",
			expires: "expires in 5 days",
		});
		expect(inviteTiming(invite, sentAt + 6.5 * DAY)).toMatchObject({
			expires: "expires in less than a day",
		});
	});

	it("is expired from its expiry on", () => {
		expect(inviteTiming(invite, sentAt + 7 * DAY)).toEqual({
			state: "expired",
			ranOutAt: sentAt + 7 * DAY,
		});
	});

	it("never expires for an invite from before links", () => {
		expect(inviteTiming({ sentAt, expiresAt: null }, sentAt + 30 * DAY)).toEqual({
			state: "open",
			sent: "sent 30 days ago",
			expires: null,
		});
	});
});
