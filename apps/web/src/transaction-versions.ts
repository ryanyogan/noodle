// Which version of each Transaction this screen last wrote (ADR-0041). The server refuses a change
// made on a version that has since moved on, so two screens never quietly overwrite each other.
// This screen's own writes move the version on too, and several can wait their turn for the same
// Transaction (`reviewWrites`): each one is sent with the version the one before it answered, read
// here at the moment it is sent, not the version on the row it was made from. Pure: no React, no
// queries, so the carry-over is tested on its own (review-stack.test.ts).

/** The server's answer to a Parent's change to a Transaction. */
export type WriteAnswer<Row> =
	| { status: "saved"; version: number | null }
	| { status: "changed-elsewhere"; current: Row | null };

/** Said once when a change was refused because the Transaction had changed on another screen. */
export const CHANGED_ELSEWHERE =
	"This Transaction was changed on another screen. Here’s how it looks now.";

/** A change that was refused: the Transaction had moved on. `current` is how it is now (null: gone). */
export class ChangedElsewhere<Row = unknown> extends Error {
	constructor(
		readonly transactionId: string,
		readonly current: Row | null,
	) {
		super(CHANGED_ELSEWHERE);
		this.name = "ChangedElsewhere";
	}
}

const written = new Map<string, number>();

/**
 * The version to send with a change to `transaction`, asked at the moment it is sent: the newer of
 * the one on the row the Parent was looking at and the one this screen's last write to it answered.
 * Versions only go up, so the newer one is always what this Parent last saw or made.
 */
export const expectedVersionOf = (transaction: { id: string; version: number }) =>
	Math.max(transaction.version, written.get(transaction.id) ?? 0);

/** Remembers the version a write of this screen's left a Transaction at (null: it was deleted). */
export function noteVersion(transactionId: string, version: number | null) {
	if (version === null) written.delete(transactionId);
	else written.set(transactionId, version);
}

type Versioned = { id: string; version: number };

/** The row at the version this screen would send a change to it with now (ADR-0041). */
const asSent = <Row extends Versioned>(row: Row): Row => ({
	...row,
	version: expectedVersionOf(row),
});

/**
 * What the outbox writes down for a change of `kind` (waiting-writes.ts, ADR-0056): what it was asked with, its Transaction at the version this
 * screen would send it with now. This screen's own answered writes move a Transaction's version
 * on and that is remembered only in memory (`written`), so without this an Undo
 * left waiting behind its decision that WAS answered would be sent again on the card's old
 * version and refused as "changed on another screen", when the only screen was this one. It is
 * only ever the version this Parent's own write answered or their screen showed: never one read
 * fresh from the server, so a change another screen made since is still never written over.
 */
export function carryVersions(kind: string, variables: unknown): unknown {
	if (kind === "change") {
		const change = variables as { transaction: Versioned };
		return { ...change, transaction: asSent(change.transaction) };
	}
	if (kind === "decision") {
		const decision = variables as { item: Versioned };
		return { ...decision, item: asSent(decision.item) };
	}
	if (kind === "decisions") {
		return (variables as { item: Versioned }[]).map((decision) => ({
			...decision,
			item: asSent(decision.item),
		}));
	}
	if (kind === "return-to-review") return asSent(variables as Versioned);
	return variables;
}

/**
 * Takes the server's answer to a change: remembers the new version, or throws ChangedElsewhere.
 * A refusal forgets what was remembered rather than catching up to the server, so a change still
 * waiting its turn for the same Transaction is refused too, not sent over the other screen's.
 */
export function settleWrite<Row>(transactionId: string, answer: WriteAnswer<Row>) {
	if (answer.status === "changed-elsewhere") {
		written.delete(transactionId);
		throw new ChangedElsewhere(transactionId, answer.current);
	}
	noteVersion(transactionId, answer.version);
}

/** Whether the version a row now shows is the one this screen's own last write left it at. */
export const isOwnVersion = (transaction: { id: string; version: number }) =>
	written.get(transaction.id) === transaction.version;

/**
 * What an open edit form is keyed by: how many times another screen has changed its Transaction
 * since the form opened. `seen` is what the form last saw; a new version that isn't this screen's
 * own write is another screen's, so the form starts again from the fresh values rather than
 * saving what it showed before over them (ADR-0041).
 */
export type FormSeen = { id: string; version: number; elsewhere: number };
export function formSeen(seen: FormSeen, transaction: { id: string; version: number }): FormSeen {
	if (seen.id !== transaction.id) return { ...transaction, elsewhere: 0 };
	if (seen.version === transaction.version) return seen;
	return {
		id: transaction.id,
		version: transaction.version,
		elsewhere: seen.elsewhere + (isOwnVersion(transaction) ? 0 : 1),
	};
}

/** Forgets every remembered version (tests). */
export const forgetVersions = () => written.clear();

/** "3 were changed elsewhere and left as they are.": what a batch skipped; "" when nothing was. */
export const leftAsTheyAre = (count: number) =>
	count <= 0
		? ""
		: count === 1
			? "1 was changed elsewhere and left as it is."
			: `${count} were changed elsewhere and left as they are.`;
