import { canAssign, type DayKey, daysBetween, MATCH_WINDOW, type Plan } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Sparkles, Split as SplitIcon, Target } from "lucide-react";
import type { ComponentProps } from "react";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, shortDay } from "../format";
import { useGoals } from "../goals";
import { forLabel, type MemberSummary } from "../members";
import { membersQuery, monthQuery } from "../queries";
import {
	monthOfTransaction,
	type TransactionRow,
	transactionLabel,
	useTransactionChange,
} from "../transactions";
import { transferDetail } from "../transfers";
import { TransactionEditor } from "./transaction-editor";

// One Transaction as a row, the same everywhere it's listed (Transactions, an Account's page, a
// Bucket's page), and the editor a row opens, with its own month's Plan to assign it to.

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

/**
 * Whether the Household brings spending in from any Account (a bank, or statements), so a recent
 * Quick Add may still get a bank copy to Match.
 */
export function useBringsSpendingIn(): boolean {
	return useGoals().accounts.some((a) => a.bankConnectionId !== null || a.lastStatementDate);
}

/**
 * A Quick Add still waiting for its bank copy: unmatched, and recent enough that the copy may yet
 * come in (the Match window), in a Household that brings spending in at all.
 */
export const waitingForBank = (transaction: TransactionRow, today: DayKey, bringsIn: boolean) =>
	bringsIn &&
	transaction.importedFrom === null &&
	transaction.goal === null &&
	transaction.matchedIn === null &&
	transaction.amountCents > 0 &&
	daysBetween(transaction.date, today) <= MATCH_WINDOW.to;

/**
 * One Transaction: what it was, what it's assigned to and who it was For, and its amount. A split
 * one says how many Splits it has and what they're assigned to. A Quick Add says whether it's
 * waiting for its bank copy or Matched with it. Goal spending opens its Goal instead: it only
 * changes there.
 */
export function TransactionItem({
	transaction,
	plan,
	members,
	waiting = false,
	dated = false,
	onEdit,
	className,
	...props
}: Omit<ComponentProps<"li">, "children"> & {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	/** A Quick Add whose bank copy hasn't come in yet (waitingForBank). */
	waiting?: boolean;
	/** Says its day too, for a list that isn't grouped by day. */
	dated?: boolean;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const split = transaction.splits.length > 0;
	const day = dated ? `${shortDay(transaction.date)} · ` : "";
	const assignment = assignmentOf(transaction, plan);
	const title =
		transaction.note ||
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
	// linked as a Refund. Either opens its Transfer and Refund link instead of the editor.
	const { transfer } = transaction;
	const moneyBack = transaction.amountCents < 0;
	const refund = transaction.refundOf !== null;
	// Filed by categorization and not yet looked at: marked, so a Parent can tap to check it.
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
	const rowClassName = cn(
		"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-(--card-pad) py-3.5 text-start",
		"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
		"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
	);
	const pill = "h-4.5 px-1.5 text-[11px]";
	const content = (
		<>
			{transfer ? (
				<Tile aria-hidden="true">
					<ArrowLeftRight className="size-4" />
				</Tile>
			) : split ? (
				<Tile aria-hidden="true">
					<SplitIcon className="size-4" />
				</Tile>
			) : (
				<Tile aria-hidden="true" bucket={assignment.color ?? undefined}>
					{transaction.goal ? <Target /> : monogram(assignment.name)}
				</Tile>
			)}
			<span className="grid min-w-0 gap-0.5">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="truncate text-sm font-medium">{title}</span>
					{transaction.pending ? (
						<Badge aria-hidden="true" dot className={pill}>
							Pending
						</Badge>
					) : null}
					{autoFiled ? (
						<Badge aria-hidden="true" className={pill}>
							<Sparkles />
							Auto
						</Badge>
					) : null}
					{transaction.matchedIn ? (
						<Badge aria-hidden="true" variant="brand" className={pill}>
							Matched
						</Badge>
					) : waiting ? (
						<Badge aria-hidden="true" dot className={pill}>
							Waiting for bank
						</Badge>
					) : null}
				</span>
				<span className="truncate text-[13px] text-muted-foreground">
					{day}
					{detail}
				</span>
			</span>
			<span className="text-sm font-semibold tabular-nums">{amount}</span>
		</>
	);
	return (
		<li data-slot="list-row" className={className} {...props}>
			{transaction.goal ? (
				<Link
					to="/goals/$goalId"
					params={{ goalId: transaction.goal.id }}
					aria-label={`${spokenTitle}, ${amount}, from the ${assignment.name} Goal`}
					className={rowClassName}
				>
					{content}
				</Link>
			) : (
				<button
					type="button"
					aria-label={
						transfer
							? `${spokenTitle}, ${amount}, ${detail.replace(" · ", ", ").replace(" → ", " to ")}`
							: refund
								? `${spokenTitle}, ${amount}, Refund, ${assignment.name}${spokenFrom}`
								: moneyBack
									? `${spokenTitle}, ${amount}, Money back${spokenFrom}`
									: split
										? `${spokenTitle}, ${amount}, ${detail.replace(" · ", ": ")}`
										: `${spokenTitle}, ${amount}, ${assignment.name}${autoFiled ? " (filed automatically)" : ""}, For ${who}${spokenFrom}`
					}
					onClick={() => onEdit(transaction)}
					className={rowClassName}
				>
					{content}
				</button>
			)}
		</li>
	);
}

/**
 * The editor for a Transaction listed outside its month's Transactions page (an Account's or a
 * Bucket's): it offers that month's Buckets and Commitments, read from the month's Plan.
 */
export function EditTransactionSheet({
	transaction,
	today,
	parentId,
	onClose,
}: {
	transaction: TransactionRow | null;
	today: DayKey;
	parentId: string;
	onClose: () => void;
}) {
	const change = useTransactionChange();
	const month = transaction ? monthOfTransaction(transaction) : null;
	const monthData = useQuery({ ...monthQuery(month ?? "1970-01"), enabled: month !== null });
	const members = useQuery(membersQuery()).data ?? [];
	const loaded = monthData.data;
	// The other Parent's Personal Allowance isn't this Parent's to assign to.
	const plan = loaded
		? {
				buckets: loaded.plan.buckets.filter((b) => canAssign(b, parentId)),
				commitments: loaded.plan.commitments,
			}
		: { buckets: [], commitments: [] };
	return (
		<TransactionEditor
			// Opens once its month's Plan is here, so its Buckets are there to choose from.
			transaction={loaded ? transaction : null}
			today={today}
			plan={plan}
			members={members}
			parentId={parentId}
			onClose={onClose}
			onChange={(next) => {
				if (!transaction) return;
				change.mutate({ transaction, label: transactionLabel(transaction), next });
				onClose();
			}}
		/>
	);
}
