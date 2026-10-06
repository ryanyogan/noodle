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
import { useBringsSpendingIn } from "../../../components/transaction-list";
import { DeleteSelectedSheet, SelectionBar } from "../../../components/transaction-selection";
import { TransactionTable, tableIsStacked } from "../../../components/transaction-table";
import { formatMoney, monthName } from "../../../format";
import { type AccountView, useGoals } from "../../../goals";
import { type MemberSummary, pickableMembers } from "../../../members";
import { goalsQuery, membersQuery, monthQuery, reviewQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";
import { ulidSchema } from "../../../server/schemas";
import { forFilterSchema, SEARCH_MAX, transactionSortSchema } from "../../../server/transactions";
import {
	anyPicked,
	nothingPicked,
	type Picking,
	togglePicked,
} from "../../../transaction-selection";
import { escapeStep } from "../../../transaction-table";
import {
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
	// A tick in the table (issue 99): the first one starts selecting, unticking the last ends it.
	const onPick = (next: Picking) => setPicking(anyPicked(next) ? next : null);
	const selecting = picking !== null;
	const hydrated = useHydrated();
	// The Transaction open in the pane beside the list (its route is this one's child).
	const picked = useParams({ strict: false, select: (params) => params.transactionId });
	// From lg a Transaction opens beside the list, at its own address; on a phone, in a sheet.
	const onEdit = (transaction: TransactionRow) => {
		// While selecting where rows are stacked (a phone: no checkbox column), a tap selects or
		// unselects instead of opening. In columns the checkbox selects and the row still opens.
		if (picking && tableIsStacked()) return setPicking(togglePicked(picking, transaction.id));
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
								// A phone's header has room for one action and the month arrows: there, Select
								// is beside Filters and Sort instead.
								// From 1400 the table has its checkbox column even beside an open Transaction, and a
								// tick starts selecting. Narrower, the list beside one is stacked: this is the way in.
								className="me-1 max-sm:hidden min-[1400px]:hidden"
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
			{/* The filters and the month's total are a bar over the table (issue 99), which takes the
			    page's width, every loaded row drawn and the page scrolling. From lg a Transaction
			    picked from it opens in the rail beside it; a Transaction taller than the window
			    scrolls with the page. */}
			<div className="grid gap-4">
				<div data-slot="transaction-filters" className={cn(picked && "max-lg:hidden")}>
					<Filters
						month={month}
						plan={plan}
						members={members}
						accounts={accounts}
						filters={filters}
						filtered={filtered}
						onChange={onChange}
						onSelect={picking ? undefined : () => setPicking(nothingPicked)}
					/>
				</div>
				<SplitLayout className={cn("max-lg:gap-4", !picked && "lg:grid-cols-1")}>
					<SplitMain className={cn(picked && "max-lg:hidden")}>
						{/* One gap between the bar and the list, the same on a phone as anywhere (issue 115). */}
						<div className="grid min-w-0 gap-3">
							{picking ? (
								<SelectionBar
									month={month}
									filters={filters}
									filtered={filtered}
									picking={picking}
									onPick={setPicking}
									onDelete={() => setConfirming(true)}
									onCancel={() => setPicking(null)}
								/>
							) : null}
							<TransactionList
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
							/>
						</div>
					</SplitMain>
					{picked ? (
						<SplitRail>
							<section
								aria-label="Transaction details"
								data-slot="transaction-detail"
								// No scroll of its own: an editor taller than the window flows with the page.
								className="@container min-w-0"
							>
								<Suspense fallback={<DetailPending />}>
									<Outlet />
								</Suspense>
							</section>
						</SplitRail>
					) : null}
				</SplitLayout>
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
	onSelect,
}: {
	month: MonthKey;
	plan: Pick<Plan, "buckets">;
	members: MemberSummary[];
	accounts: AccountView[];
	filters: TransactionFilters;
	filtered: boolean;
	onChange: (filters: TransactionFilters) => void;
	/** Starts selecting, from the phone's Select button. Left out while selecting. */
	onSelect?: () => void;
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
		<div className="grid gap-2 lg:flex lg:flex-wrap lg:items-end lg:gap-3">
			{total !== null && total !== undefined ? (
				// From lg the month's total ends the bar, as big as a headline.
				<p className="flex items-baseline justify-between gap-3 px-1 text-sm lg:order-last lg:ms-auto lg:grid lg:justify-items-end lg:gap-0.5">
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
			{/* A phone: the search on a line of its own, then Filters, Sort and Select on the next. */}
			<div className="flex flex-wrap gap-2 lg:flex-[1_1_14rem]">
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
					    narrowest phones, where they don't fit between Filters and Select, it reads "Sort". */}
					<SelectTrigger
						aria-label="Sort"
						variant="button"
						className="min-w-0 max-w-full max-sm:flex-1 xl:hidden"
					>
						<span className="flex min-w-0 items-center gap-2">
							<ArrowUpDown
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground max-[22.5rem]:hidden"
							/>
							<span className="truncate max-[22.5rem]:hidden">
								<SelectValue>{sortLabel(filters.sort ?? "newest")}</SelectValue>
							</span>
							{/* The word is drawn by CSS, so the trigger's text is the order alone. */}
							<span aria-hidden="true" className="after:content-['Sort'] min-[22.5625rem]:hidden" />
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
			<div className="gap-3 max-lg:hidden lg:grid lg:flex-[3_1_26rem] lg:auto-cols-fr lg:grid-flow-col">
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
	onPick,
	onSort,
	onEdit,
	onCellChange,
}: {
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
	const more = useRef<HTMLDivElement>(null);

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
		<TransactionTable
			label={`Transactions in ${monthName(month)}`}
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
