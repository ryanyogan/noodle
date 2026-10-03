// What the Household's invite card says about when the invite went out and when it runs out
// (#60): "sent 2 days ago · expires in 5 days", or that it ran out. Pure, so it's unit-tested.

const DAY_MS = 86_400_000;
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

export type InviteTiming =
	| { state: "open"; sent: string; expires: string | null }
	| { state: "expired"; ranOutAt: number };

export function inviteTiming(
	invite: { sentAt: number; expiresAt: number | null },
	now: number,
): InviteTiming {
	if (invite.expiresAt !== null && invite.expiresAt <= now) {
		return { state: "expired", ranOutAt: invite.expiresAt };
	}
	const ago = Math.floor((now - invite.sentAt) / DAY_MS);
	const sent = ago <= 0 ? "sent today" : ago === 1 ? "sent yesterday" : `sent ${days(ago)} ago`;
	if (invite.expiresAt === null) return { state: "open", sent, expires: null };
	const left = invite.expiresAt - now;
	const expires =
		left < DAY_MS ? "expires in less than a day" : `expires in ${days(Math.round(left / DAY_MS))}`;
	return { state: "open", sent, expires };
}
