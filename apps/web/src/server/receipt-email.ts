import type { Db, Viewer } from "@noodle/db";
import { type DayKey, dayKeyAt } from "@noodle/domain";
import PostalMime from "postal-mime";
import { type FiledReceipt, fileReceipt, readReceipt } from "./receipt-ingest";
import type { ReceiptInput, ReceiptReader } from "./receipt-model";
import { idFor } from "./stable-id";

// Forwarded Receipts (ADR-0016): a Parent forwards a receipt email to their Household's Receipt
// address, receipts+<key>@<domain>. Email Routing hands it to the Worker, which checks the key
// and that it came from a Parent's verified address, keeps the email in R2, and puts it on the
// ingest Queue. The Queue's consumer reads it (a PDF attached, else a picture, else the email's
// own text) and files it (receipt-ingest.ts). Nothing here knows the Worker, so tests run it
// with fakes.

/** A forwarded Receipt waiting on the ingest Queue, checked and kept in R2. */
export type ReceiptMessage = {
	kind: "receipt";
	/** Derived from the email's Message-ID, so a redelivered email is the same Receipt. */
	receiptId: string;
	householdId: string;
	/** The Parent who forwarded it. */
	memberId: string;
	/** The email, as received, in R2. */
	fileKey: string;
	received: DayKey;
};

/** The part of an inbound email receiving one reads. */
export type InboundEmail = Pick<
	ForwardableEmailMessage,
	"from" | "to" | "headers" | "raw" | "setReject"
>;

/** What receiving a Receipt's email needs; the Worker passes the real ones, tests fakes. */
export type ReceiveReceiptDeps = {
	findAddress: (key: string) => Promise<{ householdId: string; timeZone: string } | null>;
	/** The Parent of the Household with `email` as a verified address, if any. */
	parentWithEmail: (householdId: string, email: string) => Promise<string | null>;
	store: (key: string, bytes: Uint8Array) => Promise<void>;
	enqueue: (message: ReceiptMessage) => Promise<void>;
	now: Date;
};

/** The key a Receipt address carries: receipts+<key>@…. */
const ADDRESS = /^receipts\+([a-z0-9]+)@/i;

/**
 * Receives one email sent to a Receipt address: it's kept and queued, or rejected back to its
 * sender when the address isn't one in use or it wasn't sent by one of that Household's Parents.
 */
export async function receiveReceiptEmail(
	message: InboundEmail,
	deps: ReceiveReceiptDeps,
): Promise<ReceiptMessage | null> {
	const key = ADDRESS.exec(message.to)?.[1]?.toLowerCase();
	const found = key ? await deps.findAddress(key) : null;
	if (!found) {
		message.setReject("That Receipt address isn’t in use.");
		return null;
	}
	const memberId = await deps.parentWithEmail(found.householdId, message.from.toLowerCase());
	if (!memberId) {
		message.setReject(
			"Only the Household’s Parents can forward Receipts, from a verified address.",
		);
		return null;
	}
	const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
	// Without a Message-ID, the same email sent again is the same bytes.
	const sameEmail = message.headers.get("Message-ID") ?? new TextDecoder().decode(raw);
	const receiptId = await idFor(`${found.householdId}|${sameEmail}`);
	const fileKey = `receipts/${found.householdId}/${receiptId}.eml`;
	await deps.store(fileKey, raw);
	const queued: ReceiptMessage = {
		kind: "receipt",
		receiptId,
		householdId: found.householdId,
		memberId,
		fileKey,
		received: dayKeyAt(deps.now, found.timeZone),
	};
	await deps.enqueue(queued);
	return queued;
}

/** What a Receipt's email is read as, and a picture of it, if that's what it is, for a thumbnail. */
export type EmailReceipt = {
	input: ReceiptInput;
	picture: { bytes: Uint8Array; mimeType: string } | null;
};

/**
 * The Receipt in an email: a PDF attached, else a picture attached, else the email's own text (a
 * store's emailed receipt), from its HTML if that's all it has. Inline pictures (logos) are not
 * the Receipt.
 */
export async function emailReceipt(raw: Uint8Array): Promise<EmailReceipt> {
	const email = await PostalMime.parse(raw);
	const attached = email.attachments.filter(
		(attachment) => !attachment.related && attachment.disposition !== "inline",
	);
	const bytes = (content: ArrayBuffer | Uint8Array | string) =>
		typeof content === "string" ? new TextEncoder().encode(content) : new Uint8Array(content);
	const pdf = attached.find(
		(attachment) =>
			attachment.mimeType === "application/pdf" || /\.pdf$/i.test(attachment.filename ?? ""),
	);
	if (pdf) {
		const name = pdf.filename ?? "receipt.pdf";
		return { input: { kind: "pdf", bytes: bytes(pdf.content), name }, picture: null };
	}
	const image = attached.find((attachment) => attachment.mimeType.startsWith("image/"));
	if (image) {
		const picture = { bytes: bytes(image.content), mimeType: image.mimeType };
		return { input: { kind: "image", ...picture }, picture };
	}
	const text = email.text?.trim() || htmlText(email.html ?? "");
	return { input: { kind: "text", text }, picture: null };
}

/** An HTML email's text, roughly: tags and entities dropped, rows and cells kept apart. */
function htmlText(html: string): string {
	return html
		.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
		.replace(/<\/(tr|p|div|li|h\d)>|<br\s*\/?>/gi, "\n")
		.replace(/<\/t[dh]>/gi, " ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
		.replace(/&dollar;/g, "$")
		.replace(/&[a-z]+;/gi, "")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n")
		.trim();
}

/** What filing a queued Receipt needs; the Worker passes the real ones, tests fakes. */
export type FileReceiptEmailDeps = {
	db: Db;
	reader: ReceiptReader;
	load: (key: string) => Promise<Uint8Array | null>;
	store: (key: string, bytes: Uint8Array) => Promise<void>;
	/** A small picture of a photographed Receipt, as WebP; null when one can't be made. */
	thumbnail: (picture: { bytes: Uint8Array; mimeType: string }) => Promise<Uint8Array | null>;
	newId: () => string;
	categorize?: (viewer: Viewer, transactionId: string) => Promise<unknown>;
};

/**
 * Files a queued Receipt: reads its email from R2, makes a thumbnail of a picture, and has it
 * read and filed. Null when its email is gone.
 */
export async function fileReceiptEmail(
	deps: FileReceiptEmailDeps,
	message: ReceiptMessage,
): Promise<FiledReceipt | null> {
	const { categorize } = deps;
	const raw = await deps.load(message.fileKey);
	if (!raw) return null;
	const viewer = { householdId: message.householdId, memberId: message.memberId };
	const { input, picture } = await emailReceipt(raw);
	let thumbnailKey: string | null = null;
	const thumbnail = picture ? await deps.thumbnail(picture).catch(() => null) : null;
	if (thumbnail) {
		thumbnailKey = `receipts/${message.householdId}/${message.receiptId}-thumb.webp`;
		await deps.store(thumbnailKey, thumbnail);
	}
	const read = await readReceipt(deps, viewer, input, message.received);
	return fileReceipt(
		{
			db: deps.db,
			newId: deps.newId,
			categorize: categorize && ((transactionId) => categorize(viewer, transactionId)),
		},
		viewer,
		{ id: message.receiptId, source: "email", fileKey: message.fileKey, thumbnailKey },
		read,
	);
}
