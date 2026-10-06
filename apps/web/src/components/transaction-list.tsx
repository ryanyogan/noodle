import { canAssign, type DayKey, daysBetween, MATCH_WINDOW, type Plan } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { RowButton } from "@noodle/ui/components/row-button";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, Sparkles, Split as SplitIcon, Target } from "lucide-react";
import type { ComponentProps } from "react";
import { monogram } from "../buckets";
import { shortDay } from "../format";
import { useGoals } from "../goals";
import type { MemberSummary } from "../members";
import { membersQuery, monthQuery } from "../queries";
import { rowView } from "../transaction-row";
import {
	monthOfTransaction,
	type TransactionRow,
	transactionLabel,
	useTransactionChange,
} from "../transactions";
import { WaitingForBankBadge } from "./transaction-columns";
import { TransactionEditor } from "./transaction-editor";

// One Transaction as a row, the same everywhere it's listed (Transactions, an Account's page, a
// Bucket's page), and the editor a row opens, with its own month's Plan to assign it to.

export { assignmentOf } from "../transaction-row";

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
	selected = false,
	checked,
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
	/** Open in the pane beside the list. */
	selected?: boolean;
	/**
	 * While the list is selecting (#97): whether this one is selected. Its button then toggles it
	 * (the caller's `onEdit`) and says so. Left out when the list isn't selecting.
	 */
	checked?: boolean;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const picking = checked !== undefined && !transaction.goal;
	const day = dated ? `${shortDay(transaction.date)} · ` : "";
	const { title, amount, detail, assignment, autoFiled, label, kind } = rowView(
		transaction,
		plan,
		members,
		waiting,
	);
	const split = kind === "split";
	const transfer = kind === "transfer";
	const pill = "h-4.5 px-1.5 text-[11px]";
	const badges = (
		<>
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
				<WaitingForBankBadge />
			) : null}
		</>
	);
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
			{/* The badges follow the title, or start the second line on phones so the title keeps
			    its room (#47): one copy, placed by the grid. */}
			<span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-y-0.5 sm:grid-cols-[minmax(0,max-content)_1fr]">
				<span className="col-span-2 truncate text-sm font-medium sm:col-span-1">{title}</span>
				<span className="peer/badges col-start-1 row-start-2 me-1.5 flex shrink-0 items-center gap-1.5 empty:hidden sm:col-start-2 sm:row-start-1 sm:ms-1.5 sm:me-0">
					{badges}
				</span>
				<span
					className={cn(
						"col-start-2 row-start-2 truncate text-[13px] text-muted-foreground sm:col-span-2 sm:col-start-1",
						// On the narrowest phones badges get the second line and the detail a full third line
						// (320 px); from 390 they share the second line, so a month of rows is shorter (#74).
						"max-[389px]:peer-[:not(:empty)]/badges:col-span-2 max-[389px]:peer-[:not(:empty)]/badges:col-start-1 max-[389px]:peer-[:not(:empty)]/badges:row-start-3",
					)}
				>
					{day}
					{detail}
				</span>
			</span>
			<span className="text-end text-sm font-semibold tabular-nums">{amount}</span>
		</>
	);
	return (
		<li
			data-slot="list-row"
			data-selected={selected || (picking && checked) || undefined}
			className={`${className ?? ""}${picking ? " relative" : ""} data-selected:bg-selected data-selected:shadow-[inset_2px_0_0_var(--color-primary)]`}
			{...props}
		>
			{picking ? (
				<span
					aria-hidden="true"
					data-slot="pick-mark"
					className={`pointer-events-none absolute start-(--card-pad) top-1/2 z-1 grid size-5 -translate-y-1/2 place-items-center rounded-md border ${
						checked
							? "border-primary bg-primary text-primary-foreground"
							: "border-border-strong bg-card"
					}`}
				>
					{checked ? <Check className="size-3.5" /> : null}
				</span>
			) : null}
			{transaction.goal ? (
				<RowButton asChild variant="list">
					<Link to="/goals/$goalId" params={{ goalId: transaction.goal.id }} aria-label={label}>
						{content}
					</Link>
				</RowButton>
			) : (
				<RowButton
					variant="list"
					className={picking ? "ps-12" : undefined}
					aria-pressed={picking ? checked : undefined}
					aria-label={label}
					aria-current={selected ? "true" : undefined}
					onClick={() => onEdit(transaction)}
				>
					{content}
				</RowButton>
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
