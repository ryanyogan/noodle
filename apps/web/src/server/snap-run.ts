import {
	type Db,
	listMembers,
	loadCategorizableBuckets,
	loadReceipt,
	type Viewer,
} from "@noodle/db";
import { type Cents, type DayKey, type MonthKey, spokenAmount } from "@noodle/domain";
import { MAX_PHRASE, NOTHING_SAID, type PhraseReader } from "./phrase-model";
import { type FiledReceipt, fileReceipt, type ReadReceipt, readReceipt } from "./receipt-ingest";
import { NOTHING_READ, type ReceiptReader } from "./receipt-model";

// Snap and speak, from Quick Add. A photo of a paper Receipt is kept in R2 like a forwarded one,
// read by the same model and filed by the same seam (receipt-ingest.ts): attached to the
// Transaction it's for if there is one (a Tap to capture Quick Add, a bank copy), else kept for the
// Parent to check and save as a Quick Add, with its date and the Receipt attached. A phrase said or
// typed ("forty on pizza after hockey") is read by a model into the words that say the amount, a
// Bucket, For and a note; @noodle/domain reads the amount from those words. Either way the Parent
// sees what was read, changes what's wrong, and saves it themselves. Nothing here knows the
// Worker, so tests run it against a test D1 with the fake models.

/** What a Quick Add is filled in with from a Receipt photo or a phrase, for the Parent to check. */
export type CaptureDraft = {
	/** Null when no amount was read: the Parent types it. */
	amountCents: Cents | null;
	/** A Bucket the Parent may assign to, suggested; null when none was. */
	bucketId: string | null;
	forMemberIds: string[];
	note: string;
};

/** A photographed Receipt, read. */
export type SnapResult =
	| {
			kind: "draft";
			receiptId: string;
			/** The day it's dated: its Quick Add's date. */
			date: DayKey;
			draft: CaptureDraft;
			/** How many Buckets its lines are shared across; above one, it can be split later. */
			buckets: number;
	  }
	| {
			/** It's for a Transaction already there, and is attached to it. */
			kind: "attached";
			transaction: { id: string; date: DayKey; amountCents: Cents; note: string | null };
			/** Its Splits were applied to that Transaction on their own. */
			applied: boolean;
			matchedMonths: string[];
	  };

/** A photo of a Receipt, as the Parent's phone took it. */
export type SnappedPhoto = { receiptId: string; bytes: Uint8Array; mimeType: string };

/** What a photo's file is called, by its type. */
const EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

/** The photo types a Receipt can be snapped as: what the model reads. */
export const PHOTO_TYPES = Object.keys(EXTENSIONS);

/** What snapping a Receipt needs; the Worker passes the real ones, tests fakes. */
export type SnapDeps = {
	db: Db;
	reader: ReceiptReader;
	store: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
	/** A small picture of the Receipt, as WebP; null when one can't be made. */
	thumbnail: (picture: { bytes: Uint8Array; mimeType: string }) => Promise<Uint8Array | null>;
	newId: () => string;
};

/**
 * Keeps, reads and files a Receipt the Parent `viewer` photographed on `today`. Idempotent per
 * `photo.receiptId`: sending the same photo again keeps one Receipt. A model that fails reads as
 * nothing, so the photo is still kept and the Parent types the amount.
 */
export async function snapReceipt(
	deps: SnapDeps,
	viewer: Viewer,
	photo: SnappedPhoto,
	today: DayKey,
): Promise<SnapResult> {
	const { db } = deps;
	const folder = `receipts/${viewer.householdId}/${photo.receiptId}`;
	const fileKey = `${folder}.${EXTENSIONS[photo.mimeType] ?? "jpg"}`;
	await deps.store(fileKey, photo.bytes, photo.mimeType);
	const thumbnail = await deps.thumbnail(photo).catch(() => null);
	const thumbnailKey = thumbnail ? `${folder}-thumb.webp` : null;
	if (thumbnail && thumbnailKey) await deps.store(thumbnailKey, thumbnail, "image/webp");
	const reader: ReceiptReader = {
		read: (...args) => deps.reader.read(...args).catch(() => NOTHING_READ),
	};
	const read = await readReceipt(
		{ db, reader },
		viewer,
		{ kind: "image", bytes: photo.bytes, mimeType: photo.mimeType },
		today,
	);
	const filed = await fileReceipt(
		{ db, newId: deps.newId, keepUnmatched: true },
		viewer,
		{ id: photo.receiptId, source: "photo", fileKey, thumbnailKey },
		read,
	);
	return snapResult(db, viewer, photo.receiptId, read, filed);
}

async function snapResult(
	db: Db,
	viewer: Viewer,
	receiptId: string,
	read: ReadReceipt,
	filed: FiledReceipt,
): Promise<SnapResult> {
	const attached = filed.transactionId && (await loadReceipt(db, viewer, filed.transactionId));
	if (attached) {
		const { id, date, amountCents, note } = attached.transaction;
		return {
			kind: "attached",
			transaction: { id, date, amountCents, note },
			applied: filed.applied,
			matchedMonths: filed.matchedMonths,
		};
	}
	// Its likeliest Bucket: the one most of it went on.
	const parts =
		read.proposal?.kind === "parts"
			? read.proposal.parts
			: read.lines
					.filter((line) => line.kind === "item")
					.map((line) => ({ bucketId: line.bucketId, for: line.for, amount: line.amount }));
	const [likeliest] = parts
		.filter((part) => part.bucketId !== null)
		.sort((a, b) => b.amount - a.amount);
	const buckets = new Set(parts.map((part) => part.bucketId).filter((id) => id !== null));
	return {
		kind: "draft",
		receiptId,
		date: read.date,
		draft: {
			amountCents: read.totalCents,
			bucketId: likeliest?.bucketId ?? null,
			forMemberIds: likeliest?.for ?? [],
			note: read.merchant ?? "",
		},
		buckets: read.proposal?.kind === "parts" ? buckets.size : 0,
	};
}

/**
 * Reads what the Parent `viewer` said or typed about something they spent in `month`: the Bucket
 * from those they may assign to in its Plan, For from the Household's Members, and the amount
 * read by the domain from the words the model picked out (or, failing those, the phrase itself).
 */
export async function readPhrase(
	deps: { db: Db; reader: PhraseReader },
	viewer: Viewer,
	phrase: string,
	month: MonthKey,
): Promise<CaptureDraft> {
	const said = phrase.replace(/\s+/g, " ").trim().slice(0, MAX_PHRASE);
	const [buckets, members] = await Promise.all([
		loadCategorizableBuckets(deps.db, viewer, month, month),
		listMembers(deps.db, viewer.householdId),
	]);
	const current = members.filter((member) => !member.removed);
	const reading = await deps.reader
		.read(
			said,
			buckets.map(({ id, name }) => ({ id, name })),
			current.map(({ id, name }) => ({ id, name })),
		)
		.catch(() => NOTHING_SAID);
	return {
		amountCents: spokenAmount(said, reading.amount),
		// Only what was offered: never the other Parent's Personal Allowance.
		bucketId: buckets.find((bucket) => bucket.id === reading.bucketId)?.id ?? null,
		forMemberIds: current.flatMap((member) => (reading.for.includes(member.id) ? member.id : [])),
		note: reading.note ?? "",
	};
}
