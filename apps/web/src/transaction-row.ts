import { displayMerchant, type Plan } from "@noodle/domain";
import { asBucketColor } from "./buckets";
import { formatMoney } from "./format";
import { forLabel, type MemberSummary } from "./members";
import type { TransactionRow } from "./transactions";
import { transferDetail } from "./transfers";

// What one Transaction says in a list, worked out once (issue 99): the Transactions table and the
// short lists on an Account's and a Bucket's page read the same words from here.

/** What a Transaction or Split is assigned to, by name, with its Bucket's colour. */
export function assignmentOf(
	transaction: Pick<TransactionRow, "bucketId" | "commitmentId"> &
		Partial<Pick<TransactionRow, "goal">>,
	plan: Pick<Plan, "buckets" | "commitments">,
) {
	if (transaction.goal) return { name: transaction.goal.name, color: null };
	if (transaction.bucketId) {
		const bucket = plan.buckets.find((b) => b.id === transaction.bucketId);
		return {
			name: bucket?.name ?? "An archived Bucket",
			color: bucket ? asBucketColor(bucket.color) : null,
		};
	}
	if (transaction.commitmentId) {
		const commitment = plan.commitments.find((c) => c.id === transaction.commitmentId);
		return { name: commitment?.name ?? "An ended Commitment", color: null };
	}
	return { name: "Unassigned", color: null };
}

export type RowView = {
	/** Goal spending opens its Goal; a Transfer and a split have their own tile. */
	kind: "goal" | "transfer" | "split" | "plain";
	/** Its name: the Parent's or the cleaned-up bank wording, else what kind of thing it is. */
	title: string;
	amount: string;
	/** The second line of a two-line row: what it's assigned to, who it was For, where it came from. */
	detail: string;
	assignment: ReturnType<typeof assignmentOf>;
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
	const split = transaction.splits.length > 0;
	const assignment = assignmentOf(transaction, plan);
	const title =
		transaction.merchantName ||
		(transaction.note && displayMerchant(transaction.note)) ||
		(transaction.goal
			? "Goal spending"
			: transaction.commitmentId
				? "Payment"
				: transaction.importedFrom
					? "Imported"
					: "Quick Add");
	const who = forLabel(members, transaction.for);
	const amount = formatMoney(transaction.amountCents);
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
						? `${spokenTitle}, ${amount}, ${detail.replace(" · ", ": ")}`
						: `${spokenTitle}, ${amount}, ${assignment.name}${autoFiled ? " (filed automatically)" : ""}, For ${who}${spokenFrom}`;
	return {
		kind: transaction.goal ? "goal" : transfer ? "transfer" : split ? "split" : "plain",
		title,
		amount,
		detail,
		assignment,
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
