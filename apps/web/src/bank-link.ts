// What Plaid Link's outcomes mean for a Parent, apart from the browser so tests can run it (#71):
// the plain words for an exit with an error (ADR-0018; Plaid's own text is never shown), and
// whether a bank just linked is one the Household has connected already.

/** Where a bank that logs the Parent in on its own page or app (OAuth) sends them back. */
export const BANK_RETURN_PATH = "/bank/return";

/** The error Link hands onExit, as far as it's read here. */
export type LinkError = { error_type?: string | null; error_code?: string | null };

/** The Link events worth a line in the Worker's logs. */
export const LOGGED_LINK_EVENTS = [
	"OPEN",
	"SELECT_INSTITUTION",
	"ERROR",
	"EXIT",
	"HANDOFF",
] as const;
export type LoggedLinkEvent = (typeof LOGGED_LINK_EVENTS)[number];

const LOGIN_REFUSED = new Set([
	"INVALID_CREDENTIALS",
	"INVALID_MFA",
	"INVALID_SEND_METHOD",
	"INSUFFICIENT_CREDENTIALS",
	"MFA_NOT_SUPPORTED",
	"INVALID_UPDATED_USERNAME",
]);
const NOT_OFFERED = new Set([
	"INSTITUTION_NOT_SUPPORTED",
	"INSTITUTION_NO_LONGER_SUPPORTED",
	"INSTITUTION_NOT_ENABLED_IN_ENVIRONMENT",
	"UNAUTHORIZED_INSTITUTION",
	"INSTITUTION_REGISTRATION_REQUIRED",
	"ITEM_NOT_SUPPORTED",
	"PRODUCT_NOT_SUPPORTED",
	"PRODUCTS_NOT_SUPPORTED",
]);
const NOTHING_THERE = new Set(["NO_ACCOUNTS", "NO_AUTH_ACCOUNTS", "NO_LIABILITY_ACCOUNTS"]);
const TOOK_TOO_LONG = new Set([
	"INVALID_LINK_TOKEN",
	"USER_INPUT_TIMEOUT",
	"INCORRECT_OAUTH_NONCE",
	"OAUTH_STATE_ID_ALREADY_PROCESSED",
	"INVALID_OAUTH_STATE_ID",
]);

/** True when Link closed because its link token had expired or been used: a new one will do. */
export const linkTokenExpired = (error: LinkError | null) =>
	error?.error_code === "INVALID_LINK_TOKEN";

/**
 * What to tell a Parent when Link closes with an error, and what they can do next; null when they
 * simply closed it. `reconnecting` is Link in update mode, where a statement fills the gap
 * meanwhile rather than standing in for the bank.
 */
export function linkExitMessage(
	error: LinkError | null,
	institution: string | null,
	reconnecting = false,
): string | null {
	if (!error || (!error.error_type && !error.error_code)) return null;
	const bank = institution?.trim() || "The bank";
	const statement = reconnecting ? "upload a statement for now" : "upload a statement instead";
	const code = error.error_code ?? "";
	if (TOOK_TOO_LONG.has(code)) return "That took too long, so the bank’s window closed. Try again.";
	if (LOGIN_REFUSED.has(code)) {
		return `${bank} didn’t accept that login. Check it and try again, or ${statement}.`;
	}
	if (code === "ITEM_LOCKED") {
		return `${bank} has locked that login. Unlock it with ${bank}, then try again, or ${statement}.`;
	}
	if (code === "USER_SETUP_REQUIRED") {
		return `${bank} needs something from you first. Log in at ${bank} itself, finish what it asks, then try again.`;
	}
	if (code === "ACCESS_NOT_GRANTED") {
		return `${bank} wasn’t allowed to share your accounts. Try again and allow it, or ${statement}.`;
	}
	if (NOTHING_THERE.has(code)) {
		return `${bank} has no checking, savings, card or loan account Noodle can read. You can ${statement}.`;
	}
	if (NOT_OFFERED.has(code)) return `${bank} can’t be connected right now. You can ${statement}.`;
	if (error.error_type === "RATE_LIMIT_EXCEEDED") {
		return `Too many tries just now. Wait a few minutes and try again, or ${statement}.`;
	}
	if (error.error_type === "INSTITUTION_ERROR") {
		return `${bank} didn’t respond. Try again, or ${statement}.`;
	}
	return `Connecting isn’t working right now. Try again in a little while, or ${statement}.`;
}

/** The bank a Parent just linked, as Link's onSuccess names it. */
export type LinkedBank = {
	institutionId: string | null;
	institution: string | null;
	/** The last digits of each account the Parent chose to share. */
	masks: string[];
};

/** A Bank Connection the Household has, with the last digits of its accounts. */
export type KnownBank = {
	connectionId: string;
	institutionId: string | null;
	institution: string | null;
	/** Null when its accounts couldn't be read just now. */
	masks: string[] | null;
};

const named = (name: string | null) => name?.trim().toLowerCase() || null;

/**
 * Whether two links are at the same institution: by Plaid's ID for it when both have one, by name
 * otherwise (Bank Connections made before the ID was kept).
 */
export function sameBank(
	linked: Pick<LinkedBank, "institutionId" | "institution">,
	known: Pick<KnownBank, "institutionId" | "institution">,
): boolean {
	if (linked.institutionId && known.institutionId) {
		return linked.institutionId === known.institutionId;
	}
	const name = named(linked.institution);
	return name !== null && name === named(known.institution);
}

/**
 * The Bank Connection a newly linked bank repeats, if any: the same institution, and every account
 * linked is one that Bank Connection lists already (by last digits). A second login at the same
 * bank with other accounts (the other Parent's own card, say) isn't a duplicate. When the digits
 * can't tell (Link gave none, or the Bank Connection can't be read), the same institution is
 * enough to ask.
 */
export function duplicateOf(linked: LinkedBank, known: KnownBank[]): KnownBank | null {
	return (
		known.find((bank) => {
			if (!sameBank(linked, bank)) return false;
			const masks = bank.masks;
			if (masks === null || linked.masks.length === 0) return true;
			return linked.masks.every((mask) => masks.includes(mask));
		}) ?? null
	);
}

/**
 * How long ago a Bank Connection was last read, as its row says it: "Last updated 2 hours ago".
 * Minutes under an hour, hours under a day, then days.
 */
export function lastUpdatedText(at: number, now: number): string {
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "Last updated just now";
	const [count, unit] =
		minutes < 60
			? [minutes, "minute"]
			: minutes < 24 * 60
				? [Math.floor(minutes / 60), "hour"]
				: [Math.floor(minutes / (24 * 60)), "day"];
	return `Last updated ${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
