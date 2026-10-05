import {
	accountLabel,
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
import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { List, ListGroupLabel } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	Outlet,
	useHydrated,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Landmark,
	ListChecks,
	ListFilter,
	Plus,
	ReceiptText,
	Search,
	X,
} from "lucide-react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { QuickAddLink } from "../../../components/app-shell";
import { type FilterOption, FilterSelect } from "../../../components/filter-select";
import { DetailPending, sectionHeaderOverItem } from "../../../components/master-detail";
import { TransactionEditor } from "../../../components/transaction-editor";
import {
	TRANSACTION_COLUMNS,
	TransactionItem,
	useBringsSpendingIn,
	waitingForBank,
} from "../../../components/transaction-list";
import { DeleteSelectedSheet, SelectionBar } from "../../../components/transaction-selection";
import { dayName, formatMoney, monthName } from "../../../format";
import { type AccountView, useGoals } from "../../../goals";
import { type MemberSummary, pickableMembers } from "../../../members";
import { goalsQuery, membersQuery, monthQuery, reviewQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";
import { ulidSchema } from "../../../server/schemas";
import { forFilterSchema, SEARCH_MAX, transactionSortSchema } from "../../../server/transactions";
import {
	isPicked,
	nothingPicked,
	type Picking,
	togglePicked,
} from "../../../transaction-selection";
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
	// Select mode (#97): what is selected, by ID or as "all that match", never by rows on screen.
	const [picking, setPicking] = useState<Picking | null>(null);
	const [confirming, setConfirming] = useState(false);
	const hydrated = useHydrated();
	// The Transaction open in the pane beside the list (its route is this one's child).
	const picked = useParams({ strict: false, select: (params) => params.transactionId });
	// From lg a Transaction opens beside the list, at its own address; on a phone, in a sheet.
	const onEdit = (transaction: TransactionRow) => {
		// While selecting, a tap selects (or unselects) instead of opening.
		if (picking) return setPicking(togglePicked(picking, transaction.id));
		if (window.matchMedia("(min-width: 1024px)").matches) {
			void navigate({
				to: "/transactions/$month/$transactionId",
				params: { month, transactionId: transaction.id },
				search: true,
				resetScroll: false,
			});
		} else setEditing(transaction);
	};
	// Esc closes the pane as it closes the sheet, unless a menu, picker or dialog is open to take
	// it. It goes to the list's address, not Back: a Transaction's address opened on its own has
	// nothing to go back to. Listened for here rather than in the pane, which hydrates later than
	// the list, so the key works as soon as the list does.
	useEffect(() => {
		if (!picked) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector("[role=dialog],[role=alertdialog],[role=listbox],[role=menu]")) {
				return;
			}
			document.querySelector<HTMLElement>('[data-slot="list-row"] > button[aria-current]')?.focus();
			void navigate({
				to: "/transactions/$month",
				params: { month },
				search: true,
				resetScroll: false,
			});
		};
		// Before a picker's own Esc handler runs, while it is still in the page.
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [picked, navigate, month]);
	const change = useTransactionChange();
	const waiting = useSuspenseQuery(reviewQuery()).data.total;
	const sameYear = month.slice(0, 4) === current.slice(0, 4);
	// The order isn't a filter: every Transaction is still there.
	const { sort: _sort, ...narrowing } = filters;
	const filtered = Object.values(narrowing).some((value) => value !== undefined);
	// Another month or other filters: "all that match" would mean something else, so start again.
	const shown = JSON.stringify([month, narrowing]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `shown` is what resets the selection
	useEffect(() => {
		setPicking((was) => (was ? nothingPicked : was));
	}, [shown]);
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
				// On a phone a Transaction opened at its own address has its own header (#74).
				className={sectionHeaderOverItem}
				title={sameYear ? monthName(month) : `${monthName(month)} ${month.slice(0, 4)}`}
				actions={
					<div className="flex flex-wrap items-center justify-end gap-1">
						{picking ? null : (
							<Button
								variant="outline"
								size="sm"
								className="me-1"
								disabled={!hydrated}
								onClick={() => setPicking(nothingPicked)}
							>
								Select
							</Button>
						)}
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
			{/* lg: the list takes the width and the page scrolls, with every loaded row drawn.
			    The rail holds the filters and the total, or the Transaction picked from the
			    list; a Transaction taller than the window scrolls in its pane, so it stays beside its row. */}
			<SplitLayout stack="rail" className="max-lg:gap-4">
				<SplitMain className={cn(picked && "max-lg:hidden")}>
					{picking ? (
						<div className="mb-2">
							<SelectionBar
								month={month}
								filters={filters}
								filtered={filtered}
								picking={picking}
								onPick={setPicking}
								onDelete={() => setConfirming(true)}
								onCancel={() => setPicking(null)}
							/>
						</div>
					) : null}
					<TransactionList
						picking={picking}
						month={month}
						filters={filters}
						today={asOf}
						plan={plan}
						members={members}
						filtered={filtered}
						picked={picked}
						onSort={(sort) => onChange({ sort })}
						onEdit={onEdit}
					/>
				</SplitMain>
				<SplitRail>
					<div className={cn(picked && "hidden")}>
						<Filters
							month={month}
							plan={plan}
							members={members}
							accounts={accounts}
							filters={filters}
							filtered={filtered}
							onChange={onChange}
						/>
					</div>
					{picked ? (
						<section
							aria-label="Transaction details"
							data-slot="transaction-detail"
							// No scroll of its own (#73): an editor taller than the window flows with the page.
							className="@container min-w-0"
						>
							<Suspense fallback={<DetailPending />}>
								<Outlet />
							</Suspense>
						</section>
					) : null}
				</SplitRail>
			</SplitLayout>
			<DeleteSelectedSheet
				open={confirming}
				picking={picking}
				month={month}
				filters={filters}
				onClose={() => setConfirming(false)}
				onDeleted={() => {
					setConfirming(false);
					setPicking(null);
				}}
			/>
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
	const [sheetOpen, setSheetOpen] = useState(false);
	const bucketOptions = plan.buckets.map((bucket) => ({ value: bucket.id, label: bucket.name }));
	const forOptions = [
		{ value: "everyone", label: "Everyone (shared)" },
		...pickableMembers(members, filters.for ? [filters.for] : []).map((member) => ({
			value: member.id,
			label: member.name,
		})),
	];
	const accountOptions = accounts.map((account) => ({
		value: account.id,
		label: accountLabel(account),
	}));
	const labelOf = (options: { value: string; label: string }[], value: string | undefined) =>
		value === undefined ? undefined : (options.find((o) => o.value === value)?.label ?? value);
	const chips = (
		[
			["bucket", labelOf(bucketOptions, filters.bucket)],
			["for", labelOf(forOptions, filters.for)],
			["account", labelOf(accountOptions, filters.account)],
		] as const
	).flatMap(([key, label]) => (label === undefined ? [] : [{ key, label }]));
	return (
		<div className="grid gap-2">
			{total !== null && total !== undefined ? (
				// The month's total heads the rail on a wide screen, as big as a headline (#65).
				<p className="flex items-baseline justify-between gap-3 px-1 text-sm lg:grid lg:justify-start lg:gap-0.5 lg:pb-2">
					<span className="text-muted-foreground">
						{filtered ? "Total for these filters" : `Spent in ${monthName(month)}`}
					</span>
					<span
						className="font-semibold tabular-nums lg:text-2xl lg:tracking-tight"
						data-testid="month-total"
					>
						{formatMoney(total)}
					</span>
				</p>
			) : null}
			{/* With large text, Filters wraps below rather than squeeze the search to a few letters. */}
			<div className="flex flex-wrap gap-2">
				<div className="relative min-w-0 flex-[1_1_10rem]">
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
						placeholder="Search"
						autoComplete="off"
						maxLength={SEARCH_MAX}
						disabled={!hydrated}
						value={search}
						onChange={(event) => setSearch(event.currentTarget.value)}
						className="ps-9"
					/>
				</div>
				<Button
					variant="outline"
					disabled={!hydrated}
					onClick={() => setSheetOpen(true)}
					className="lg:hidden"
				>
					<ListFilter />
					Filters
					{chips.length ? (
						<span className="rounded-full bg-foreground px-1.5 text-[11px] text-background tabular-nums">
							{chips.length}
						</span>
					) : null}
				</Button>
			</div>
			<div className="grid gap-2 max-lg:hidden">
				<FilterSelect
					id="filter-bucket"
					label="Bucket"
					all="All Buckets"
					value={filters.bucket ?? ""}
					disabled={!hydrated}
					onChange={(value) => onChange({ bucket: value || undefined })}
					options={bucketOptions}
				/>
				<FilterSelect
					id="filter-for"
					label="For"
					all="Anyone"
					value={filters.for ?? ""}
					disabled={!hydrated}
					onChange={(value) => onChange({ for: value || undefined })}
					options={forOptions}
				/>
				{accounts.length > 0 ? (
					<FilterSelect
						id="filter-account"
						label="Account"
						all="All Accounts"
						value={filters.account ?? ""}
						disabled={!hydrated}
						onChange={(value) => onChange({ account: value || undefined })}
						options={accountOptions}
					/>
				) : null}
			</div>
			{/* Phones and tablets: the selects sit in a Filters sheet and the active ones show as chips, so the list starts high (#48). */}
			{chips.length ? (
				<ul className="flex flex-wrap gap-1.5 lg:hidden" aria-label="Filters">
					{chips.map((chip) => (
						<li key={chip.key}>
							<Button
								variant="secondary"
								size="chip"
								onClick={() => onChange({ [chip.key]: undefined })}
								aria-label={`Remove filter ${chip.label}`}
								className="max-w-56"
							>
								<span className="truncate">{chip.label}</span>
								<X aria-hidden="true" className="size-3.5 text-muted-foreground" />
							</Button>
						</li>
					))}
				</ul>
			) : null}
			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent>
					<SheetHeader title="Filters" description="Narrow the list to some Transactions." />
					<FiltersForm
						filters={filters}
						bucketOptions={bucketOptions}
						forOptions={forOptions}
						accountOptions={accountOptions}
						onApply={(next) => {
							onChange(next);
							setSheetOpen(false);
						}}
					/>
				</SheetContent>
			</Sheet>
		</div>
	);
}

/** The phone Filters sheet: picks are kept here until Apply, as on Reports. */
function FiltersForm({
	filters,
	bucketOptions,
	forOptions,
	accountOptions,
	onApply,
}: {
	filters: TransactionFilters;
	bucketOptions: FilterOption[];
	forOptions: FilterOption[];
	accountOptions: FilterOption[];
	onApply: (filters: TransactionFilters) => void;
}) {
	const id = useId();
	const [bucket, setBucket] = useState(filters.bucket ?? "");
	const [member, setMember] = useState<string>(filters.for ?? "");
	const [account, setAccount] = useState(filters.account ?? "");
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				onApply({
					bucket: bucket || undefined,
					for: (member || undefined) as TransactionFilters["for"],
					account: account || undefined,
				});
			}}
		>
			<div className="grid gap-4">
				<FilterSelect
					id={`${id}-bucket`}
					label="Bucket"
					all="All Buckets"
					value={bucket}
					onChange={setBucket}
					options={bucketOptions}
				/>
				<FilterSelect
					id={`${id}-for`}
					label="For"
					all="Anyone"
					value={member}
					onChange={setMember}
					options={forOptions}
				/>
				{accountOptions.length > 0 ? (
					<FilterSelect
						id={`${id}-account`}
						label="Account"
						all="All Accounts"
						value={account}
						onChange={setAccount}
						options={accountOptions}
					/>
				) : null}
			</div>
			<SheetFooter className="max-lg:grid-cols-2">
				<Button
					type="button"
					variant="ghost"
					onClick={() => onApply({ bucket: undefined, for: undefined, account: undefined })}
				>
					Clear all
				</Button>
				<Button type="submit">Apply</Button>
			</SheetFooter>
		</form>
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

/**
 * The month's Transactions, newest first, grouped by day. The page scrolls, not the list, and
 * every loaded row is drawn in the normal flow, so the card is exactly as tall as its rows
 * whatever the window does (#73: a windowed list left rows past the first screenful undrawn at
 * 1440, and its long-month path had no test). Rows load 50 at a time as the end nears; a row is a
 * few lines of text with no work of its own, so a month of a thousand lays out without help.
 */
function TransactionList({
	month,
	filters,
	today,
	plan,
	members,
	filtered,
	picked,
	picking,
	onSort,
	onEdit,
}: {
	/** Select mode's selection; null when the list isn't selecting. */
	picking: Picking | null;
	month: MonthKey;
	filters: TransactionFilters;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	filtered: boolean;
	/** The Transaction open beside the list. */
	picked: string | undefined;
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
	const more = useRef<HTMLLIElement>(null);

	// The next page loads when the "loading more" row nears the screen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: items.length re-observes the row, which stays in view when a page adds rows above it
	useEffect(() => {
		const row = more.current;
		if (!row || !hasNextPage || isFetchingNextPage) return;
		if (typeof IntersectionObserver === "undefined") {
			void fetchNextPage();
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(row);
		return () => observer.disconnect();
	}, [items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

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
					"hidden items-center gap-x-3 px-(--card-pad) text-xs font-medium text-subtle-foreground xl:grid 2xl:gap-x-4",
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
					{/* Beside the rail at 1280 the Date button fills this column, so its name waits for room. */}
					<span aria-hidden="true" className="max-[87.5rem]:hidden">
						Description
					</span>
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
			<List aria-label={`Transactions in ${monthName(month)}`}>
				{items.map((item, index) => {
					if (item.kind === "day") {
						return (
							<ListGroupLabel key={`day-${item.day}`} data-index={index}>
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
							<li key="more" ref={more} data-index={index} data-loading-more>
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
							key={item.transaction.id}
							data-index={index}
							transaction={item.transaction}
							plan={plan}
							members={members}
							waiting={waitingForBank(item.transaction, today, bringsIn)}
							columns
							dated={byAmount}
							selected={item.transaction.id === picked}
							checked={picking ? isPicked(picking, item.transaction.id) : undefined}
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
				"gap-1 px-2 text-xs font-medium",
				state === null ? "text-subtle-foreground" : "text-foreground",
				className,
			)}
		>
			{state === null ? `Sort by ${label.toLowerCase()}` : `${label}, ${state}`}
			<Icon aria-hidden="true" className="size-3.5" />
		</Button>
	);
}
