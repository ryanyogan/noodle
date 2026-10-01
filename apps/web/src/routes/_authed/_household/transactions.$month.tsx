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
	TransactionItem,
	useBringsSpendingIn,
	waitingForBank,
} from "../../../components/transaction-list";
import { dayName, monthName } from "../../../format";
import { type AccountView, useGoals } from "../../../goals";
import { type MemberSummary, pickableMembers } from "../../../members";
import { goalsQuery, membersQuery, monthQuery, reviewQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";
import { ulidSchema } from "../../../server/schemas";
import { forFilterSchema, SEARCH_MAX } from "../../../server/transactions";
import {
	type TransactionFilters,
	type TransactionRow,
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
	const filtered = Object.values(filters).some((value) => value !== undefined);

	return (
		<>
			<PageHeader
				className="max-w-2xl"
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
			<div className="grid max-w-2xl gap-4">
				<Filters
					plan={plan}
					members={members}
					accounts={accounts}
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

/** How long the search waits for typing to pause before it narrows the list. */
const SEARCH_PAUSE_MS = 300;

/**
 * Narrows the list to one Bucket, to spending For one Member (or the whole Household), to one
 * Account, and to notes with the words searched for in them.
 */
function Filters({
	plan,
	members,
	accounts,
	filters,
	onChange,
}: {
	plan: Pick<Plan, "buckets">;
	members: MemberSummary[];
	accounts: AccountView[];
	filters: TransactionFilters;
	onChange: (filters: TransactionFilters) => void;
}) {
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
		<div className="grid gap-2">
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
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
						className="col-span-2 sm:col-span-1"
					/>
				) : null}
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
	filters: TransactionFilters;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	filtered: boolean;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useSuspenseInfiniteQuery(
		transactionsQuery(month, filters),
	);
	const bringsIn = useBringsSpendingIn();
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
						waiting={waitingForBank(item.transaction, today, bringsIn)}
						onEdit={onEdit}
					/>
				);
			})}
		</List>
	);
}
