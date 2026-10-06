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
import { PageHeader } from "@noodle/ui/components/page-header";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import {
	useQuery,
	useQueryClient,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
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
import { type ReactNode, Suspense, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { QuickAddLink } from "../../../components/app-shell";
import { type FilterOption, FilterSelect } from "../../../components/filter-select";
import { DetailPending, sectionHeaderOverItem } from "../../../components/master-detail";
import { MoneyInSection } from "../../../components/money-in";
import { TransactionEditor } from "../../../components/transaction-editor";
import { useBringsSpendingIn } from "../../../components/transaction-list";
import { DeleteSelectedSheet, SelectionBar } from "../../../components/transaction-selection";
import { MonthSummary } from "../../../components/transaction-summary";
import { TransactionTable, tableIsStacked } from "../../../components/transaction-table";
import { monthName } from "../../../format";
import { type AccountView, useGoals } from "../../../goals";
import { type MemberSummary, pickableMembers } from "../../../members";
import { moneyInQuery, useReviewWaiting } from "../../../money-in";
import { goalsQuery, membersQuery, monthQuery, reviewQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";
import { ulidSchema } from "../../../server/schemas";
import { forFilterSchema, SEARCH_MAX, transactionSortSchema } from "../../../server/transactions";
import {
	RANGE_OPTIONS,
	rangeName,
	TRANSACTION_RANGES,
	type TransactionRange,
	totalLabel,
} from "../../../transaction-range";
import {
	anyPicked,
	nothingPicked,
	type Picking,
	togglePicked,
} from "../../../transaction-selection";
import { TRANSACTION_SHOWS } from "../../../transaction-summary";
import { escapeStep } from "../../../transaction-table";
import {
	monthOfTransaction,
	rangeBucketsQuery,
	type TransactionChange,
	type TransactionFilters,
	type TransactionRow,
	type TransactionSort,
	transactionLabel,
	transactionsQuery,
	useTransactionChange,
} from "../../../transactions";

export const Route = createFileRoute("/_authed/_household/transactions/$month")({
	// A table of many columns: the page takes the wide cap, as Reports does.
	staticData: { wide: true },
	validateSearch: z.object({
		bucket: ulidSchema.optional().catch(undefined),
		for: forFilterSchema.optional().catch(undefined),
		account: ulidSchema.optional().catch(undefined),
		q: z.string().trim().max(SEARCH_MAX).optional().catch(undefined),
		// Newest first is the default, so it never shows in the URL.
		sort: transactionSortSchema.exclude(["newest"]).optional().catch(undefined),
		// More than the month (issue 99), ending at it; the month alone never shows in the URL.
		range: z.enum(TRANSACTION_RANGES).optional().catch(undefined),
		// The summary's filter (issue 134): money in, money out, or what needs review.
		show: z.enum(TRANSACTION_SHOWS).optional().catch(undefined),
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
		range: search.range,
		show: search.show,
	}),
	// The first page is rendered on the server; later pages load as the Parent scrolls.
	loader: ({ context, deps, cause, preload }) => {
		const list = transactionsQuery(context.month, deps);
		// A search or filter changed within the month already showing (issue 52): the page doesn't
		// wait for the new list here. Waiting longer than the router's 400 ms put the whole page's
		// loading state in its place, which took the search field and a phone's keyboard away in
		// the middle of a word. The list is asked for, and the page keeps showing the one it has
		// until the new one is here (see `filters` in TransactionsPage).
		// "Already showing": a list of this month's has the page reading it now. (Asked of the
		// cache, which the loader and the page share; on the server nothing is ever being read.)
		const reading = (queryKey: readonly unknown[]) =>
			context.queryClient.getQueryCache().findAll({ queryKey, type: "active" }).length > 0;
		const narrowing =
			!preload &&
			cause === "stay" &&
			(reading(list.queryKey.slice(0, -1)) ||
				reading(transactionsQuery(context.month, {}).queryKey.slice(0, -1)));
		return Promise.all([
			context.queryClient.ensureQueryData(monthQuery(context.month)),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(reviewQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
			// The summary's Money in is in the server's HTML, not filled in afterwards.
			context.queryClient.ensureQueryData(moneyInQuery(context.month)),
			narrowing
				? void context.queryClient.prefetchInfiniteQuery(list)
				: context.queryClient.ensureInfiniteQueryData(list),
		]);
	},
	component: TransactionsPage,
});

function TransactionsPage() {
	const { month, current, parentId } = Route.useRouteContext();
	// The filters the list on screen was loaded with. After a change they stay as they were until
	// the list for the new ones has arrived, so the page (and the field being typed in) stays put
	// instead of giving way to a loading state. Held here rather than left to React to defer: a
	// second change while the first was still loading showed the loading state all the same.
	const asked = Route.useLoaderDeps();
	const askedKey = JSON.stringify(asked);
	const [filters, setFilters] = useState(asked);
	const queryClient = useQueryClient();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `askedKey` is `asked`, by value
	useEffect(() => {
		let latest = true;
		const show = () => {
			if (latest) setFilters((shown) => (JSON.stringify(shown) === askedKey ? shown : asked));
		};
		// Shown when it fails too: the list then says so, as it would have.
		void queryClient.ensureInfiniteQueryData(transactionsQuery(month, asked)).then(show, show);
		return () => {
			latest = false;
		};
	}, [askedKey, month, queryClient]);
	const navigate = useNavigate({ from: Route.fullPath });
	const data = useSuspenseQuery(monthQuery(month)).data;
	const { asOf } = data;
	// The other Parent's Personal Allowance isn't this Parent's to filter by or assign to (its
	// Transactions never reach them).
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	const members = useSuspenseQuery(membersQuery()).data;
	const { accounts } = useGoals();
	const [editing, setEditing] = useState<TransactionRow | null>(null);
	// A row of another month (a list of more than a month, issue 99) is edited against its own
	// month's Plan: the sheet waits for it.
	const editingMonth = editing ? monthOfTransaction(editing) : month;
	const otherMonth = useQuery({
		...monthQuery(editingMonth),
		enabled: editingMonth !== month,
	}).data;
	const editingPlan =
		editingMonth === month
			? plan
			: otherMonth
				? {
						...otherMonth.plan,
						buckets: otherMonth.plan.buckets.filter((b) => canAssign(b, parentId)),
					}
				: null;
	// Select mode (#97): what is selected, by ID or as "all that match", never by rows on screen.
	const [picking, setPicking] = useState<Picking | null>(null);
	const [confirming, setConfirming] = useState(false);
	// A tick in the table (issue 99): the first one starts selecting, unticking the last ends it.
	const onPick = (next: Picking) => setPicking(anyPicked(next) ? next : null);
	const selecting = picking !== null;
	const hydrated = useHydrated();
	// The Transaction open under its row in the table (its route is this one's child).
	const picked = useParams({ strict: false, select: (params) => params.transactionId });
	// From lg a Transaction opens in place, under its row, at its own address; on a phone, in a
	// sheet. A click on the row that is open closes it again.
	const onEdit = (transaction: TransactionRow) => {
		// While selecting where rows are stacked (a phone: no checkbox column), a tap selects or
		// unselects instead of opening. In columns the checkbox selects and the row still opens.
		if (picking && tableIsStacked()) return setPicking(togglePicked(picking, transaction.id));
		if (window.matchMedia("(min-width: 1024px)").matches) {
			if (transaction.id === picked) {
				return void navigate({
					to: "/transactions/$month",
					params: { month },
					search: true,
					resetScroll: false,
				});
			}
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
	// Esc steps back one thing at a time (issue 99): an open picker or sheet first (its own), then
	// the open Transaction, then the selection.
	useEffect(() => {
		if (!picked && !selecting) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const target = event.target instanceof HTMLElement ? event.target : null;
			const step = escapeStep({
				overlay: Boolean(
					document.querySelector("[role=dialog],[role=alertdialog],[role=listbox],[role=menu]"),
				),
				cell: Boolean(target?.closest("[data-cell-editor]")),
				typing: Boolean(target?.closest("input, textarea, select, [contenteditable]")),
				open: Boolean(picked),
				selecting,
			});
			if (step === "unselect") setPicking(null);
			if (step !== "close") return;
			document.querySelector<HTMLElement>('[data-slot="list-row"] button[aria-current]')?.focus();
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
	}, [picked, selecting, navigate, month]);
	const change = useTransactionChange();
	const waiting = useReviewWaiting();
	const sameYear = month.slice(0, 4) === current.slice(0, 4);
	// The order isn't a filter: every Transaction is still there.
	// Nor is how many months are listed.
	// The summary's Money in and Money out choose which list shows; only Needs review narrows one.
	const { sort: _sort, range, show, ...narrowing } = filters;
	const narrowed = Object.values(narrowing).some((value) => value !== undefined);
	const filtered = narrowed || show === "review";
	// Another month or other filters: "all that match" would mean something else, so start again.
	const shown = JSON.stringify([month, range, narrowing, show]);
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
								// A phone's header has room for one action and the month arrows: there, Select
								// is beside Filters and Sort instead.
								// From lg the table is always in columns (a Transaction opens under its row, not
								// beside the list), so its checkbox column is the way in and this isn't needed.
								className="me-1 max-sm:hidden lg:hidden"
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
						{/* The two arrows are one piece: with larger text they go to the next line together,
						    never one on each line (issue 74). */}
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
					</div>
				}
			/>
			{/* The filters and the month's total are a bar over the table (issue 99), which takes the
			    page's width, every loaded row drawn and the page scrolling. From lg a Transaction
			    picked from it opens in place, under its row; below lg it is a page of its own, the
			    filters and the other rows hidden. */}
			<div className="grid gap-4">
				<div
					data-slot="transaction-filters"
					className={cn("grid min-w-0 gap-3", picked && "max-lg:hidden")}
				>
					<MonthSummary
						month={month}
						filters={filters}
						caption={totalLabel(range, month, { filtered: narrowed, current })}
						onShow={(next) => onChange({ show: next })}
					/>
					<Filters
						month={month}
						plan={plan}
						members={members}
						accounts={accounts}
						filters={filters}
						onChange={onChange}
						onSelect={picking ? undefined : () => setPicking(nothingPicked)}
					/>
				</div>
				<div data-slot="transaction-list" className="min-w-0">
					{/* One gap between the bar and the list, the same on a phone as anywhere (issue 115). */}
					<div
						className={cn(
							"grid min-w-0 gap-3",
							// Below lg an open Transaction is a page of its own: the selection's bar waits.
							picked && "max-lg:[&>[aria-label='Selecting_Transactions']]:hidden",
						)}
					>
						{picking && (show !== "in" || picked) ? (
							<SelectionBar
								month={month}
								current={current}
								filters={filters}
								filtered={filtered}
								picking={picking}
								onPick={setPicking}
								onDelete={() => setConfirming(true)}
								onCancel={() => setPicking(null)}
								plan={plan}
								onFiled={() => setPicking(null)}
							/>
						) : null}
						{/* Money in alone: the table steps aside (an open Transaction keeps it, it lives there). */}
						{show !== "in" || picked ? (
							<TransactionList
								parentId={parentId}
								picking={picking}
								onPick={onPick}
								month={month}
								filters={filters}
								today={asOf}
								plan={plan}
								members={members}
								filtered={filtered}
								picked={picked}
								onSort={(sort) => onChange({ sort })}
								onEdit={onEdit}
								onCellChange={change.mutate}
								detail={
									picked ? (
										<Suspense fallback={<DetailPending />}>
											<Outlet />
										</Suspense>
									) : undefined
								}
							/>
						) : null}
						<MoneyInSection month={month} today={asOf} show={show} />
					</div>
				</div>
			</div>
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
				transaction={editingPlan ? editing : null}
				today={asOf}
				plan={editingPlan ?? plan}
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
	onChange,
	onSelect,
}: {
	month: MonthKey;
	plan: Pick<Plan, "buckets">;
	members: MemberSummary[];
	accounts: AccountView[];
	filters: TransactionFilters;
	onChange: (filters: TransactionFilters) => void;
	/** Starts selecting, from the phone's Select button. Left out while selecting. */
	onSelect?: () => void;
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
	const [sheetOpen, setSheetOpen] = useState(false);
	// In a list of more than a month (issue 117) the filter offers the Buckets of every month it
	// covers, each once, by name; until they are here, the address month's.
	const inRange = useQuery({
		...rangeBucketsQuery(month, filters.range),
		enabled: Boolean(filters.range),
	}).data;
	const bucketOptions = (filters.range && inRange ? inRange : plan.buckets).map((bucket) => ({
		value: bucket.id,
		label: bucket.name,
	}));
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
			// More than the month shows as a chip too: taking it off is back to the month alone.
			["range", labelOf(RANGE_OPTIONS, filters.range)],
			["bucket", labelOf(bucketOptions, filters.bucket)],
			["for", labelOf(forOptions, filters.for)],
			["account", labelOf(accountOptions, filters.account)],
		] as const
	).flatMap(([key, label]) => (label === undefined ? [] : [{ key, label }]));
	return (
		<div className="grid gap-2 max-lg:grid-cols-1 lg:flex lg:flex-wrap lg:items-end lg:gap-3">
			{/* A phone: the search on a line of its own, then Filters, Sort and Select on the next. */}
			<div className="flex flex-wrap gap-2 lg:order-1 lg:flex-[1_1_14rem]">
				<div className="relative min-w-0 flex-[1_1_10rem] max-sm:basis-full">
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
				{/* Below xl the list has no column names to sort by, so the orders are a menu here. */}
				<Select
					value={filters.sort ?? "newest"}
					disabled={!hydrated}
					onValueChange={(sort) => onChange({ sort: sort as TransactionSort })}
				>
					{/* A Button like the two beside it (issue 115). The order's own words are in the HTML the
					    server sends (Radix fills a bare SelectValue only once it runs in the browser); on the
					    narrowest phones, where they don't fit between Filters and Select, it reads "Sort"; so
					    it does up to 400px while Filters carries its count, which takes the room (issue 74). */}
					<SelectTrigger
						aria-label="Sort"
						variant="button"
						className="min-w-0 max-w-full max-sm:flex-1 xl:hidden"
					>
						<span className="flex min-w-0 items-center gap-2">
							<ArrowUpDown
								aria-hidden="true"
								className={cn(
									"size-4 shrink-0 text-muted-foreground",
									chips.length ? "max-[25rem]:hidden" : "max-[22.5rem]:hidden",
								)}
							/>
							<span
								className={cn(
									"truncate",
									chips.length ? "max-[25rem]:hidden" : "max-[22.5rem]:hidden",
								)}
							>
								<SelectValue>{sortLabel(filters.sort ?? "newest")}</SelectValue>
							</span>
							{/* The word is drawn by CSS, so the trigger's text is the order alone. */}
							<span
								aria-hidden="true"
								className={cn(
									"after:content-['Sort']",
									chips.length ? "min-[25.0625rem]:hidden" : "min-[22.5625rem]:hidden",
								)}
							/>
						</span>
					</SelectTrigger>
					<SelectContent>
						{SORTS.map(([value, label]) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{/* A phone's header has room for one action and the month arrows: Select is here. */}
				{onSelect ? (
					<Button variant="outline" disabled={!hydrated} onClick={onSelect} className="sm:hidden">
						Select
					</Button>
				) : null}
			</div>
			<div className="gap-3 max-lg:hidden lg:order-3 lg:grid lg:flex-[3_1_100%] min-[90rem]:flex-[3_1_36rem] lg:auto-cols-fr lg:grid-flow-col">
				{/* How many months the list shows (issue 99), each ending at the month in the header. */}
				<FilterSelect
					id="filter-range"
					label="Months"
					all="This month"
					value={filters.range ?? ""}
					disabled={!hydrated}
					onChange={(value) => onChange({ range: (value || undefined) as TransactionRange })}
					options={RANGE_OPTIONS}
				/>
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
	const [range, setRange] = useState<string>(filters.range ?? "");
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				onApply({
					range: (range || undefined) as TransactionRange | undefined,
					bucket: bucket || undefined,
					for: (member || undefined) as TransactionFilters["for"],
					account: account || undefined,
				});
			}}
		>
			<div className="grid gap-4">
				<FilterSelect
					id={`${id}-range`}
					label="Months"
					all="This month"
					value={range}
					onChange={setRange}
					options={RANGE_OPTIONS}
				/>
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

/**
 * The month's Transactions, newest first, grouped by day. The page scrolls, not the list, and
 * every loaded row is drawn in the normal flow, so the card is exactly as tall as its rows
 * whatever the window does (#73: a windowed list left rows past the first screenful undrawn at
 * 1440, and its long-month path had no test). Rows load 50 at a time as the end nears; a row is a
 * few lines of text with no work of its own, so a month of a thousand lays out without help.
 */
function TransactionList({
	month,
	parentId,
	filters,
	today,
	plan,
	members,
	filtered,
	picked,
	picking,
	onPick,
	onSort,
	onEdit,
	onCellChange,
	detail,
}: {
	parentId: string;
	/** The open Transaction's editor, drawn under its row in the table. */
	detail?: ReactNode;
	/** A rename or refile made in a cell of the table. */
	onCellChange: (change: TransactionChange) => void;
	/** Select mode's selection; null when the list isn't selecting. */
	picking: Picking | null;
	/** A tick in the table: the selection as it should be now. */
	onPick: (next: Picking) => void;
	month: MonthKey;
	filters: TransactionFilters;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	filtered: boolean;
	/** The Transaction open in the list, from the address. */
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
	const more = useRef<HTMLDivElement>(null);
	// The months listed, in words: the month, or the range ending at it (issue 99).
	const when = !filters.range
		? monthName(month)
		: filters.range === "all"
			? "every month"
			: rangeName(filters.range, month);

	// The next page loads when the "loading more" row nears the screen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: transactions.length re-observes the row, which stays in view when a page adds rows above it
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
	}, [transactions.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

	if (transactions.length === 0) {
		// An address opened with no row to open under (the filters leave every row out): its
		// editor, then what the list says. Below lg the Transaction is a page of its own.
		const nothing = filtered ? (
			<EmptyState
				icon={<ReceiptText />}
				title="Nothing matches"
				description={
					filters.range
						? `No Transactions in ${when} match these filters.`
						: "No Transactions this month match these filters."
				}
			/>
		) : (
			<EmptyState
				icon={<ReceiptText />}
				title={`No Transactions in ${when}`}
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
		if (!picked || !detail) return nothing;
		return (
			<div className="grid gap-4">
				<section
					aria-label="Transaction details"
					data-slot="transaction-detail"
					className="@container min-w-0"
				>
					{detail}
				</section>
				<div className="max-lg:hidden">{nothing}</div>
			</div>
		);
	}

	return (
		<TransactionTable
			label={`Transactions in ${when}`}
			month={month}
			parentId={parentId}
			months={Boolean(filters.range)}
			transactions={transactions}
			more={hasNextPage}
			moreRef={more}
			sort={sort}
			onSort={onSort}
			today={today}
			plan={plan}
			members={members}
			bringsIn={bringsIn}
			open={picked}
			detail={detail}
			picking={picking}
			onPick={onPick}
			onEdit={onEdit}
			onChange={onCellChange}
		/>
	);
}

/** Every order the list can be in, as the Sort menu words them. */
const SORTS: [TransactionSort, string][] = [
	["newest", "Newest first"],
	["oldest", "Oldest first"],
	["largest", "Largest first"],
	["smallest", "Smallest first"],
	["name-az", "Name A–Z"],
	["name-za", "Name Z–A"],
	["assigned-az", "Assigned to A–Z"],
	["assigned-za", "Assigned to Z–A"],
	["account-az", "Account A–Z"],
	["account-za", "Account Z–A"],
];
const sortLabel = (sort: TransactionSort) => SORTS.find(([value]) => value === sort)?.[1] ?? "";
