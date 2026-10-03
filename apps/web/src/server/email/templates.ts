// Every email Noodle sends, in one place: a shared layout and one function per email. Pure, so
// each is snapshot-tested (templates.test.ts); server/email/send.ts sends them.
//
// Light and dark safe: no page or card background, and text in the reader's own colour, so mail
// apps that darken messages can't leave dark text on a dark page. Only the button has a fill,
// the brand blue with white text, which reads on either. Muted text is a mid grey that passes on
// white and on black.

export type Email = { subject: string; text: string; html: string };

const BRAND = "#3e63dd";
const MUTED = "#71717a";
const FONT =
	"Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
	);

type Layout = {
	/** The line mail apps show after the subject in the inbox. */
	preview: string;
	heading: string;
	paragraphs: readonly string[];
	button?: { label: string; href: string };
	/** Small print under the button. */
	notes?: readonly string[];
};

/** The HTML every email shares: Noodle's name, a heading, a few lines and one button. */
export function emailHtml({ preview, heading, paragraphs, button, notes = [] }: Layout): string {
	const p = (text: string) =>
		`<p style="margin:0 0 16px;font-size:16px;line-height:24px;">${escapeHtml(text)}</p>`;
	// Small print breaks anywhere, so a long link can't widen the email on a phone.
	const note = (text: string) =>
		`<p style="margin:0 0 12px;font-size:14px;line-height:20px;color:${MUTED};word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(text)}</p>`;
	return [
		"<!doctype html>",
		'<html lang="en"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		'<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
		`<title>${escapeHtml(heading)}</title></head>`,
		`<body style="margin:0;padding:0;font-family:${FONT};">`,
		`<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preview)}</div>`,
		'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:32px 16px;">',
		'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;"><tr><td style="text-align:left;">',
		`<p style="margin:0 0 24px;font-size:15px;font-weight:600;color:${BRAND};">Noodle</p>`,
		`<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;">${escapeHtml(heading)}</h1>`,
		...paragraphs.map((text) => p(text)),
		button
			? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${BRAND};"><a href="${escapeHtml(button.href)}" style="display:inline-block;padding:12px 20px;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(button.label)}</a></td></tr></table>`
			: "",
		...notes.map(note),
		"</td></tr></table>",
		"</td></tr></table>",
		"</body></html>",
	].join("\n");
}

/** What Noodle is, in one line, for people who haven't used it yet. */
export const NOODLE_IN_ONE_LINE =
	"Noodle is a budgeting app for families: you plan the month together and always know what you can spend.";

/**
 * The invite to the other Parent (#60). Only the inviter's name and the Household's name: never
 * amounts or anything else from the Household.
 */
export function inviteEmail(input: {
	inviterName: string;
	householdName: string;
	link: string;
}): Email {
	const { inviterName, householdName, link } = input;
	const heading = `${inviterName} invited you to plan ${householdName}’s money together on Noodle`;
	const expiry = "This link works for 7 days.";
	const ignore = "If you weren’t expecting this, you can ignore this email.";
	return {
		subject: `${inviterName} invited you to ${householdName} on Noodle`,
		text: [
			`${heading}.`,
			"",
			NOODLE_IN_ONE_LINE,
			"",
			`Join ${householdName}: ${link}`,
			"",
			expiry,
			ignore,
		].join("\n"),
		html: emailHtml({
			preview: `Join ${householdName} on Noodle. ${expiry}`,
			heading,
			paragraphs: [NOODLE_IN_ONE_LINE],
			button: { label: `Join ${householdName}`, href: link },
			notes: [expiry, `Or open this link: ${link}`, ignore],
		}),
	};
}
