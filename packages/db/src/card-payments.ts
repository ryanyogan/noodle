import {
	type DayKey,
	daysBetween,
	likelyCardPayment,
	type MonthKey,
	merchantKey,
	readsAsPaymentReceived,
	TRANSFER_WINDOW_DAYS,
} from "@noodle/domain";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./index";
import { type Viewer, visibleTo } from "./privacy";
import { deleteRule, saveRule } from "./rules";
import { accounts, cardPaymentRules, transactions, transfers } from "./schema";
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

/** The card lines a pass may look at: the first 2,000, newest first. */
const PASS_LIMIT = 2000;

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
	const everUnmarked = (id: typeof transactions.id) =>
		sql`exists (select 1 from transfers u where u.household_id = ${householdId}
			and u.removed_at is not null and (u.out_transaction_id = ${id} or u.in_transaction_id = ${id}))`;
	const arrived = await db
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
				sql`not ${everUnmarked(transactions.id)}`,
			),
		)
		.orderBy(sql`${transactions.date} desc`)
		.limit(PASS_LIMIT);
	const payments = arrived.filter(
		(row) => readsAsPaymentReceived(row.note) || readsAsPaymentReceived(row.merchant),
	) as (CardLine & { note: string | null; merchant: string | null })[];
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
					sql`not ${everUnmarked(transactions.id)}`,
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
		.select({ id: accounts.id, name: accounts.name })
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
			.select({ note: transactions.note, amount: transactions.amountCents })
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
	const pattern = merchantKey(line.note ?? "");
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
	if (!pattern) return result;
	if (!input.newId) return { ...result, remembered: pattern };
	// The lines already here that say the same are the same payment, earlier: marked now, not at
	// the next Import, and taken back by the same Undo (undoCardPaymentMarks).
	const others = await markRememberedCardPayments(db, householdId, input.newId, pattern);
	return {
		...result,
		months: [...new Set([...result.months, ...others.months])].sort(),
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
	const [leaving, paysCommitment] = await Promise.all([
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
			.orderBy(sql`${transactions.date} desc`)
			.limit(PASS_LIMIT),
		commitmentPayments(db, householdId),
	]);
	// The longest wording a line has wins, as with a Rule.
	const byLength = [...remembered].sort((a, b) => b.pattern.length - a.pattern.length);
	const rows = leaving
		.filter((out) => !paysCommitment(out))
		.flatMap((out) => {
			const said = ` ${merchantKey(out.note ?? "")} `;
			const rule = byLength.find((candidate) => said.includes(` ${candidate.pattern} `));
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
	return {
		marked: rows.length,
		months: [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort(),
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
 * or not in Noodle at all): the line is filed in `commitmentId`, with every other line of money
 * out still unassigned that says the same, each in its own month's Plan (a month the Commitment
 * isn't in is left alone). A Rule for the wording files later ones. Safe to retry.
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
		? await db
				.select({ id: transactions.id, date: transactions.date, note: transactions.note })
				.from(transactions)
				.where(
					and(
						visibleTo(viewer),
						sql`${transactions.amountCents} > 0`,
						isNull(transactions.bucketId),
						isNull(transactions.commitmentId),
						isNull(transactions.goalId),
					),
				)
				.orderBy(sql`${transactions.date} desc`)
				.limit(PASS_LIMIT)
		: [];
	const byMonth = new Map<string, string[]>([[line.date.slice(0, 7), [line.id]]]);
	for (const other of alike) {
		if (other.id === line.id) continue;
		if (!` ${merchantKey(other.note ?? "")} `.includes(` ${pattern} `)) continue;
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
