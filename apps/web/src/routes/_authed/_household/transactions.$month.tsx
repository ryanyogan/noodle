import {
	addMonths,
	canAssign,
	type DayKey,
	type MonthKey,
	monthKeyAt,
	type Plan,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Input } from "@noodle/ui/components/input";
import { List, ListGroupLabel } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useHydrated, useNavigate } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Landmark,
	ListChecks,
	Plus,
	ReceiptText,
	Search,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { QuickAddLink } from "../../../components/app-shell";
import { FilterSelect } from "../../../components/filter-select";
import { TransactionEditor } from "../../../components/transaction-editor";
import {
	TRANSACTION_COLUMNS,
	TransactionItem,
	useBringsSpendingIn,
	waitingForBank,
} from "../../../components/transaction-list";
import { dayName, formatMoney, monthName } from "../../../format";
import { type AccountView, useGoals } from "../../../goals";
import { type MemberSummary, pickableMembers } from "../../../members";
import { goalsQuery, membersQuery, monthQuery, reviewQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";
import { ulidSchema } from "../../../server/schemas";
import { forFilterSchema, SEARCH_MAX, transactionSortSchema } from "../../../server/transactions";
import {
	type TransactionFilters,
	type TransactionRow,
	type TransactionSort,
	transactionLabel,
	transactionsQuery,
	useTransactionChange,
} from "../../../transactions";

export const Route = createFileRoute("/_authed/_household/transactions/$month")({
	validateSearch: z.object({
		bucket: ulidSchema.optional().catch(undefined),
		for: forFilterSchema.optional().catch(undefined),
		account: ulidSchema.optional().catch(undefined),
		q: z.string().trim().max(SEARCH_MAX).optional().catch(undefined),
		// Newest first is the default, so it never shows in the URL.
		sort: transactionSortSchema.exclude(["newest"]).optional().catch(undefined),
	}),
	beforeLoad: ({ params, context }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		// Months after this one have nothing in them yet.
		const current = monthKeyAt(new Date(), context.household.timeZone);
		if (params.month > current) throw notFound();
		return { month: params.month as MonthKey, current };
	},
	loaderDeps: ({ search }) => ({
		bucket: search.bucket,
		for: search.for,
		account: search.account,
		q: search.q || undefined,
		sort: search.sort,
	}),
	// The first page is rendered on the server; later pages load as the Parent scrolls.
	loader: ({ context, deps }) =>
		Promise.all([
			context.queryClient.ensureQueryData(monthQuery(context.month)),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(reviewQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
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
	const { accounts } = useGoals();
	const [editing, setEditing] = useState<TransactionRow | null>(null);
	const change = useTransactionChange();
	const waiting = useSuspenseQuery(reviewQuery()).data.total;
	const sameYear = month.slice(0, 4) === current.slice(0, 4);
	// The order isn't a filter: every Transaction is still there.
	const { sort: _sort, ...narrowing } = filters;
	const filtered = Object.values(narrowing).some((value) => value !== undefined);
	const onChange = (next: TransactionFilters) =>
		void navigate({
			search: (prev) => ({
				...prev,
				...next,
				// Newest first is the default, left out of the URL.
				sort: "sort" in next ? (next.sort === "newest" ? undefined : next.sort) : prev.sort,
			}),
			replace: true,
		});

	return (
		<>
			<PageHeader
				eyebrow="Transactions"
				title={sameYear ? monthName(month) : `${monthName(month)} ${month.slice(0, 4)}`}
				actions={
					<div className="flex items-center gap-1">
						{/* On phones Accounts lives here; the sidebar has its own link. */}
						<Button variant="ghost" size="icon" className="lg:hidden" asChild>
							<Link to="/accounts" aria-label="Accounts">
								<Landmark className="size-5" />
							</Link>
						</Button>
						<Button variant="outline" size="sm" className="me-2" asChild>
							<Link
								to="/review"
								aria-label={waiting > 0 ? `Review, ${waiting} to review` : "Review"}
							>
								<ListChecks />
								{/* With a count to show, a phone keeps the month's name whole by showing just the count. */}
								<span className={cn(waiting > 0 && "max-sm:sr-only")}>Review</span>
								{waiting > 0 ? (
									<Badge variant="count" className="-me-1">
										{waiting}
									</Badge>
								) : null}
							</Link>
						</Button>
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
			{/* lg: the list takes the width, with the filters in a pane on the right that stays put (#47). */}
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-8">
				<Filters
					month={month}
					plan={plan}
					members={members}
					accounts={accounts}
					filters={filters}
					filtered={filtered}
					onChange={onChange}
				/>
				<TransactionList
					month={month}
					filters={filters}
					today={asOf}
					plan={plan}
					members={members}
					filtered={filtered}
					onSort={(sort) => onChange({ sort })}
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

/** How long the search waits for typing to pause before it narrows the list. */
const SEARCH_PAUSE_MS = 300;

/**
 * Narrows the list to one Bucket, to spending For one Member (or the whole Household), to one
 * Account, and to notes with the words searched for in them.
 */
function Filters({
	month,
	plan,
	members,
	accounts,
	filters,
	filtered,
	onChange,
}: {
	month: MonthKey;
	plan: Pick<Plan, "buckets">;
	members: MemberSummary[];
	accounts: AccountView[];
	filters: TransactionFilters;
	filtered: boolean;
	onChange: (filters: TransactionFilters) => void;
}) {
	// The list's own query (already loaded): its first page carries the month's total.
	const total = useSuspenseInfiniteQuery(transactionsQuery(month, filters)).data.pages[0]?.total;
	// Until hydrated, a change would only move the select, not the list.
	const hydrated = useHydrated();
	const [search, setSearch] = useState(filters.q ?? "");
	const change = useRef(onChange);
	change.current = onChange;
	// Typing narrows the list once it pauses, without a history entry per letter.
	useEffect(() => {
		const typed = search.trim() || undefined;
		if (typed === filters.q) return;
		const timer = setTimeout(() => change.current({ q: typed }), SEARCH_PAUSE_MS);
		return () => clearTimeout(timer);
	}, [search, filters.q]);
	return (
		<div className="grid gap-2 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
			{total !== null && total !== undefined ? (
				<p className="flex items-baseline justify-between gap-3 px-1 text-sm lg:order-last lg:pt-2">
					<span className="text-muted-foreground">
						{filtered ? "Total for these filters" : `Spent in ${monthName(month)}`}
					</span>
					<span className="font-semibold tabular-nums" data-testid="month-total">
						{formatMoney(total)}
					</span>
				</p>
			) : null}
			<div className="relative">
				<label htmlFor="filter-search" className="sr-only">
					Search notes and merchants
				</label>
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					id="filter-search"
					type="search"
					placeholder="Search notes and merchants"
					autoComplete="off"
					maxLength={SEARCH_MAX}
					disabled={!hydrated}
					value={search}
					onChange={(event) => setSearch(event.currentTarget.value)}
					className="ps-9"
				/>
			</div>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
				<FilterSelect
					id="filter-bucket"
					label="Bucket"
					all="All Buckets"
					value={filters.bucket ?? ""}
					disabled={!hydrated}
					onChange={(value) => onChange({ bucket: value || undefined })}
					options={plan.buckets.map((bucket) => ({ value: bucket.id, label: bucket.name }))}
				/>
				<FilterSelect
					id="filter-for"
					label="For"
					all="Anyone"
					value={filters.for ?? ""}
					disabled={!hydrated}
					onChange={(value) => onChange({ for: value || undefined })}
					options={[
						{ value: "everyone", label: "Everyone (shared)" },
						...pickableMembers(members, filters.for ? [filters.for] : []).map((member) => ({
							value: member.id,
							label: member.name,
						})),
					]}
				/>
				{accounts.length > 0 ? (
					<FilterSelect
						id="filter-account"
						label="Account"
						all="All Accounts"
						value={filters.account ?? ""}
						disabled={!hydrated}
						onChange={(value) => onChange({ account: value || undefined })}
						options={accounts.map((account) => ({ value: account.id, label: account.name }))}
						className="col-span-2 sm:col-span-1 lg:col-span-1"
					/>
				) : null}
			</div>
		</div>
	);
}

type Item =
	| { kind: "day"; day: DayKey; total: number | null }
	| { kind: "transaction"; transaction: TransactionRow }
	| { kind: "more" };

/** The loaded Transactions as the list shows them: each day's label, then its Transactions. */
function itemsOf(transactions: TransactionRow[], more: boolean, byDay: boolean): Item[] {
	const items: Item[] = [];
	let label = null as Extract<Item, { kind: "day" }> | null;
	for (const transaction of transactions) {
		if (!byDay) {
			items.push({ kind: "transaction", transaction });
			continue;
		}
		if (transaction.date !== label?.day) {
			label = { kind: "day", day: transaction.date, total: 0 };
			items.push(label);
		}
		// What the day spent: a Transfer's sides count nowhere; money back takes off.
		if (!transaction.transfer && label.total !== null) label.total += transaction.amountCents;
		items.push({ kind: "transaction", transaction });
	}
	// The last day may go on in the next page: no total until it's all here.
	if (more) {
		if (label) label.total = null;
		items.push({ kind: "more" });
	}
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
	onSort,
	onEdit,
}: {
	month: MonthKey;
	filters: TransactionFilters;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	filtered: boolean;
	onSort: (sort: TransactionSort) => void;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(
		transactionsQuery(month, filters),
	);
	const bringsIn = useBringsSpendingIn();
	const transactions = data.pages.flatMap((page) => page.transactions);
	const sort = filters.sort ?? "newest";
	// By amount, days mix, so there are no day labels and each row says its date.
	const byAmount = sort === "largest" || sort === "smallest";
	const items = itemsOf(transactions, hasNextPage, !byAmount);
	const hydrated = useHydrated();
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
		// The server has no window: render the rows a tall phone screen would show, from the top.
		initialRect: { width: 0, height: 1000 },
		// The browser's first render must be the server's, so it starts from the top too: by
		// default it reads window.scrollY, which is past 0 when the browser restores a scrolled
		// page, and then renders other rows than the server did (a hydration error). Once
		// mounted, the virtualizer follows the real scroll.
		initialOffset: 0,
	});
	const virtualItems = virtualizer.getVirtualItems();
	const lastIndex = virtualItems.at(-1)?.index ?? 0;

	useEffect(() => {
		if (lastIndex >= items.length - 1 && hasNextPage && !isFetchingNextPage) {
			void fetchNextPage();
		}
	}, [lastIndex, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

	if (transactions.length === 0) {
		return filtered ? (
			<EmptyState
				icon={<ReceiptText />}
				title="Nothing matches"
				description="No Transactions this month match these filters."
			/>
		) : (
			<EmptyState
				icon={<ReceiptText />}
				title={`No Transactions in ${monthName(month)}`}
				description="Quick Add what you spend as you spend it, or bring it in from your bank: connect it, or upload a statement on its Account."
				action={
					<div className="flex flex-wrap justify-center gap-2">
						<Button asChild>
							<QuickAddLink>
								<Plus />
								Quick Add
							</QuickAddLink>
						</Button>
						<Button variant="outline" asChild>
							<Link to="/accounts">
								<Landmark />
								Connect a bank or upload a statement
							</Link>
						</Button>
					</div>
				}
			/>
		);
	}

	return (
		<div className="grid gap-2">
			{/* The columns’ names at xl; each row says them to a screen reader itself. Date and
			    Amount sort the list (on the server, as it loads a page at a time). */}
			<div
				className={cn(
					"hidden items-center gap-x-4 px-(--card-pad) text-xs font-medium text-subtle-foreground xl:grid",
					TRANSACTION_COLUMNS,
				)}
			>
				<span className="col-span-2 flex items-center gap-4">
					<SortButton
						label="Date"
						state={sort === "newest" ? "newest first" : sort === "oldest" ? "oldest first" : null}
						descending={sort !== "oldest"}
						disabled={!hydrated}
						onClick={() => onSort(sort === "newest" ? "oldest" : "newest")}
						className="-ms-2"
					/>
					<span aria-hidden="true">Description</span>
				</span>
				<span aria-hidden="true">Assigned to</span>
				<span aria-hidden="true">For</span>
				<span aria-hidden="true">Account</span>
				<SortButton
					label="Amount"
					state={
						sort === "largest" ? "largest first" : sort === "smallest" ? "smallest first" : null
					}
					descending={sort !== "smallest"}
					disabled={!hydrated}
					onClick={() => onSort(sort === "largest" ? "smallest" : "largest")}
					className="-me-2 justify-self-end"
				/>
			</div>
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
								<span className="flex items-baseline justify-between gap-3">
									<span>{dayName(item.day, today)}</span>
									{item.total !== null ? (
										<span className="tabular-nums">
											<span className="sr-only">Spent </span>
											{formatMoney(item.total)}
										</span>
									) : null}
								</span>
							</ListGroupLabel>
						);
					}
					if (item.kind === "more") {
						return (
							<li key={virtual.key} {...position}>
								<span role="status" className="sr-only">
									Loading more Transactions…
								</span>
								<div aria-hidden="true" className="flex items-center gap-3 px-(--card-pad) py-3.5">
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
							waiting={waitingForBank(item.transaction, today, bringsIn)}
							columns
							dated={byAmount}
							onEdit={onEdit}
						/>
					);
				})}
			</List>
		</div>
	);
}

/**
 * A column name that sorts the list by it: says the order it's in when it's the one sorting, and
 * flips that order when pressed again.
 */
function SortButton({
	label,
	state,
	descending,
	disabled,
	onClick,
	className,
}: {
	label: string;
	/** The order, when this column sorts the list. */
	state: string | null;
	descending: boolean;
	disabled: boolean;
	onClick: () => void;
	className?: string;
}) {
	const Icon = state === null ? ArrowUpDown : descending ? ArrowDown : ArrowUp;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={disabled}
			aria-pressed={state !== null}
			onClick={onClick}
			className={cn(
				"h-7 gap-1 px-2 text-xs font-medium",
				state === null ? "text-subtle-foreground" : "text-foreground",
				className,
			)}
		>
			{state === null ? `Sort by ${label.toLowerCase()}` : `${label}, ${state}`}
			<Icon aria-hidden="true" className="size-3.5" />
		</Button>
	);
}
