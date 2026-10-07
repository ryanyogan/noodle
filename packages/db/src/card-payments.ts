import {
	CARD_PAYMENT_DAYS,
	type Cents,
	type DayKey,
	daysBetween,
	likelyCardPayment,
	type MonthKey,
	merchantKey,
	readsAsPaymentReceived,
	TRANSFER_WINDOW_DAYS,
} from "@noodle/domain";
import { and, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { commitmentAdd, commitmentLink, mayPayDown, ownCommitment } from "./commitments";
import { purchaseMayMove } from "./ended-months";
import type { Db } from "./index";
import { cardPaymentForgottenEvents } from "./log-events";
import { changeableBy, type Viewer, visibleTo } from "./privacy";
import { returnToReview } from "./review";
import { deleteRule, ruleSaving, saveRule } from "./rules";
import {
	accounts,
	cardPaymentRules,
	categorizations,
	commitments,
	monthCloses,
	ruleFor,
	rules,
	splits,
	transactions,
	transfers,
} from "./schema";
import {
	commitmentFiling,
	type FiledBefore,
	fileTransactions,
	unfileTransactions,
} from "./transactions";
import {
	commitmentPayments,
	type MoneyResult,
	markTransfer,
	sameAmount,
	stillTransferable,
	transferable,
	transferRow,
} from "./transfers";

// The card's side of a payment (issue 136).
// Money arriving on a credit card whose wording reads as the Household paying it ("PAYMENT THANK
// YOU"; readsAsPaymentReceived in @noodle/domain) is a Transfer, never money back: paired with the
// line that paid it when that is in Noodle, else marked alone. A pair within a few days is found
// by amount first (detectTransfers); this runs after it and takes what's left.
//
// markCardPayments looks at every such line of the Household's, not only an Import's, so the same
// call is the one-time pass over lines that came in before it was built. It only ever adds rows to
// `transfers` (or fills in the paying side of a mark it made itself), so "Unmark" undoes it, and a
// line a Parent unmarked is never marked again: running it twice does nothing.

/**
 * How many lines a pass reads at a time, newest first. It reads every page, keeping only the
 * lines whose wording it is after, so a Household with more lines than one page is done whole.
 * (An object so a test can make the page small.)
 */
export const PASS = { size: 2000 };

/** Every row a query has, read a page at a time in the query's own order; `keep` picks from each page. */
async function everyRow<T>(
	page: (limit: number, offset: number) => Promise<T[]>,
	keep: (row: T) => boolean,
): Promise<T[]> {
	const kept: T[] = [];
	for (let offset = 0; ; offset += PASS.size) {
		const rows = await page(PASS.size, offset);
		kept.push(...rows.filter(keep));
		if (rows.length < PASS.size) return kept;
	}
}

/**
 * The bank's wording for a line, as a remembered card payment goes by it: its note (what the
 * statement said), else its merchant. The one function for remembering a wording
 * (markCardPayment) and for matching later lines against it (markRememberedCardPayments).
 */
export const paymentWording = (line: { note: string | null; merchant: string | null }) =>
	merchantKey(line.note?.trim() || line.merchant?.trim() || "");

/** Raw SQL: the Transaction is a side of a Transfer a Parent unmarked. */
const everUnmarked = (householdId: string, id: typeof transactions.id) =>
	sql`exists (select 1 from transfers u where u.household_id = ${householdId}
		and u.removed_at is not null and (u.out_transaction_id = ${id} or u.in_transaction_id = ${id}))`;

type CardLine = {
	id: string;
	date: DayKey;
	amount: number;
	accountId: string;
	card: string;
	/** The mark this pass made alone earlier, still waiting for its paying side. */
	transferId: string | null;
};

/**
 * Marks the payments arriving on the Household's credit cards as Transfers. The paying side is
 * money out of another Account that isn't a card, for the same amount: within the few days any
 * Transfer may take, or any number of days apart when its own words say it pays a card; the
 * nearest wins, and never a line a Parent unmarked or one a Rule files in a Commitment. Idempotent.
 * Returns how many lines it marked or paired, and their months.
 */
export async function markCardPayments(
	db: Db,
	householdId: string,
	newId: () => string,
): Promise<{ marked: number; months: string[] }> {
	// First the payments a Parent (or a wording they remembered) already named this card for.
	const joined = await joinCardPayments(db, householdId);
	const rest = await markArrived(db, householdId, newId);
	return {
		marked: joined.joined + rest.marked,
		months: [...new Set([...joined.months, ...rest.months])].sort(),
	};
}

/**
 * One payment, one Transfer. A payment out of checking that was marked alone as a Transfer
 * naming a card (by a Parent, or by a wording they remembered) and the same payment arriving on
 * that card are joined into the pair: the mark that names the card takes the card's line as its
 * other side, and a mark Noodle made alone on the card's line gives way to it. Same card, same
 * amount, within CARD_PAYMENT_DAYS, the nearest first; each line joins once, so two payments of
 * one amount stay two. Never a card line a Parent unmarked, or one they marked alone themselves.
 * Without this a card kept by hand had the payment taken off what's owed twice. Idempotent.
 */
export async function joinCardPayments(
	db: Db,
	householdId: string,
): Promise<{ joined: number; months: string[] }> {
	const named = await db
		.select({
			transferId: transfers.id,
			card: transfers.otherAccountId,
			amount: transactions.amountCents,
			date: transactions.date,
		})
		.from(transfers)
		.innerJoin(transactions, eq(transactions.id, transfers.outTransactionId))
		.where(
			and(
				eq(transfers.householdId, householdId),
				isNull(transfers.removedAt),
				isNull(transfers.inTransactionId),
				isNull(transfers.inIncomeId),
				isNotNull(transfers.otherAccountId),
			),
		);
	if (named.length === 0) return { joined: 0, months: [] };
	// One JSON parameter per list: D1 caps a statement's bound parameters at 100.
	const cards = JSON.stringify([...new Set(named.map((row) => row.card))]);
	const amounts = JSON.stringify([...new Set(named.map((row) => -row.amount))]);
	const arrived = (
		await db
			.select({
				id: transactions.id,
				date: transactions.date,
				amount: sql<number>`-${transactions.amountCents}`,
				accountId: transactions.accountId,
				note: transactions.note,
				merchant: transactions.merchant,
				markId: transfers.id,
			})
			.from(transactions)
			.leftJoin(
				transfers,
				and(eq(transfers.inTransactionId, transactions.id), isNull(transfers.removedAt)),
			)
			.where(
				and(
					eq(transactions.householdId, householdId),
					sql`${transactions.accountId} in (select value from json_each(${cards}))`,
					sql`${transactions.amountCents} in (select value from json_each(${amounts}))`,
					// Not marked yet, or marked alone by Noodle itself.
					sql`((${transfers.id} is null and ${transferable})
						or (${transfers.outTransactionId} is null and ${transfers.createdByMemberId} is null
							and ${transfers.reason} is null))`,
					sql`not ${everUnmarked(householdId, transactions.id)}`,
				),
			)
	).filter(
		(row) =>
			row.markId !== null ||
			readsAsPaymentReceived(row.note) ||
			readsAsPaymentReceived(row.merchant),
	);
	const fits = named
		.flatMap((payment) =>
			arrived
				.filter((line) => line.accountId === payment.card && line.amount === payment.amount)
				.map((line) => ({
					payment,
					line,
					days: Math.abs(daysBetween(payment.date as DayKey, line.date as DayKey)),
				}))
				.filter(({ days }) => days <= CARD_PAYMENT_DAYS),
		)
		.sort(
			(a, b) =>
				a.days - b.days ||
				a.payment.date.localeCompare(b.payment.date) ||
				a.payment.transferId.localeCompare(b.payment.transferId),
		);
	const pairs: (typeof fits)[number][] = [];
	const taken = new Set<string>();
	for (const fit of fits) {
		if (taken.has(fit.payment.transferId) || taken.has(fit.line.id)) continue;
		taken.add(fit.payment.transferId).add(fit.line.id);
		pairs.push(fit);
	}
	if (pairs.length === 0) return { joined: 0, months: [] };
	const writes: BatchItem<"sqlite">[] = [];
	for (const { payment, line } of pairs) {
		if (line.markId) {
			// The mark Noodle made on the card's line alone gives way: the pair replaces it.
			writes.push(
				db
					.delete(transfers)
					.where(
						and(
							eq(transfers.id, line.markId),
							eq(transfers.householdId, householdId),
							isNull(transfers.removedAt),
							isNull(transfers.outTransactionId),
							isNull(transfers.createdByMemberId),
						),
					),
			);
		}
		writes.push(
			db
				.update(transfers)
				.set({ inTransactionId: line.id })
				.where(
					and(
						eq(transfers.id, payment.transferId),
						eq(transfers.householdId, householdId),
						isNull(transfers.removedAt),
						isNull(transfers.inTransactionId),
						isNull(transfers.inIncomeId),
						stillTransferable(householdId, sql`${line.id}`, "<"),
						sql`not exists (select 1 from transfers x where x.in_transaction_id = ${line.id} and x.removed_at is null)`,
					),
				),
		);
	}
	await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	const months = pairs.flatMap(({ payment, line }) => [
		payment.date.slice(0, 7),
		line.date.slice(0, 7),
	]);
	return { joined: pairs.length, months: [...new Set(months)].sort() };
}

/** The payments arriving on cards that no mark names yet: paired with their paying line, or marked alone. */
async function markArrived(
	db: Db,
	householdId: string,
	newId: () => string,
): Promise<{ marked: number; months: string[] }> {
	const everUnmarkedHere = (id: typeof transactions.id) => everUnmarked(householdId, id);
	const arrivedPage = (limit: number, offset: number) =>
		db
			.select({
				id: transactions.id,
				date: transactions.date,
				amount: sql<number>`-${transactions.amountCents}`,
				accountId: accounts.id,
				card: accounts.name,
				note: transactions.note,
				merchant: transactions.merchant,
				transferId: transfers.id,
			})
			.from(transactions)
			.innerJoin(accounts, eq(accounts.id, transactions.accountId))
			.leftJoin(
				transfers,
				and(eq(transfers.inTransactionId, transactions.id), isNull(transfers.removedAt)),
			)
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(accounts.kind, "credit-card"),
					sql`${transactions.amountCents} < 0`,
					// Not marked yet, or marked alone by an earlier pass and still without its paying side.
					sql`((${transfers.id} is null and ${transferable})
					or (${transfers.outTransactionId} is null and ${transfers.createdByMemberId} is null
						and ${transfers.reason} is null))`,
					sql`not ${everUnmarkedHere(transactions.id)}`,
				),
			)
			.orderBy(sql`${transactions.date} desc`, transactions.id)
			.limit(limit)
			.offset(offset);
	const payments = (await everyRow(
		arrivedPage,
		(row) => readsAsPaymentReceived(row.note) || readsAsPaymentReceived(row.merchant),
	)) as (CardLine & { note: string | null; merchant: string | null })[];
	if (payments.length === 0) return { marked: 0, months: [] };

	const amounts = JSON.stringify([...new Set(payments.map((payment) => payment.amount))]);
	const [leaving, paysCommitment] = await Promise.all([
		db
			.select({
				id: transactions.id,
				date: transactions.date,
				amount: transactions.amountCents,
				accountId: accounts.id,
				note: transactions.note,
				merchant: transactions.merchant,
			})
			.from(transactions)
			.innerJoin(accounts, eq(accounts.id, transactions.accountId))
			.where(
				and(
					eq(transactions.householdId, householdId),
					inArray(accounts.kind, ["checking", "savings"]),
					transferable,
					sql`${transactions.amountCents} in (select value from json_each(${amounts}))`,
					sql`not ${everUnmarkedHere(transactions.id)}`,
				),
			),
		commitmentPayments(db, householdId),
	]);
	const outs = leaving.filter((out) => !paysCommitment(out));

	// Every paying line a payment could take, the nearest in days first.
	const fits = payments
		.flatMap((payment) =>
			outs
				.filter((out) => out.amount === payment.amount)
				.map((out) => ({
					payment,
					out,
					days: Math.abs(daysBetween(out.date as DayKey, payment.date)),
				}))
				.filter(
					({ out, days }) =>
						days <= TRANSFER_WINDOW_DAYS ||
						[out.note, out.merchant].some(
							(text) =>
								likelyCardPayment({ text, amountCents: out.amount }, [{ name: payment.card }]) !==
								null,
						),
				),
		)
		.sort((a, b) => a.days - b.days || a.out.date.localeCompare(b.out.date));
	const paidBy = new Map<string, (typeof outs)[number]>();
	const taken = new Set<string>();
	for (const { payment, out } of fits) {
		if (paidBy.has(payment.id) || taken.has(out.id)) continue;
		paidBy.set(payment.id, out);
		taken.add(out.id);
	}

	const fresh = payments
		.filter((payment) => payment.transferId === null)
		.map((payment) => ({
			id: newId(),
			outId: paidBy.get(payment.id)?.id ?? null,
			inId: payment.id,
		}));
	const found = payments.filter((payment) => payment.transferId !== null && paidBy.has(payment.id));
	if (fresh.length === 0 && found.length === 0) return { marked: 0, months: [] };

	const field = (name: string) => sql.raw(`json_extract(value, '$.${name}')`);
	const writes: BatchItem<"sqlite">[] = [];
	if (fresh.length > 0) {
		writes.push(
			db
				.insert(transfers)
				.select(
					db
						.select(
							transferRow({
								id: field("id"),
								householdId,
								outId: field("outId"),
								inTransactionId: field("inId"),
								inIncomeId: null,
								createdBy: null,
							}),
						)
						.from(sql`json_each(${JSON.stringify(fresh)})`)
						.where(
							and(
								stillTransferable(householdId, field("inId"), "<"),
								sql`(${field("outId")} is null or (${stillTransferable(householdId, field("outId"), ">")}
									and ${sameAmount(householdId, field("outId"), field("inId"), sql`null`)}))`,
								// A Transfer doesn't count: never a purchase whose money back counted in an
								// ended month (ADR-0058). By UTC's day, as automatic pairing on Import is.
								purchaseMayMove(undefined, field("outId")),
							),
						),
				)
				.onConflictDoNothing(),
		);
	}
	for (const payment of found) {
		const outId = paidBy.get(payment.id)?.id as string;
		// The paying side came in after the card's: the mark made alone becomes the pair.
		writes.push(
			db
				.update(transfers)
				.set({ outTransactionId: outId })
				.where(
					and(
						eq(transfers.id, payment.transferId as string),
						eq(transfers.householdId, householdId),
						isNull(transfers.removedAt),
						isNull(transfers.outTransactionId),
						stillTransferable(householdId, sql`${outId}`, ">"),
						purchaseMayMove(undefined, sql`${outId}`),
						sql`not exists (select 1 from transfers x where x.out_transaction_id = ${outId} and x.removed_at is null)`,
					),
				),
		);
	}
	await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	const marked = [...fresh.map((row) => row.inId), ...found.map((payment) => payment.id)];
	const byId = new Map(payments.map((payment) => [payment.id, payment]));
	const months = marked.flatMap((id) => [
		byId.get(id)?.date.slice(0, 7) ?? "",
		paidBy.get(id)?.date.slice(0, 7) ?? "",
	]);
	return { marked: marked.length, months: [...new Set(months.filter(Boolean))].sort() };
}

// "It's a card payment", remembered per wording (issue 136).
// A Parent says money out is a payment to a card and which card: the line is marked as a Transfer
// naming it (`transfers.other_account_id`, when its other side isn't in Noodle), and its wording
// is remembered in `card_payment_rules`. Later lines with that wording are marked on Import, as
// automatic Transfers a Parent can unmark; a line unmarked is never marked again. A card whose
// payment is its spending (kept by hand, or not in Noodle) is filed in its Commitment instead, and
// remembered by an ordinary Rule.

/** The Household's credit cards in use, by name: the cards "It's a card payment" may name. */
export function loadCreditCards(db: Db, householdId: string) {
	return db
		.select({
			id: accounts.id,
			name: accounts.name,
			purchases: accounts.purchases,
			bankConnectionId: accounts.bankConnectionId,
		})
		.from(accounts)
		.where(
			and(
				eq(accounts.householdId, householdId),
				eq(accounts.kind, "credit-card"),
				isNull(accounts.archivedAt),
			),
		)
		.orderBy(accounts.name);
}

/** The Household's remembered card-payment wordings, with the card each names. */
export function loadCardPaymentRules(db: Db, householdId: string) {
	return db
		.select({
			id: cardPaymentRules.id,
			pattern: cardPaymentRules.pattern,
			accountId: cardPaymentRules.accountId,
			card: accounts.name,
		})
		.from(cardPaymentRules)
		.leftJoin(accounts, eq(accounts.id, cardPaymentRules.accountId))
		.where(eq(cardPaymentRules.householdId, householdId))
		.orderBy(cardPaymentRules.pattern);
}

/**
 * A Parent says money out is a payment to a card: `cardAccountId` is the Household's credit card
 * it pays, or null for a card that isn't in Noodle. Marks it as a Transfer (paired with the card's
 * side when that is here, as markTransfer does), names the card on a side marked alone, and
 * remembers the wording for later Imports. Idempotent per `transferId`.
 */
export async function markCardPayment(
	db: Db,
	viewer: Viewer,
	input: {
		transferId: string;
		transactionId: string;
		cardAccountId: string | null;
		ruleId: string;
		/** Given, the other lines already here with the same wording are marked too, with these IDs. */
		newId?: () => string;
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	},
): Promise<
	MoneyResult & {
		remembered?: string;
		also?: string[];
		/** The card the wording was remembered for before this answer, for its Undo to put back. */
		replaced?: { accountId: string | null };
	}
> {
	const { householdId } = viewer;
	const [[line], cards] = await Promise.all([
		db
			.select({
				note: transactions.note,
				merchant: transactions.merchant,
				amount: transactions.amountCents,
			})
			.from(transactions)
			.where(and(eq(transactions.id, input.transactionId), visibleTo(viewer))),
		input.cardAccountId
			? db
					.select({ id: accounts.id })
					.from(accounts)
					.where(
						and(
							eq(accounts.id, input.cardAccountId),
							eq(accounts.householdId, householdId),
							eq(accounts.kind, "credit-card"),
							isNull(accounts.archivedAt),
						),
					)
			: [],
	]);
	if (!line || line.amount <= 0 || (input.cardAccountId && cards.length === 0)) {
		return { ok: false, reason: "refused" };
	}
	const result = await markTransfer(db, viewer, {
		transferId: input.transferId,
		transactionId: input.transactionId,
		today: input.today,
		cardPayment: { accountId: input.cardAccountId },
	});
	// `month-ended` among them: money back on it counted in a month that has ended.
	if (!result.ok) return result;
	const pattern = paymentWording(line);
	// What the wording was remembered as until now: Undo puts that back, not nothing. A row with
	// this answer's own id is this answer sent again.
	const [earlier] = pattern
		? await db
				.select({ id: cardPaymentRules.id, accountId: cardPaymentRules.accountId })
				.from(cardPaymentRules)
				.where(
					and(eq(cardPaymentRules.householdId, householdId), eq(cardPaymentRules.pattern, pattern)),
				)
		: [];
	const replaced =
		earlier && earlier.id !== input.ruleId ? { accountId: earlier.accountId } : undefined;
	const writes: BatchItem<"sqlite">[] = [
		db
			.update(transfers)
			.set({ otherAccountId: input.cardAccountId })
			.where(
				and(
					eq(transfers.id, input.transferId),
					eq(transfers.householdId, householdId),
					isNull(transfers.removedAt),
					isNull(transfers.inTransactionId),
					isNull(transfers.inIncomeId),
				),
			),
	];
	if (pattern) {
		writes.push(
			db
				.insert(cardPaymentRules)
				.values({
					id: input.ruleId,
					householdId,
					pattern,
					accountId: input.cardAccountId,
					createdByMemberId: viewer.memberId,
				})
				.onConflictDoUpdate({
					target: [cardPaymentRules.householdId, cardPaymentRules.pattern],
					set: { accountId: input.cardAccountId },
				}),
		);
	}
	await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	// The lines already here that say the same are the same payment, earlier: marked now, not at
	// the next Import, and taken back by the same Undo (undoCardPaymentMarks).
	const others =
		pattern && input.newId
			? await markRememberedCardPayments(db, householdId, input.newId, pattern, input.today)
			: null;
	// The card's own line for a payment just named, already here: the two become the pair.
	const joined = await joinCardPayments(db, householdId);
	const months = [
		...new Set([...result.months, ...(others?.months ?? []), ...joined.months]),
	].sort();
	if (!pattern) return { ...result, months };
	if (!others) return { ...result, months, remembered: pattern, replaced };
	return {
		...result,
		months,
		remembered: pattern,
		replaced,
		also: others.transferIds,
	};
}

/**
 * Undo for the other lines an answer marked (markCardPayment's `also`): their marks are taken
 * away whole, not unmarked, so a second answer marks them again. Only marks Noodle made itself,
 * with no other side, that are still there. The line answered is unmarked as any Transfer is.
 */
export async function undoCardPaymentMarks(db: Db, householdId: string, transferIds: string[]) {
	if (transferIds.length === 0) return;
	await db.delete(transfers).where(
		and(
			eq(transfers.householdId, householdId),
			// One JSON parameter for all of them: D1 caps a statement's bound parameters at 100.
			sql`${transfers.id} in (select value from json_each(${JSON.stringify(transferIds)}))`,
			isNull(transfers.createdByMemberId),
			isNull(transfers.removedAt),
			isNull(transfers.inTransactionId),
			isNull(transfers.inIncomeId),
		),
	);
}

/** A wording stops being remembered as a card payment. Transfers already marked stay as they are. */
export async function forgetCardPayment(
	db: Db,
	householdId: string,
	pattern: string,
	memberId?: string,
) {
	await db.batch([
		...cardPaymentForgottenEvents(db, householdId, pattern, memberId),
		db
			.delete(cardPaymentRules)
			.where(
				and(eq(cardPaymentRules.householdId, householdId), eq(cardPaymentRules.pattern, pattern)),
			),
	]);
}

/**
 * Undo for what an answer remembered (markCardPayment's `remembered`): the wording names the card
 * it named before the answer (`replaced`; only ever one of the Household's credit cards, or none),
 * and is forgotten when the answer was the first to remember it.
 */
export async function undoCardPaymentRemembered(
	db: Db,
	householdId: string,
	pattern: string,
	replaced?: { accountId: string | null },
) {
	if (!replaced) return forgetCardPayment(db, householdId, pattern);
	const { accountId } = replaced;
	await db
		.update(cardPaymentRules)
		.set({ accountId })
		.where(
			and(
				eq(cardPaymentRules.householdId, householdId),
				eq(cardPaymentRules.pattern, pattern),
				accountId === null
					? undefined
					: sql`exists (select 1 from ${accounts} where ${accounts.id} = ${accountId}
						and ${accounts.householdId} = ${householdId} and ${accounts.kind} = 'credit-card')`,
			),
		);
}

/**
 * Marks money out whose wording a Parent called a card payment (card_payment_rules) as a Transfer
 * on its own, naming the card. Runs on Import after the pairs are found, so a payment with both
 * sides here is the pair. Never a line a Parent unmarked, or one a Rule files in a Commitment.
 * Idempotent. Returns how many it marked and their months.
 */
export async function markRememberedCardPayments(
	db: Db,
	householdId: string,
	newId: () => string,
	/** Only lines this one remembered wording marks: what an answer just given covers. */
	only?: string,
	/** The Household's day; UTC's when left out. */
	today?: DayKey,
): Promise<{ marked: number; months: string[]; transferIds: string[] }> {
	const remembered = await loadCardPaymentRules(db, householdId);
	if (remembered.length === 0) return { marked: 0, months: [], transferIds: [] };
	// The longest wording a line has wins, as with a Rule.
	const byLength = [...remembered].sort((a, b) => b.pattern.length - a.pattern.length);
	const ruleFor = (out: { note: string | null; merchant: string | null }) => {
		const said = ` ${paymentWording(out)} `;
		return byLength.find((candidate) => said.includes(` ${candidate.pattern} `));
	};
	const leavingPage = (limit: number, offset: number) =>
		db
			.select({
				id: transactions.id,
				date: transactions.date,
				note: transactions.note,
				merchant: transactions.merchant,
			})
			.from(transactions)
			.innerJoin(accounts, eq(accounts.id, transactions.accountId))
			.where(
				and(
					eq(transactions.householdId, householdId),
					inArray(accounts.kind, ["checking", "savings"]),
					transferable,
					sql`${transactions.amountCents} > 0`,
					sql`not exists (select 1 from transfers u where u.household_id = ${householdId}
						and u.removed_at is not null and u.out_transaction_id = ${transactions.id})`,
				),
			)
			.orderBy(sql`${transactions.date} desc`, transactions.id)
			.limit(limit)
			.offset(offset);
	const [leaving, paysCommitment] = await Promise.all([
		everyRow(leavingPage, (out) => ruleFor(out) !== undefined),
		commitmentPayments(db, householdId),
	]);
	const rows = leaving
		.filter((out) => !paysCommitment(out))
		.flatMap((out) => {
			const rule = ruleFor(out);
			return rule && (only === undefined || rule.pattern === only)
				? [{ id: newId(), outId: out.id, card: rule.accountId, date: out.date }]
				: [];
		});
	if (rows.length === 0) return { marked: 0, months: [], transferIds: [] };
	const field = (name: string) => sql.raw(`json_extract(value, '$.${name}')`);
	await db
		.insert(transfers)
		.select(
			db
				.select(
					transferRow({
						id: field("id"),
						householdId,
						outId: field("outId"),
						inTransactionId: null,
						inIncomeId: null,
						createdBy: null,
						otherAccountId: field("card"),
					}),
				)
				.from(sql`json_each(${JSON.stringify(rows)})`)
				.where(
					and(
						stillTransferable(householdId, field("outId"), ">"),
						// Never a purchase whose money back counted in a month that has ended.
						purchaseMayMove(today, field("outId")),
					),
				),
		)
		.onConflictDoNothing();
	// A payment just marked whose card side is already here is the pair, not two marks.
	const joined = await joinCardPayments(db, householdId);
	return {
		marked: rows.length,
		months: [...new Set([...rows.map((row) => row.date.slice(0, 7)), ...joined.months])].sort(),
		transferIds: rows.map((row) => row.id),
	};
}

/** A Rule's target and who it's For, as they were before an answer changed them. */
export type RuleBefore = { bucketId: string | null; commitmentId: string | null; for: string[] };

/** What fileCardPayment did, for its Undo (undoCardPaymentFiling). */
export type CardPaymentFiling =
	| {
			ok: true;
			/** How many lines went into the Commitment: the one answered and those worded like it. */
			filed: number;
			months: string[];
			undo: FiledBefore[];
			/** The Rule that files later payments there; null when the line has no wording to go by. */
			ruleId: string | null;
			/**
			 * Where that Rule filed before this answer changed it (a wording has one Rule, so stating
			 * it again reuses the row): Undo puts this back. Null: the answer stated a new Rule.
			 */
			ruleBefore: RuleBefore | null;
			/** The line answered was left as it is: its month is before `leaveBefore`. */
			stays: boolean;
			/** The month of the line answered. */
			lineMonth: string;
			/** The lines filed that waited in Review until then: Undo makes them wait there again. */
			waited: CardPaymentWaited[];
			/** The first month of the Commitment the answer made (`create`): Undo ends it from there. */
			madeIn?: MonthKey;
	  }
	/**
	 * "not-in-plan": the Commitment isn't in the Plan of the line's month (`lineMonth`).
	 * "month-ended": money back on the line counted in a month that has ended, so it stays where
	 * it is (ADR-0058).
	 */
	| { ok: false; reason?: "not-in-plan" | "month-ended"; lineMonth?: string };

/** The Commitment a "count it as spending" answer makes for the payment: monthly, on these terms. */
export type CardPaymentCommitment = {
	name: string;
	/** Its first month: the payment's own, or the running month when that one has ended. */
	month: MonthKey;
	amountCents: number;
	dueDate: DayKey;
	/** The card it pays down: an Account here that Noodle doesn't follow. Left out: none. */
	paysDown?: string | undefined;
};

/** A line that waited in Review when an answer filed it, with the guess it had there. */
export type CardPaymentWaited = {
	id: string;
	merchant: string;
	method: "rule" | "similar" | "model" | "none" | null;
	bucketId: string | null;
	confidence: number | null;
	reason: string | null;
};

/**
 * A payment to a card whose payment IS the spending (kept by hand and paid down by a Commitment,
 * or not in Noodle at all): the line is filed in `commitmentId`, with the other lines of money
 * out still unassigned that say the same, each in its own month's Plan (a month the Commitment
 * isn't in is left alone). Only lines from the payment's own month on, and never one in a month
 * that has ended (Month-close): what an earlier month came to is not changed by an answer about
 * this one. `filed` says how many went in. A Rule for the wording files later ones. Safe to retry.
 *
 * With `create` the Commitment is made by the answer, and it, what it pays down, the filing and
 * the Rule are one write: all of it lands or none does (fileInNewCommitment).
 */
export async function fileCardPayment(
	db: Db,
	viewer: Viewer,
	input: {
		transactionId: string;
		commitmentId: string;
		ruleId: string;
		/**
		 * Lines in months before this one are left as they are, the line answered among them: for a
		 * Commitment made by the answer, which starts in the running month when the line's has ended.
		 */
		leaveBefore?: MonthKey;
		/** The Household's day; UTC's when left out. */
		today?: DayKey | undefined;
		/** The answer makes the Commitment `commitmentId` too. */
		create?: CardPaymentCommitment | undefined;
	},
): Promise<CardPaymentFiling> {
	const { householdId, memberId } = viewer;
	const read = {
		id: transactions.id,
		date: transactions.date,
		note: transactions.note,
		version: transactions.version,
		bucketId: transactions.bucketId,
		commitmentId: transactions.commitmentId,
	};
	const [line] = await db
		.select(read)
		.from(transactions)
		.where(
			and(
				eq(transactions.id, input.transactionId),
				visibleTo(viewer),
				sql`${transactions.amountCents} > 0`,
			),
		);
	if (!line) return { ok: false };
	// A Rule's pattern is at most 64 long; cut at a word, so it still matches whole words.
	const pattern = wordsWithin(merchantKey(line.note ?? ""), 64);
	const alike = pattern
		? await everyRow(
				(limit, offset) =>
					db
						.select(read)
						.from(transactions)
						.where(
							and(
								visibleTo(viewer),
								sql`${transactions.amountCents} > 0`,
								isNull(transactions.bucketId),
								isNull(transactions.commitmentId),
								isNull(transactions.goalId),
								sql`${transactions.date} >= ${`${line.date.slice(0, 7)}-01`}`,
								sql`not exists (select 1 from ${monthCloses}
									where ${monthCloses.householdId} = ${transactions.householdId}
									and ${monthCloses.month} = substr(${transactions.date}, 1, 7))`,
							),
						)
						.orderBy(sql`${transactions.date} desc`, transactions.id)
						.limit(limit)
						.offset(offset),
				(other) =>
					other.id !== line.id && ` ${merchantKey(other.note ?? "")} `.includes(` ${pattern} `),
			)
		: [];
	const lineMonth = line.date.slice(0, 7);
	const left = (month: string) => input.leaveBefore !== undefined && month < input.leaveBefore;
	const byMonth = new Map<string, string[]>([[lineMonth, [line.id]]]);
	for (const other of alike) {
		const month = other.date.slice(0, 7);
		byMonth.set(month, [...(byMonth.get(month) ?? []), other.id]);
	}
	// Filing takes a line out of Review; what waited there is read first, for the Undo.
	const mayWait = JSON.stringify([line.id, ...alike.map((other) => other.id)]);
	const waiting: CardPaymentWaited[] = await db
		.select({
			id: categorizations.transactionId,
			merchant: categorizations.merchant,
			method: categorizations.method,
			bucketId: categorizations.bucketId,
			confidence: categorizations.confidence,
			reason: categorizations.reason,
		})
		.from(categorizations)
		.where(
			and(
				eq(categorizations.householdId, householdId),
				eq(categorizations.outcome, "review"),
				sql`${categorizations.transactionId} in (select value from json_each(${mayWait}))`,
			),
		);
	// The Rule the Household shares for this wording, if one is stated: saveRule changes that row.
	const [earlier] = pattern
		? await db
				.select({ id: rules.id, bucketId: rules.bucketId, commitmentId: rules.commitmentId })
				.from(rules)
				.where(
					and(
						eq(rules.householdId, householdId),
						eq(rules.pattern, pattern),
						isNull(rules.ownerMemberId),
					),
				)
		: [];
	// One that files here already is this answer sent again: nothing to put back.
	const before =
		earlier && earlier.id !== input.ruleId && earlier.commitmentId !== input.commitmentId
			? {
					bucketId: earlier.bucketId,
					commitmentId: earlier.commitmentId,
					for: (
						await db
							.select({ memberId: ruleFor.memberId })
							.from(ruleFor)
							.where(eq(ruleFor.ruleId, earlier.id))
					).map((row) => row.memberId),
				}
			: null;
	if (input.create) {
		return fileInNewCommitment(db, viewer, {
			...input,
			create: input.create,
			line,
			alike,
			pattern,
			before,
			waiting,
		});
	}
	const undo: FiledBefore[] = [];
	const months: string[] = [];
	let filed = 0;
	for (const [month, ids] of byMonth) {
		if (left(month)) continue;
		const result = await fileTransactions(db, viewer, {
			selection: { ids },
			month: month as MonthKey,
			assignment: { commitmentId: input.commitmentId },
			today: input.today,
		});
		// The line answered must go in; another month's Plan without the Commitment is skipped.
		if (!result.ok) {
			if (!ids.includes(line.id)) continue;
			return result.reason === "not-in-plan"
				? { ok: false, reason: "not-in-plan", lineMonth }
				: { ok: false };
		}
		if (ids.includes(line.id) && result.filed + result.already === 0) {
			// The line answered is one of those File in… leaves where they are; the others like it
			// that it left out (`skipped.monthEnded`) just stay, as in any bulk filing.
			const [stays] = await db
				.select({ id: transactions.id })
				.from(transactions)
				.where(
					and(
						eq(transactions.id, line.id),
						eq(transactions.householdId, householdId),
						sql`not ${purchaseMayMove(input.today)}`,
					),
				);
			return stays ? { ok: false, reason: "month-ended" } : { ok: false };
		}
		if (result.filed > 0) months.push(month);
		filed += result.filed;
		undo.push(...result.undo);
	}
	// Only a line this answer filed from nowhere is put back in Review by its Undo.
	const wasUnassigned = new Set(
		undo
			.filter((entry) => entry.bucketId === null && entry.commitmentId === null)
			.map((entry) => entry.id),
	);
	const rule = pattern
		? await saveRule(db, {
				id: input.ruleId,
				householdId,
				memberId,
				pattern,
				bucketId: null,
				commitmentId: input.commitmentId,
			})
		: null;
	return {
		ok: true,
		filed,
		months: months.sort(),
		undo,
		ruleId: rule?.ok ? rule.ruleId : null,
		ruleBefore: rule?.ok ? before : null,
		stays: left(lineMonth),
		lineMonth,
		waited: waiting.filter((row) => wasUnassigned.has(row.id)),
	};
}

/** How many lines one statement of fileInNewCommitment files. */
const NEW_COMMITMENT_CHUNK = 500;

type PaymentLine = {
	id: string;
	date: string;
	version: number;
	bucketId: string | null;
	commitmentId: string | null;
};

/**
 * fileCardPayment where the answer makes the Commitment (issue 141): the Commitment, what it pays
 * down, the filing of the line and those worded like it, and the Rule go in ONE batch, each
 * statement waiting on the same test, so nothing is half-made. The Commitment is made only while
 * the line answered can still go in it (at the version read here, this Parent's to change, whole,
 * free to move) and, with `paysDown`, while it may pay that Account down; the Rule only once the
 * line is in. When the line's month is before `leaveBefore` the line stays as it is, so only
 * `paysDown` is waited on. Sent again with the same ids it writes nothing and answers the same.
 */
async function fileInNewCommitment(
	db: Db,
	viewer: Viewer,
	input: {
		commitmentId: string;
		ruleId: string;
		leaveBefore?: MonthKey | undefined;
		today?: DayKey | undefined;
		create: CardPaymentCommitment;
		line: PaymentLine;
		alike: PaymentLine[];
		pattern: string;
		before: RuleBefore | null;
		waiting: CardPaymentWaited[];
	},
): Promise<CardPaymentFiling> {
	const { householdId, memberId } = viewer;
	const { commitmentId, create, line } = input;
	const today = input.today ?? (new Date().toISOString().slice(0, 10) as DayKey);
	const lineMonth = line.date.slice(0, 7);
	const left = (month: string) => input.leaveBefore !== undefined && month < input.leaveBefore;
	const stays = left(lineMonth);
	const rows = [line, ...input.alike].filter((row) => !left(row.date.slice(0, 7)));
	const filing = (lines: PaymentLine[]) =>
		commitmentFiling(db, viewer, {
			commitmentId,
			pairs: JSON.stringify(lines.map((row) => [row.id, row.version])),
			today: input.today,
		});
	const lineGoesIn = sql`exists (select 1 from ${transactions} where ${filing([line]).fileable})`;
	const mayLink = create.paysDown
		? mayPayDown({ householdId, accountId: create.paysDown, carriedBalance: false, today })
		: undefined;
	const lineIsIn = sql`exists (select 1 from ${transactions} where ${and(
		eq(transactions.id, line.id),
		eq(transactions.householdId, householdId),
		eq(transactions.commitmentId, commitmentId),
	)})`;
	const chunks: ReturnType<typeof filing>[] = [];
	for (let start = 0; start < rows.length; start += NEW_COMMITMENT_CHUNK) {
		chunks.push(filing(rows.slice(start, start + NEW_COMMITMENT_CHUNK)));
	}
	// The Rule can only file into a Commitment that is there, so with `stays` it waits on that alone.
	const saving = input.pattern
		? ruleSaving(
				db,
				{
					id: input.ruleId,
					householdId,
					memberId,
					pattern: input.pattern,
					bucketId: null,
					commitmentId,
				},
				stays ? undefined : lineIsIn,
			)
		: null;
	const statements: BatchItem<"sqlite">[] = [
		...commitmentAdd(
			db,
			{
				householdId,
				memberId,
				commitmentId,
				name: create.name,
				month: create.month,
				amountCents: create.amountCents as Cents,
				cadence: "monthly",
				dueDate: create.dueDate,
			},
			and(stays ? undefined : lineGoesIn, mayLink) as SQL | undefined,
		),
		...(create.paysDown
			? commitmentLink(db, {
					householdId,
					memberId,
					commitmentId,
					accountId: create.paysDown,
					carriedBalance: false,
					month: create.month,
					today,
				})
			: []),
		...chunks.flatMap((chunk) => [...chunk.statements]),
		...(saving ? [...saving.statements] : []),
	];
	await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

	// What happened, read back.
	const [made] = await db
		.select({ id: commitments.id })
		.from(commitments)
		.where(ownCommitment(householdId, commitmentId));
	const [now] = await db
		.select({
			commitmentId: transactions.commitmentId,
			ended: sql<boolean>`(not ${purchaseMayMove(input.today)})`.mapWith(Boolean),
		})
		.from(transactions)
		.where(and(eq(transactions.id, line.id), eq(transactions.householdId, householdId)));
	if (!made || (!stays && now?.commitmentId !== commitmentId)) {
		return !stays && now?.ended ? { ok: false, reason: "month-ended" } : { ok: false };
	}
	const landed = new Set<string>();
	for (const chunk of chunks) {
		const done = await db.select({ id: transactions.id }).from(transactions).where(chunk.landed);
		for (const row of done) landed.add(row.id);
	}
	const filed = rows.filter((row) => landed.has(row.id));
	const undo: FiledBefore[] = filed.map((row) => ({
		id: row.id,
		bucketId: row.bucketId,
		commitmentId: row.commitmentId,
		version: row.version + 1,
	}));
	const wasUnassigned = new Set(
		filed.filter((row) => row.bucketId === null && row.commitmentId === null).map((row) => row.id),
	);
	const rule = saving ? await saving.saved() : null;
	return {
		ok: true,
		filed: filed.length,
		months: [...new Set(filed.map((row) => row.date.slice(0, 7)))].sort(),
		undo,
		ruleId: rule?.ok ? rule.ruleId : null,
		ruleBefore: rule?.ok ? input.before : null,
		stays,
		lineMonth,
		waited: input.waiting.filter((row) => wasUnassigned.has(row.id)),
		madeIn: create.month,
	};
}

/** The whole words of `text` that fit in `length`. */
function wordsWithin(text: string, length: number) {
	if (text.length <= length) return text;
	const cut = text.slice(0, length + 1);
	return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : length).trim();
}

/**
 * Undo for fileCardPayment: each line goes back to where it was (only while nothing else has
 * changed it since), and the Rule for the wording is as it was: forgotten when the answer stated
 * it, else filing where it did before (`ruleBefore`), For whom it was. An earlier target that has
 * gone since can't be filed into, so the Rule is forgotten then too.
 */
export async function undoCardPaymentFiling(
	db: Db,
	viewer: Viewer,
	input: {
		undo: FiledBefore[];
		ruleId: string | null;
		ruleBefore?: RuleBefore | null;
		/**
		 * The line answered, when it was answered from its card in Review: once unfiled it waits
		 * there again, with the guess it had and For who it was For.
		 */
		review?: CardPaymentReview;
		/**
		 * The lines the answer took out of Review (fileCardPayment's `waited`): each waits there
		 * again once unfiled, with the guess it had. `review` has the last word on its own line.
		 */
		waited?: CardPaymentWaited[];
	},
): Promise<{ restored: number; reviewVersion?: number | null }> {
	const { restored } = await unfileTransactions(db, viewer, input.undo);
	const done =
		input.review === undefined
			? { restored }
			: { restored, reviewVersion: await waitInReviewAgain(db, viewer, input.undo, input.review) };
	const others = (input.waited ?? []).filter((line) => line.id !== input.review?.transactionId);
	// Who each is For stays as it is now (the unfiling has put back a For the filing changed).
	for (let start = 0; start < others.length; start += WAIT_AGAIN_CHUNK) {
		await waitManyInReviewAgain(
			db,
			viewer,
			input.undo,
			others.slice(start, start + WAIT_AGAIN_CHUNK),
		);
	}
	if (!input.ruleId) return done;
	if (input.ruleBefore) {
		const { householdId, memberId } = viewer;
		const [stated] = await db
			.select({ pattern: rules.pattern })
			.from(rules)
			.where(
				and(
					eq(rules.id, input.ruleId),
					eq(rules.householdId, householdId),
					isNull(rules.ownerMemberId),
				),
			);
		const back = stated
			? await saveRule(db, {
					id: input.ruleId,
					householdId,
					memberId,
					pattern: stated.pattern,
					bucketId: input.ruleBefore.bucketId,
					commitmentId: input.ruleBefore.commitmentId,
					forMemberIds: input.ruleBefore.for,
				})
			: null;
		if (!stated || back?.ok) return done;
	}
	await deleteRule(db, viewer, input.ruleId);
	return done;
}

/** The Review card a card payment was answered from: what puts it back there. */
export type CardPaymentReview = {
	transactionId: string;
	merchant: string;
	guess: Parameters<typeof returnToReview>[2]["guess"];
	for: string[];
};

/**
 * Filing took the line out of Review (a Parent had decided it), and unfiling alone leaves it
 * assigned nowhere and waiting nowhere. This puts it back in Review, only when the Undo is what
 * unfiled it: it was unassigned before the answer, is unassigned again, and is one version on
 * from where the filing left it (ADR-0041), now or on an earlier try. Its version afterwards; null when it was left.
 */
async function waitInReviewAgain(
	db: Db,
	viewer: Viewer,
	undo: FiledBefore[],
	review: CardPaymentReview,
): Promise<number | null> {
	const filed = undo.find((entry) => entry.id === review.transactionId);
	if (!filed || filed.bucketId !== null || filed.commitmentId !== null) return null;
	// Another screen's change leaves it at that same version: only an unassigned line is the Undo's.
	const [now] = await db
		.select({ bucketId: transactions.bucketId, commitmentId: transactions.commitmentId })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, review.transactionId),
				eq(transactions.householdId, viewer.householdId),
			),
		);
	if (!now || now.bucketId !== null || now.commitmentId !== null) return null;
	const back = await returnToReview(db, viewer, {
		transactionId: review.transactionId,
		merchant: review.merchant,
		guess: review.guess,
		forMemberIds: review.for,
		expectedVersion: filed.version + 1,
	});
	return back.ok ? back.version : null;
}

/** How many lines one write puts back in Review (undoCardPaymentFiling's `waited` is up to 2,000). */
export const WAIT_AGAIN_CHUNK = 100;

/**
 * waitInReviewAgain for many lines in one write (issue 141): the lines an answer took out of
 * Review wait there again, a chunk at a time, each chunk whole or not at all (one batch, one JSON
 * parameter). The same test as the single one, made by the database on its own rows: the line was
 * unassigned before the answer (`undo`, at the version the filing left it), is unassigned and
 * unsplit now, is one version on (the Undo unfiled it, nothing else touched it), and is this
 * Parent's to change. Its guess is only ever one of the Household's own Buckets. Sent again, the
 * lines are one more version on and nothing is written.
 */
async function waitManyInReviewAgain(
	db: Db,
	viewer: Viewer,
	undo: FiledBefore[],
	lines: CardPaymentWaited[],
) {
	const { householdId, memberId } = viewer;
	const filedAt = new Map(
		undo
			.filter((entry) => entry.bucketId === null && entry.commitmentId === null)
			.map((entry) => [entry.id, entry.version]),
	);
	const rows = lines.flatMap((line) => {
		const version = filedAt.get(line.id);
		if (version === undefined) return [];
		const guessed = line.bucketId !== null;
		return [
			{
				id: line.id,
				version: version + 1,
				merchant: line.merchant,
				bucketId: line.bucketId,
				method: guessed ? line.method : null,
				confidence: guessed ? line.confidence : null,
				reason: guessed ? line.reason : null,
			},
		];
	});
	if (rows.length === 0) return;
	const payload = JSON.stringify(rows);
	const field = (name: string) => sql.raw(`json_extract(j.value, '$.${name}')`);
	// Over `transactions`: what the Undo just unfiled and nothing has touched since.
	const unfiled = and(
		eq(transactions.householdId, householdId),
		changeableBy(viewer),
		isNull(transactions.bucketId),
		isNull(transactions.commitmentId),
		isNull(transactions.goalId),
		sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
	);
	const guess = sql`(select b.id from buckets b where b.id = ${field("bucketId")}
		and b.household_id = ${householdId} and b.owner_member_id is null)`;
	await db.batch([
		db
			.insert(categorizations)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						transactionId: sql<string>`${field("id")}`.as("transaction_id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						memberId: sql<string>`${memberId}`.as("member_id"),
						outcome: sql<"review">`'review'`.as("outcome"),
						method: sql<
							string | null
						>`case when ${guess} is null then null else ${field("method")} end`.as("method"),
						bucketId: sql<string | null>`${guess}`.as("bucket_id"),
						confidence: sql<number | null>`${field("confidence")}`.as("confidence"),
						merchant: sql<string>`${field("merchant")}`.as("merchant"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						reason: sql<string | null>`${field("reason")}`.as("reason"),
						commitmentId: sql<string | null>`null`.as("commitment_id"),
						returnedAt: sql<Date>`(unixepoch() * 1000)`.as("returned_at"),
					})
					.from(sql`json_each(${payload}) j`)
					.where(
						sql`exists (select 1 from ${transactions} where ${and(
							sql`${transactions.id} = ${field("id")}`,
							sql`${transactions.version} = ${field("version")}`,
							unfiled,
						)})`,
					),
			)
			.onConflictDoUpdate({
				target: categorizations.transactionId,
				set: {
					outcome: sql`'review'`,
					method: sql`excluded.method`,
					bucketId: sql`excluded.bucket_id`,
					commitmentId: sql`null`,
					confidence: sql`excluded.confidence`,
					reason: sql`excluded.reason`,
					returnedAt: sql`excluded.returned_at`,
				},
			}),
		// Last: the write before it is guarded by the version this one moves on from.
		db
			.update(transactions)
			.set({ version: sql`${transactions.version} + 1` })
			.where(
				and(
					unfiled,
					sql`${transactions.version} = (select ${field("version")} from json_each(${payload}) j
						where ${field("id")} = ${transactions.id})`,
				),
			),
	]);
}
