import {
	CARD_PAYMENT_DAYS,
	type DayKey,
	daysBetween,
	likelyCardPayment,
	type MonthKey,
	merchantKey,
	readsAsPaymentReceived,
	TRANSFER_WINDOW_DAYS,
} from "@noodle/domain";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./index";
import { type Viewer, visibleTo } from "./privacy";
import { deleteRule, saveRule } from "./rules";
import { accounts, cardPaymentRules, monthCloses, transactions, transfers } from "./schema";
import { type FiledBefore, fileTransactions, unfileTransactions } from "./transactions";
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
	},
): Promise<MoneyResult & { remembered?: string; also?: string[] }> {
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
	});
	if (!result.ok) return result;
	const pattern = paymentWording(line);
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
			? await markRememberedCardPayments(db, householdId, input.newId, pattern)
			: null;
	// The card's own line for a payment just named, already here: the two become the pair.
	const joined = await joinCardPayments(db, householdId);
	const months = [
		...new Set([...result.months, ...(others?.months ?? []), ...joined.months]),
	].sort();
	if (!pattern) return { ...result, months };
	if (!others) return { ...result, months, remembered: pattern };
	return {
		...result,
		months,
		remembered: pattern,
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
export async function forgetCardPayment(db: Db, householdId: string, pattern: string) {
	await db
		.delete(cardPaymentRules)
		.where(
			and(eq(cardPaymentRules.householdId, householdId), eq(cardPaymentRules.pattern, pattern)),
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
				.where(stillTransferable(householdId, field("outId"), ">")),
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
	  }
	| { ok: false };

/**
 * A payment to a card whose payment IS the spending (kept by hand and paid down by a Commitment,
 * or not in Noodle at all): the line is filed in `commitmentId`, with the other lines of money
 * out still unassigned that say the same, each in its own month's Plan (a month the Commitment
 * isn't in is left alone). Only lines from the payment's own month on, and never one in a month
 * that has ended (Month-close): what an earlier month came to is not changed by an answer about
 * this one. `filed` says how many went in. A Rule for the wording files later ones. Safe to retry.
 */
export async function fileCardPayment(
	db: Db,
	viewer: Viewer,
	input: { transactionId: string; commitmentId: string; ruleId: string },
): Promise<CardPaymentFiling> {
	const { householdId, memberId } = viewer;
	const [line] = await db
		.select({ id: transactions.id, date: transactions.date, note: transactions.note })
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
						.select({ id: transactions.id, date: transactions.date, note: transactions.note })
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
	const byMonth = new Map<string, string[]>([[line.date.slice(0, 7), [line.id]]]);
	for (const other of alike) {
		const month = other.date.slice(0, 7);
		byMonth.set(month, [...(byMonth.get(month) ?? []), other.id]);
	}
	const undo: FiledBefore[] = [];
	const months: string[] = [];
	let filed = 0;
	for (const [month, ids] of byMonth) {
		const result = await fileTransactions(db, viewer, {
			selection: { ids },
			month: month as MonthKey,
			assignment: { commitmentId: input.commitmentId },
		});
		// The line answered must go in; another month's Plan without the Commitment is skipped.
		if (!result.ok) {
			if (ids.includes(line.id)) return { ok: false };
			continue;
		}
		if (ids.includes(line.id) && result.filed + result.already === 0) return { ok: false };
		if (result.filed > 0) months.push(month);
		filed += result.filed;
		undo.push(...result.undo);
	}
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
	return { ok: true, filed, months: months.sort(), undo, ruleId: rule?.ok ? rule.ruleId : null };
}

/** The whole words of `text` that fit in `length`. */
function wordsWithin(text: string, length: number) {
	if (text.length <= length) return text;
	const cut = text.slice(0, length + 1);
	return cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : length).trim();
}

/**
 * Undo for fileCardPayment: each line goes back to where it was (only while nothing else has
 * changed it since), and the Rule for the wording is forgotten.
 */
export async function undoCardPaymentFiling(
	db: Db,
	viewer: Viewer,
	input: { undo: FiledBefore[]; ruleId: string | null },
): Promise<{ restored: number }> {
	const { restored } = await unfileTransactions(db, viewer, input.undo);
	if (input.ruleId) await deleteRule(db, viewer, input.ruleId);
	return { restored };
}
