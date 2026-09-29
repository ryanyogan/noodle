import {
	addMonths,
	canAssign,
	type DayKey,
	type MonthKey,
	monthKeyAt,
	type Plan,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List, ListGroupLabel } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useHydrated, useNavigate } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight, ReceiptText, Split as SplitIcon, Target } from "lucide-react";
import { type ComponentProps, useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { asBucketColor, monogram } from "../../../buckets";
import { NativeSelect } from "../../../components/native-select";
import { TransactionEditor } from "../../../components/transaction-editor";
import { dayName, formatMoney, monthName } from "../../../format";
import { forLabel, type MemberSummary, pickableMembers } from "../../../members";
import { membersQuery, monthQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";
import { ulidSchema } from "../../../server/schemas";
import { forFilterSchema } from "../../../server/transactions";
import {
	type TransactionRow,
	transactionLabel,
	transactionsQuery,
	useTransactionChange,
} from "../../../transactions";

export const Route = createFileRoute("/_authed/_household/transactions/$month")({
	validateSearch: z.object({
		bucket: ulidSchema.optional().catch(undefined),
		for: forFilterSchema.optional().catch(undefined),
	}),
	beforeLoad: ({ params, context }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		// Months after this one have nothing in them yet.
		const current = monthKeyAt(new Date(), context.household.timeZone);
		if (params.month > current) throw notFound();
		return { month: params.month as MonthKey, current };
	},
	loaderDeps: ({ search }) => ({ bucket: search.bucket, for: search.for }),
	// The first page is rendered on the server; later pages load as the Parent scrolls.
	loader: ({ context, deps }) =>
		Promise.all([
			context.queryClient.ensureQueryData(monthQuery(context.month)),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureInfiniteQueryData(transactionsQuery(context.month, deps)),
		]),
	component: TransactionsPage,
});

function TransactionsPage() {
	const { month, current, parentId } = Route.useRouteContext();
	const filters = Route.useLoaderDeps();
	const navigate = useNavigate({ from: Route.fullPath });
	const data = useSuspenseQuery(monthQuery(month)).data;
	const { asOf } = data;
	// The other Parent's Personal Allowance isn't this Parent's to filter by or assign to (its
	// Transactions never reach them).
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	const members = useSuspenseQuery(membersQuery()).data;
	const [editing, setEditing] = useState<TransactionRow | null>(null);
	const change = useTransactionChange();
	const sameYear = month.slice(0, 4) === current.slice(0, 4);
	const filtered = filters.bucket !== undefined || filters.for !== undefined;

	return (
		<>
			<PageHeader
				className="max-w-2xl"
				eyebrow="Transactions"
				title={sameYear ? monthName(month) : `${monthName(month)} ${month.slice(0, 4)}`}
				actions={
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="icon" asChild>
							<Link
								to="/transactions/$month"
								params={{ month: addMonths(month, -1) }}
								search={true}
								aria-label="Previous month"
							>
								<ChevronLeft className="size-5" />
							</Link>
						</Button>
						{month < current ? (
							<Button variant="ghost" size="icon" asChild>
								<Link
									to="/transactions/$month"
									params={{ month: addMonths(month, 1) }}
									search={true}
									aria-label="Next month"
								>
									<ChevronRight className="size-5" />
								</Link>
							</Button>
						) : (
							<Button variant="ghost" size="icon" disabled aria-label="Next month">
								<ChevronRight className="size-5" />
							</Button>
						)}
					</div>
				}
			/>
			<div className="grid max-w-2xl gap-4">
				<Filters
					plan={plan}
					members={members}
					filters={filters}
					onChange={(next) =>
						void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
					}
				/>
				<TransactionList
					month={month}
					filters={filters}
					today={asOf}
					plan={plan}
					members={members}
					filtered={filtered}
					onEdit={setEditing}
				/>
			</div>
			<TransactionEditor
				transaction={editing}
				today={asOf}
				plan={plan}
				members={members}
				parentId={parentId}
				onClose={() => setEditing(null)}
				onChange={(next) => {
					if (!editing) return;
					change.mutate({ transaction: editing, label: transactionLabel(editing), next });
					setEditing(null);
				}}
			/>
		</>
	);
}

type Filters = { bucket?: string; for?: string };

/** Narrows the list to one Bucket and to spending For one Member (or the whole Household). */
function Filters({
	plan,
	members,
	filters,
	onChange,
}: {
	plan: Pick<Plan, "buckets">;
	members: MemberSummary[];
	filters: Filters;
	onChange: (filters: Filters) => void;
}) {
	// Until hydrated, a change would only move the select, not the list.
	const hydrated = useHydrated();
	return (
		<div className="grid grid-cols-2 gap-2 sm:flex">
			<div className="grid gap-1 sm:w-48">
				<label htmlFor="filter-bucket" className="text-xs font-medium text-muted-foreground">
					Bucket
				</label>
				<NativeSelect
					id="filter-bucket"
					value={filters.bucket ?? ""}
					disabled={!hydrated}
					onChange={(event) => onChange({ bucket: event.currentTarget.value || undefined })}
				>
					<option value="">All Buckets</option>
					{plan.buckets.map((bucket) => (
						<option key={bucket.id} value={bucket.id}>
							{bucket.name}
						</option>
					))}
				</NativeSelect>
			</div>
			<div className="grid gap-1 sm:w-48">
				<label htmlFor="filter-for" className="text-xs font-medium text-muted-foreground">
					For
				</label>
				<NativeSelect
					id="filter-for"
					value={filters.for ?? ""}
					disabled={!hydrated}
					onChange={(event) => onChange({ for: event.currentTarget.value || undefined })}
				>
					<option value="">Anyone</option>
					<option value="everyone">Everyone (shared)</option>
					{pickableMembers(members, filters.for ? [filters.for] : []).map((member) => (
						<option key={member.id} value={member.id}>
							{member.name}
						</option>
					))}
				</NativeSelect>
			</div>
		</div>
	);
}

type Item =
	| { kind: "day"; day: DayKey }
	| { kind: "transaction"; transaction: TransactionRow }
	| { kind: "more" };

/** The loaded Transactions as the list shows them: each day's label, then its Transactions. */
function itemsOf(transactions: TransactionRow[], more: boolean): Item[] {
	const items: Item[] = [];
	let day: DayKey | null = null;
	for (const transaction of transactions) {
		if (transaction.date !== day) {
			day = transaction.date;
			items.push({ kind: "day", day });
		}
		items.push({ kind: "transaction", transaction });
	}
	if (more) items.push({ kind: "more" });
	return items;
}

const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * The month's Transactions, newest first, grouped by day. Only the rows near the screen are
 * rendered (the page scrolls, not the list), so thousands of rows stay fast; reaching the end
 * loads the next page.
 */
function TransactionList({
	month,
	filters,
	today,
	plan,
	members,
	filtered,
	onEdit,
}: {
	month: MonthKey;
	filters: Filters;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	filtered: boolean;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(
		transactionsQuery(month, filters),
	);
	const transactions = data.pages.flatMap((page) => page.transactions);
	const items = itemsOf(transactions, hasNextPage);
	const list = useRef<HTMLUListElement>(null);
	// Where the list starts on the page; 0 until measured, as on the server.
	const [scrollMargin, setScrollMargin] = useState(0);
	useIsomorphicLayoutEffect(() => {
		const measure = () => {
			if (list.current) {
				setScrollMargin(list.current.getBoundingClientRect().top + window.scrollY);
			}
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, []);
	const virtualizer = useWindowVirtualizer({
		count: items.length,
		estimateSize: (index) => (items[index]?.kind === "day" ? 32 : 65),
		getItemKey: (index) => {
			const item = items[index];
			return item?.kind === "day"
				? `day-${item.day}`
				: item?.kind === "transaction"
					? item.transaction.id
					: "more";
		},
		overscan: 8,
		scrollMargin,
		// The server has no window: render the rows a tall phone screen would show.
		initialRect: { width: 0, height: 1000 },
	});
	const virtualItems = virtualizer.getVirtualItems();
	const lastIndex = virtualItems.at(-1)?.index ?? 0;

	useEffect(() => {
		if (lastIndex >= items.length - 1 && hasNextPage && !isFetchingNextPage) {
			void fetchNextPage();
		}
	}, [lastIndex, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

	if (transactions.length === 0) {
		return (
			<EmptyState
				icon={<ReceiptText />}
				title={filtered ? "Nothing matches" : `No Transactions in ${monthName(month)}`}
				description={
					filtered
						? "No Transactions this month match these filters."
						: "Quick Adds and imported spending show up here."
				}
			/>
		);
	}

	return (
		<List
			ref={list}
			aria-label={`Transactions in ${monthName(month)}`}
			className="relative"
			style={{ height: virtualizer.getTotalSize() }}
		>
			{virtualItems.map((virtual) => {
				const item = items[virtual.index];
				if (!item) return null;
				const position = {
					ref: virtualizer.measureElement,
					"data-index": virtual.index,
					className: "absolute inset-x-0 top-0",
					style: { transform: `translateY(${virtual.start - scrollMargin}px)` },
				};
				if (item.kind === "day") {
					return (
						<ListGroupLabel key={virtual.key} {...position}>
							{dayName(item.day, today)}
						</ListGroupLabel>
					);
				}
				if (item.kind === "more") {
					return (
						<li key={virtual.key} {...position} aria-hidden="true">
							<div className="flex items-center gap-3 px-(--card-pad) py-3.5">
								<Skeleton className="size-9 rounded-xl" />
								<div className="grid flex-1 gap-2">
									<Skeleton className="h-3.5 w-1/3" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
						</li>
					);
				}
				return (
					<TransactionItem
						key={virtual.key}
						{...position}
						transaction={item.transaction}
						plan={plan}
						members={members}
						onEdit={onEdit}
					/>
				);
			})}
		</List>
	);
}

/** What a Transaction or Split is assigned to, by name, with its Bucket's colour. */
function assignmentOf(
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
 * One Transaction: what it was, what it's assigned to and who it was For, and its amount. A split
 * one says how many Splits it has and what they're assigned to. Goal spending opens its Goal
 * instead: it only changes there.
 */
function TransactionItem({
	transaction,
	plan,
	members,
	onEdit,
	className,
	...props
}: Omit<ComponentProps<"li">, "children"> & {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	onEdit: (transaction: TransactionRow) => void;
}) {
	const split = transaction.splits.length > 0;
	const assignment = assignmentOf(transaction, plan);
	const title =
		transaction.note ||
		(transaction.goal ? "Goal spending" : transaction.commitmentId ? "Payment" : "Quick Add");
	const who = forLabel(members, transaction.for);
	const amount = formatMoney(transaction.amountCents);
	const detail = transaction.goal
		? `From the ${assignment.name} Goal`
		: split
			? `Split across ${transaction.splits.length} · ${[
					...new Set(transaction.splits.map((s) => assignmentOf(s, plan).name)),
				].join(", ")}`
			: `${assignment.name} · ${who}`;
	const rowClassName = cn(
		"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-(--card-pad) py-3.5 text-start",
		"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
		"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
	);
	const content = (
		<>
			{split ? (
				<Tile aria-hidden="true">
					<SplitIcon className="size-4" />
				</Tile>
			) : (
				<Tile aria-hidden="true" bucket={assignment.color ?? undefined}>
					{transaction.goal ? <Target /> : monogram(assignment.name)}
				</Tile>
			)}
			<span className="grid min-w-0 gap-0.5">
				<span className="truncate text-sm font-medium">{title}</span>
				<span className="truncate text-[13px] text-muted-foreground">{detail}</span>
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
					aria-label={`${title}, ${amount}, from the ${assignment.name} Goal`}
					className={rowClassName}
				>
					{content}
				</Link>
			) : (
				<button
					type="button"
					aria-label={
						split
							? `${title}, ${amount}, ${detail.replace(" · ", ": ")}`
							: `${title}, ${amount}, ${assignment.name}, For ${who}`
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
