import { displayMerchant, MONEY_IN_KIND_LABELS, type Plan } from "@noodle/domain";
import { asBucketColor } from "./buckets";
import { formatMoney, shortDay } from "./format";
import { forLabel, type MemberSummary, pickableMembers } from "./members";
import type { MoneyInLine } from "./money-in";
import { owedBackOnRowText } from "./owed-back";
import { forNow } from "./transaction-cells";
import type { TransactionRow } from "./transactions";
import { transferDetail } from "./transfers";

// What one Transaction says in a list, worked out once (issue 99): the Transactions table and the
// short lists on an Account's and a Bucket's page read the same words from here.

/** What a Transaction or Split is assigned to, by name, with its Bucket's colour. */
export function assignmentOf(
	transaction: Pick<TransactionRow, "bucketId" | "commitmentId"> &
		Partial<Pick<TransactionRow, "goal" | "assignedName">>,
	plan: Pick<Plan, "buckets" | "commitments">,
) {
	if (transaction.goal) return { name: transaction.goal.name, color: null };
	if (transaction.bucketId) {
		const bucket = plan.buckets.find((b) => b.id === transaction.bucketId);
		return {
			// Not in this Plan (a row of another month, issue 99): the name read with the row.
			name: bucket?.name ?? transaction.assignedName ?? "An archived Bucket",
			color: bucket ? asBucketColor(bucket.color) : null,
		};
	}
	if (transaction.commitmentId) {
		const commitment = plan.commitments.find((c) => c.id === transaction.commitmentId);
		return {
			name: commitment?.name ?? transaction.assignedName ?? "An ended Commitment",
			color: null,
		};
	}
	return { name: "Unassigned", color: null };
}

/** The For column of a split row whose Splits are For different people: said, not a chip. */
export const FOR_DIFFERS = "Different for each Split";

/**
 * What Pending means, in words: the row's clock says it on hover, the open row and the phone's
 * sheet say it under the Amount (issue 147).
 */
export const PENDING_MEANS =
	"Pending: the bank hasn’t posted it yet, so it may still change or go.";

export type RowView = {
	/** Goal spending opens its Goal; a Transfer and a split have their own tile. */
	kind: "goal" | "transfer" | "split" | "plain";
	/** Its name: the Parent's or the cleaned-up bank wording, else what kind of thing it is. */
	title: string;
	/** Money out as it is; money back and a Refund with a "+" (issue 134). */
	amount: string;
	/** Money came in (money back, a Refund): its amount is drawn in the money-in colour. */
	moneyIn: boolean;
	/** One word where the line isn't plain spending: Transfer, Between us, Refund, Income, Paid back. */
	kindWord: string | null;
	/**
	 * Money into an Account that holds money (issue 152): its kind is all it says where a Bucket
	 * would be, since it is assigned to nothing.
	 */
	kindOnly: boolean;
	/** A paycheck that counts on another day than it landed (ADR-0063): "pay for Oct 1". */
	payFor?: string;
	/**
	 * What was said Owed back on it (ADR-0058): "$300 owed back by Casey". Its amount stays the
	 * whole purchase; this says the part that isn't the Household's spending.
	 */
	owedBack?: string;
	/** Who it was For, a name each (the row's chips): ["Everyone"] for the whole Household. */
	forNames: string[];
	/** The second line of a two-line row: what it's assigned to, who it was For, where it came from. */
	detail: string;
	/**
	 * That line's words either side of who it was For, where it says For at all: a stacked row
	 * draws its For chips between them.
	 */
	aroundFor: { before: string; after: string } | null;
	assignment: ReturnType<typeof assignmentOf>;
	/** A split one's Buckets, Commitments and Goals by name, each once, in the Splits' order. */
	splitNames: string[];
	/** A side of a Transfer: its Accounts without the kind's word ("Checking → Visa", "out of Checking"). */
	route: string;
	/** Where it came from (the Account it was imported from, or "Matched in …"); empty for a Quick Add. */
	source: string;
	/** It waits in Review: the row says "Needs review" where its Bucket would be. */
	needsReview: boolean;
	/** The Assigned to column. */
	assigned: string;
	/** The For column: empty where For doesn't apply (a Transfer, Goal spending, money back). */
	who: string;
	/** The Account column, its last four digits apart so a narrow column never cuts them. */
	accountName: string;
	accountDigits: string;
	/** Everything the row says, for its control's name: "Costco, $84.12, Groceries, For Everyone". */
	label: string;
	pending: boolean;
	/** Filed by categorization and not yet looked at. */
	autoFiled: boolean;
	matched: boolean;
	/** A Quick Add whose bank copy hasn't come in yet. */
	waiting: boolean;
};

/**
 * One Transaction as a row. A split one says how many Splits it has and what they're assigned
 * to; a side of a Transfer, money back and a Refund say so instead of a Bucket. `waiting` is
 * `waitingForBank` for the row.
 */
export function rowView(
	transaction: TransactionRow,
	plan: Pick<Plan, "buckets" | "commitments">,
	members: MemberSummary[],
	waiting = false,
): RowView {
	if (transaction.moneyIn && !transaction.transfer)
		return moneyInView(transaction, transaction.moneyIn);
	const split = transaction.splits.length > 0;
	const assignment = assignmentOf(transaction, plan);
	// A payment to a card says so: the bank's wording for one ("PAYMENT THANK YOU - WEB") cleans up,
	// by rule or by the background naming, to nothing a Parent would know it by ("Thank You",
	// "Online Payment"). Its detail keeps the bank's wording.
	// A name a Parent gave it comes first (issue 141): "Card payment" stands in for the bank's
	// wording, never for theirs.
	const title =
		(transaction.paysCard && !transaction.named ? "Card payment" : null) ||
		// The arriving side of a Transfer kept as money in: its wording as it is, as it was listed.
		(transaction.moneyIn ? transaction.note?.trim() || "Money in" : null) ||
		transaction.merchantName ||
		(transaction.note && displayMerchant(transaction.note)) ||
		(transaction.goal
			? "Goal spending"
			: transaction.commitmentId
				? "Payment"
				: transaction.importedFrom
					? "Imported"
					: "Quick Add");
	// A split one is For whoever its Splits are, when they agree; else it says so in words.
	const forIds = forNow(transaction);
	const who = forIds === null ? FOR_DIFFERS : forLabel(members, forIds);
	const amount =
		transaction.amountCents < 0
			? `+${formatMoney(-transaction.amountCents)}`
			: formatMoney(transaction.amountCents);
	const named = pickableMembers(members, forIds ?? [])
		.filter((member) => (forIds ?? []).includes(member.id))
		.map((member) => member.name);
	// A pending charge may still change, or go, until the bank posts it (and its copy takes its place).
	const spokenTitle = transaction.pending ? `${title} (pending)` : title;
	// Where an imported Transaction came from, or a Quick Add's bank copy, after what it's assigned to.
	const from = transaction.importedFrom
		? ` · ${transaction.importedFrom}`
		: transaction.matchedIn
			? ` · Matched in ${transaction.matchedIn}`
			: "";
	const spokenFrom = transaction.importedFrom
		? `, from ${transaction.importedFrom}`
		: transaction.matchedIn
			? `, Matched in ${transaction.matchedIn}`
			: waiting
				? ", waiting for the bank’s copy"
				: "";
	// A side of a Transfer counts nowhere; so does money back onto a card or loan until it's
	// linked as a Refund.
	const { transfer } = transaction;
	const moneyBack = transaction.amountCents < 0;
	const refund = transaction.refundOf !== null;
	const autoFiled = transaction.autoFiled !== null && !split && !transfer && !refund && !moneyBack;
	const owedBack = owedBackOnRowText(transaction.owedBack);
	const spokenOwed = owedBack ? `, ${owedBack}` : "";
	const detail = transaction.goal
		? `From the ${assignment.name} Goal`
		: transfer
			? transferDetail(transfer)
			: refund
				? `Refund · ${assignment.name}${from}`
				: moneyBack
					? `Money back${from}`
					: split
						? `Split across ${transaction.splits.length} · ${[
								...new Set(transaction.splits.map((s) => assignmentOf(s, plan).name)),
							].join(", ")}${from}`
						: `${assignment.name} · ${who}${from}`;
	const assigned = transaction.goal
		? `${assignment.name} Goal`
		: transfer
			? // Its Accounts, or that it's between the Parents: the Account column names only this side.
				detail
			: refund
				? `Refund · ${assignment.name}`
				: moneyBack
					? "Money back"
					: split
						? // The names when they fit; the cell cuts the rest off.
							`Split · ${[...new Set(transaction.splits.map((s) => assignmentOf(s, plan).name))].join(", ")}`
						: assignment.name;
	const splitNames = [...new Set(transaction.splits.map((s) => assignmentOf(s, plan).name))];
	const account = transaction.importedFrom ?? transaction.matchedIn ?? "Quick Add";
	const [, accountName = account, accountDigits = ""] = /^(.*?)( ••\d{4})$/.exec(account) ?? [];
	const label = transaction.goal
		? `${spokenTitle}, ${amount}, from the ${assignment.name} Goal`
		: transfer
			? `${spokenTitle}, ${amount}, ${detail.replace(" · ", ", ").replace(" → ", " to ")}`
			: refund
				? `${spokenTitle}, ${amount}, Refund, ${assignment.name}${spokenFrom}`
				: moneyBack
					? `${spokenTitle}, ${amount}, Money back${spokenFrom}`
					: split
						? `${spokenTitle}, ${amount}${spokenOwed}, ${detail.replace(" · ", ": ")}, For ${who}`
						: `${spokenTitle}, ${amount}${spokenOwed}, ${assignment.name}${autoFiled ? " (filed automatically)" : ""}, For ${who}${spokenFrom}`;
	return {
		kind: transaction.goal ? "goal" : transfer ? "transfer" : split ? "split" : "plain",
		title,
		amount,
		moneyIn: moneyBack,
		kindWord: transfer
			? MONEY_IN_KIND_LABELS[transfer.reason === "between-us" ? "between-us" : "transfer"]
			: refund
				? MONEY_IN_KIND_LABELS.refund
				: null,
		kindOnly: false,
		...(owedBack ? { owedBack } : {}),
		forNames: (forIds ?? []).length === 0 ? ["Everyone"] : named.length ? named : ["Someone"],
		detail,
		aroundFor:
			transaction.goal || transfer || refund || moneyBack || forIds === null
				? null
				: {
						before: split
							? `Split across ${transaction.splits.length} · ${[
									...new Set(transaction.splits.map((s) => assignmentOf(s, plan).name)),
								].join(", ")}`
							: assignment.name,
						after: from.replace(/^ · /, ""),
					},
		assignment,
		splitNames,
		route: transfer ? detail.replace(/^(Transfer|Between us)( · | |$)/, "") : "",
		source: from.replace(/^ · /, ""),
		needsReview:
			Boolean(transaction.waits) &&
			!transaction.goal &&
			!transfer &&
			!refund &&
			!moneyBack &&
			!split,
		assigned,
		who: transfer || transaction.goal || moneyBack ? "" : who,
		accountName,
		accountDigits,
		label,
		pending: Boolean(transaction.pending),
		autoFiled,
		matched: Boolean(transaction.matchedIn),
		waiting: !transaction.matchedIn && waiting,
	};
}

/**
 * Money into an Account that holds money, as a row (issue 152): its wording or the name a Parent
 * gave it, its amount with a "+", its one-word kind (or that it waits in Review) and where it
 * came into. The arriving side of a Transfer reads as a Transfer's other side does (`rowView`).
 */
function moneyInView(transaction: TransactionRow, line: MoneyInLine): RowView {
	const title = line.note?.trim() || "Money in";
	const amount = `+${formatMoney(line.amount)}`;
	const kind = line.needsReview ? "Needs review" : MONEY_IN_KIND_LABELS[line.kind];
	const account = transaction.importedFrom ?? "Typed in";
	const [, accountName = account, accountDigits = ""] = /^(.*?)( ••\d{4})$/.exec(account) ?? [];
	// A paycheck listed on the day it landed says which pay day it is the pay for, since that is
	// the month it counts in (ADR-0063): "Income · pay for Oct 1 · Checking". Before the Account,
	// which is what a narrow row cuts short.
	const payFor = line.payDay && !line.needsReview ? `pay for ${shortDay(line.payDay)}` : null;
	const source = payFor ? `${payFor} · ${account}` : account;
	return {
		kind: "plain",
		title,
		amount,
		moneyIn: true,
		kindWord: line.needsReview ? null : kind,
		kindOnly: true,
		...(payFor ? { payFor } : {}),
		forNames: [],
		detail: `${kind} · ${source}`,
		aroundFor: null,
		assignment: { name: kind, color: null },
		splitNames: [],
		route: "",
		source,
		needsReview: line.needsReview,
		assigned: kind,
		who: "",
		accountName,
		accountDigits,
		label: `${title}, ${amount}, ${kind}, ${transaction.importedFrom ? `into ${account}` : "typed in"}${payFor ? `, ${payFor}` : ""}`,
		pending: false,
		autoFiled: false,
		matched: false,
		waiting: false,
	};
}
