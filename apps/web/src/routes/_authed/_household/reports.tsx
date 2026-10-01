import {
	COMPARISONS,
	type Comparison,
	type DayKey,
	GROUPINGS,
	type MonthKey,
	monthOfDay,
	REPORT_PERIODS,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ChartPie,
	ChevronRight,
	Download,
	Landmark,
	Lightbulb,
	ListFilter,
	Plus,
	X,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { NativeSelect } from "../../../components/native-select";
import { quickAddSearch } from "../../../components/quick-add";
import { ReportBody, type ReportNav, tablesFor } from "../../../components/report-views";
import { reportQuery } from "../../../queries";
import {
	csvName,
	download,
	merchantName,
	monthLabel,
	namesOf,
	PERIOD_LABELS,
	REPORT_VIEWS,
	type ReportSearch,
	reportSearchSchema,
	requestOf,
	tablesCsv,
	VIEW_LABELS,
} from "../../../reports";
import type { ReportData, ReportView } from "../../../server/reports";

// Reports: where the money goes, from the whole Household down to the Transactions behind any
// number. Every option lives in the URL, so any view (drill-down included) can be bookmarked or
// shared. Charts render in the browser only (`ssr: "data-only"`): the server still loads the
// Report, and the page shows its skeleton until the charts can measure themselves.

export const Route = createFileRoute("/_authed/_household/reports")({
	ssr: "data-only",
	validateSearch: reportSearchSchema,
	loaderDeps: ({ search }) => ({ request: requestOf(search) }),
	loader: ({ context, deps }) => context.queryClient.ensureQueryData(reportQuery(deps.request)),
	pendingComponent: ReportsPending,
	component: ReportsPage,
});

const COMPARE_LABELS: Record<Comparison, string> = {
	previous: "vs previous",
	"last-year": "vs last year",
	none: "No comparison",
};

function useReportNav(): ReportNav & { go: (patch: Partial<ReportSearch>) => void } {
	const navigate = useNavigate({ from: Route.fullPath });
	return useMemo(() => {
		const go = (patch: Partial<ReportSearch>) =>
			navigate({ search: (prev) => ({ ...prev, ...patch }), resetScroll: false });
		return {
			go,
			set: (patch) =>
				navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false }),
			area: (area, month) => go({ area, month }),
			month: (month) =>
				navigate({
					search: (prev) => ({ ...prev, month: prev.month === month ? undefined : month }),
					resetScroll: false,
				}),
		};
	}, [navigate]);
}

/**
 * The options each view reads: only these are offered, so none sits there doing nothing. A view
 * drilled into an area always compares.
 */
const VIEW_OPTIONS: Record<
	ReportView,
	{ period: boolean; compare: boolean; group: boolean; filters: boolean }
> = {
	overview: { period: true, compare: true, group: true, filters: true },
	big: { period: true, compare: false, group: false, filters: true },
	buckets: { period: true, compare: true, group: false, filters: true },
	plan: { period: true, compare: false, group: false, filters: false },
	trends: { period: true, compare: true, group: true, filters: true },
	merchants: { period: true, compare: false, group: false, filters: true },
	people: { period: true, compare: false, group: true, filters: true },
	"cash-flow": { period: true, compare: false, group: false, filters: false },
	goals: { period: true, compare: false, group: false, filters: false },
	income: { period: true, compare: false, group: false, filters: false },
};

function ReportsPage() {
	const search = Route.useSearch();
	const request = requestOf(search);
	const report = useSuspenseQuery(reportQuery(request)).data;
	const names = useMemo(() => namesOf(report.meta), [report.meta]);
	const tables = useMemo(() => tablesFor(report, names), [report, names]);
	const nav = useReportNav();
	const drilled = Boolean(search.area || search.month);
	const title = search.area
		? names.label(search.area)
		: search.month
			? monthLabel(search.month)
			: VIEW_LABELS[request.view];

	// A Household with no Transactions or income yet has nothing to report, whatever the options.
	const empty = report.historyFrom === null;

	return (
		// One minmax(0,1fr) column: the view tabs' w-max list scrolls in its own nav rather than
		// widening the page (a grid's auto column is as wide as its widest content).
		<div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:gap-5">
			<PageHeader
				className="mb-0 lg:mb-0"
				eyebrow="Reports"
				title={title}
				actions={
					<>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/insights">
								<Lightbulb />
								<span className="max-sm:sr-only">Insights</span>
							</Link>
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={empty}
							onClick={() =>
								download(csvName(report, request.view), tablesCsv(Object.values(tables)))
							}
						>
							<Download />
							<span className="max-sm:sr-only">Export CSV</span>
						</Button>
					</>
				}
			/>
			{empty ? (
				<Card className="p-0">
					<EmptyState
						icon={<ChartPie />}
						title="Reports fill in once you have Transactions"
						description="Quick Add what you spend, or bring in your bank’s, and Reports show where the money went, month by month."
						action={
							<div className="flex flex-wrap justify-center gap-2">
								<Button size="sm" asChild>
									<Link to="." search={(prev) => ({ ...prev, ...quickAddSearch })}>
										<Plus />
										Quick Add
									</Link>
								</Button>
								<Button size="sm" variant="outline" asChild>
									<Link to="/accounts">
										<Landmark />
										Connect a bank or add an Account
									</Link>
								</Button>
							</div>
						}
					/>
				</Card>
			) : (
				<>
					<ViewTabs current={request.view} />
					<Options
						search={search}
						report={report}
						nav={nav}
						offered={
							search.area
								? { ...VIEW_OPTIONS[request.view], compare: true }
								: VIEW_OPTIONS[request.view]
						}
					/>
					{drilled ? <Breadcrumb search={search} view={request.view} label={names.label} /> : null}
					<div key={`${request.view}|${search.area ?? ""}`} className="animate-enter">
						<ReportBody report={report} names={names} search={search} nav={nav} tables={tables} />
					</div>
				</>
			)}
		</div>
	);
}

function ViewTabs({ current }: { current: ReportSearch["view"] & string }) {
	return (
		<nav
			aria-label="Report views"
			className="-mx-(--gutter) overflow-x-auto px-(--gutter) [scrollbar-width:none]"
		>
			<ul className="flex w-max gap-1 rounded-xl bg-surface-2 p-1">
				{REPORT_VIEWS.map((view) => (
					<li key={view}>
						<Link
							from={Route.fullPath}
							search={(prev) => ({
								...prev,
								view: view === "overview" ? undefined : view,
								area: undefined,
								month: undefined,
								chart: undefined,
								over: undefined,
							})}
							resetScroll={false}
							// The router marks a link current when its search is a subset of the URL's, which
							// the Overview tab (no `view`) always is; exact matching leaves it to `current`.
							activeOptions={{ exact: true }}
							aria-current={view === current ? "page" : undefined}
							className={cn(
								"block whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground",
								"transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-standard hover:text-foreground",
								"aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card",
							)}
						>
							{VIEW_LABELS[view]}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

function Options({
	search,
	report,
	nav,
	offered,
}: {
	search: ReportSearch;
	report: ReportData;
	nav: ReturnType<typeof useReportNav>;
	/** The options this view reads. */
	offered: (typeof VIEW_OPTIONS)[ReportView];
}) {
	const id = useId();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const period = search.period ?? "6m";
	const names = namesOf(report.meta);
	const chips = [
		...(search.buckets ?? []).map((b) => ({
			key: `bucket:${b}`,
			label: names.label(`bucket:${b}`),
			clear: { buckets: search.buckets?.filter((x) => x !== b) },
		})),
		...(search.member
			? [
					{
						key: "member",
						label: `For ${names.label(`member:${search.member}`)}`,
						clear: { member: undefined },
					},
				]
			: []),
		...(search.account
			? [
					{
						key: "account",
						label: names.label(`account:${search.account}`),
						clear: { account: undefined },
					},
				]
			: []),
		...(search.merchant
			? [{ key: "merchant", label: merchantName(search.merchant), clear: { merchant: undefined } }]
			: []),
		...(search.min ? [{ key: "min", label: `$${search.min}+`, clear: { min: undefined } }] : []),
	];
	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-end gap-2">
				<label className="grid gap-1 max-sm:w-[calc(50%-0.25rem)]" htmlFor={`${id}-period`}>
					<span className="text-[13px] font-medium text-muted-foreground">Period</span>
					<NativeSelect
						id={`${id}-period`}
						value={period}
						onChange={(event) =>
							nav.set({
								period: event.target.value as ReportSearch["period"],
								...(event.target.value === "custom"
									? {
											from: search.from ?? report.range.from,
											to: search.to ?? (report.asOf as DayKey),
										}
									: { from: undefined, to: undefined }),
								month: undefined,
							})
						}
						className="sm:w-44"
					>
						{REPORT_PERIODS.map((p) => (
							<option key={p} value={p}>
								{PERIOD_LABELS[p]}
							</option>
						))}
					</NativeSelect>
				</label>
				{period === "custom" ? (
					<>
						<Input
							type="date"
							aria-label="From"
							value={search.from ?? report.range.from}
							max={search.to}
							onChange={(event) =>
								event.target.value && nav.set({ from: event.target.value as DayKey })
							}
							className="w-40"
						/>
						<Input
							type="date"
							aria-label="To"
							value={search.to ?? report.asOf}
							min={search.from}
							onChange={(event) =>
								event.target.value && nav.set({ to: event.target.value as DayKey })
							}
							className="w-40"
						/>
					</>
				) : null}
				{offered.compare ? (
					<label className="grid gap-1 max-sm:w-[calc(50%-0.25rem)]" htmlFor={`${id}-compare`}>
						<span className="text-[13px] font-medium text-muted-foreground">Compare with</span>
						<NativeSelect
							id={`${id}-compare`}
							value={search.compare ?? "previous"}
							onChange={(event) =>
								nav.set({
									compare:
										event.target.value === "previous"
											? undefined
											: (event.target.value as Comparison),
								})
							}
							className="sm:w-52"
						>
							{COMPARISONS.map((c) => (
								<option key={c} value={c}>
									{COMPARE_LABELS[c]}
								</option>
							))}
						</NativeSelect>
					</label>
				) : null}
				{offered.group ? (
					<label className="grid gap-1 max-sm:w-[calc(50%-0.25rem)]" htmlFor={`${id}-group`}>
						<span className="text-[13px] font-medium text-muted-foreground">Group by</span>
						<NativeSelect
							id={`${id}-group`}
							value={search.group ?? ""}
							onChange={(event) =>
								nav.set({ group: (event.target.value || undefined) as ReportSearch["group"] })
							}
							className="sm:w-44"
						>
							<option value="">By {report.grouping} (auto)</option>
							{GROUPINGS.map((g) => (
								<option key={g} value={g}>
									By {g}
								</option>
							))}
						</NativeSelect>
					</label>
				) : null}
				{offered.filters ? (
					<Button
						variant="outline"
						onClick={() => setFiltersOpen(true)}
						className="h-10 max-sm:w-[calc(50%-0.25rem)]"
					>
						<ListFilter />
						Filters
						{chips.length ? (
							<span className="rounded-full bg-foreground px-1.5 text-[11px] text-background tabular-nums">
								{chips.length}
							</span>
						) : null}
					</Button>
				) : null}
			</div>
			{offered.compare && (search.compare ?? "previous") !== "none" && report.compared === null ? (
				<p className="text-[13px] text-muted-foreground">
					{report.historyFrom
						? `Nothing earlier to compare with: your history starts in ${monthLabel(monthOfDay(report.historyFrom))}.`
						: "Nothing to compare with yet."}
				</p>
			) : null}
			{chips.length ? (
				<ul className="flex flex-wrap gap-1.5" aria-label="Filters">
					{chips.map((chip) => (
						<li key={chip.key}>
							<button
								type="button"
								onClick={() => nav.set(chip.clear)}
								aria-label={`Remove filter ${chip.label}`}
								className="inline-flex h-7 items-center gap-1 rounded-full bg-surface-2 ps-2.5 pe-1.5 text-xs font-medium transition-colors hover:bg-surface-3"
							>
								{chip.label}
								<X aria-hidden="true" className="size-3.5 text-muted-foreground" />
							</button>
						</li>
					))}
				</ul>
			) : null}
			<Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
				<SheetContent>
					<SheetHeader title="Filters" description="Narrow every view to some spending." />
					<Filters
						search={search}
						report={report}
						onApply={(patch) => {
							nav.set({ ...patch, month: undefined });
							setFiltersOpen(false);
						}}
					/>
				</SheetContent>
			</Sheet>
		</div>
	);
}

function Filters({
	search,
	report,
	onApply,
}: {
	search: ReportSearch;
	report: ReportData;
	onApply: (patch: Partial<ReportSearch>) => void;
}) {
	const id = useId();
	const [buckets, setBuckets] = useState<string[]>(search.buckets ?? []);
	const [member, setMember] = useState(search.member ?? "");
	const [account, setAccount] = useState(search.account ?? "");
	const [merchant, setMerchant] = useState(search.merchant ?? "");
	const [min, setMin] = useState(search.min ? String(search.min) : "");
	const { meta } = report;
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				const minimum = Number.parseInt(min, 10);
				onApply({
					buckets: buckets.length ? buckets : undefined,
					member: (member || undefined) as ReportSearch["member"],
					account: account || undefined,
					merchant: merchant.trim().toLowerCase() || undefined,
					min: Number.isFinite(minimum) && minimum > 0 ? minimum : undefined,
				});
			}}
		>
			<div className="grid gap-2">
				<p id={`${id}-buckets`} className="mb-2 text-sm font-medium">
					Buckets
				</p>
				<ToggleGroup
					type="multiple"
					aria-labelledby={`${id}-buckets`}
					value={buckets}
					onValueChange={setBuckets}
					className="w-full flex-wrap gap-1.5"
				>
					{meta.buckets.map((b) => (
						<ToggleGroupItem
							key={b.id}
							value={b.id}
							className="rounded-full border border-border bg-card text-foreground hover:bg-surface-2 data-[state=on]:border-transparent data-[state=on]:bg-foreground data-[state=on]:text-background"
						>
							<span
								className="size-2 rounded-full"
								style={{ background: `var(--bucket-${b.color})` }}
							/>
							{b.name}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="For" htmlFor={`${id}-member`}>
					<NativeSelect
						id={`${id}-member`}
						value={member}
						onChange={(e) => setMember(e.target.value)}
					>
						<option value="">Anyone</option>
						<option value="everyone">The whole Household</option>
						{meta.members.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field label="Account" htmlFor={`${id}-account`}>
					<NativeSelect
						id={`${id}-account`}
						value={account}
						onChange={(e) => setAccount(e.target.value)}
					>
						<option value="">Any Account</option>
						{meta.accounts.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field label="Merchant" htmlFor={`${id}-merchant`} hint="A Transaction's note, exactly">
					<Input
						id={`${id}-merchant`}
						value={merchant}
						onChange={(e) => setMerchant(e.target.value)}
						placeholder="Costco"
					/>
				</Field>
				<Field label="At least" htmlFor={`${id}-min`} hint="Whole dollars">
					<Input
						id={`${id}-min`}
						inputMode="numeric"
						value={min}
						onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))}
						placeholder="0"
					/>
				</Field>
			</div>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={() =>
						onApply({
							buckets: undefined,
							member: undefined,
							account: undefined,
							merchant: undefined,
							min: undefined,
						})
					}
				>
					Clear all
				</Button>
				<Button type="submit">Apply</Button>
			</div>
		</form>
	);
}

function Breadcrumb({
	search,
	view,
	label,
}: {
	search: ReportSearch;
	view: keyof typeof VIEW_LABELS;
	label: (key: string) => string;
}) {
	const steps: { label: string; search?: Partial<ReportSearch> }[] = [
		{ label: VIEW_LABELS[view], search: { area: undefined, month: undefined } },
		...(search.area
			? [{ label: label(search.area), search: search.month ? { month: undefined } : undefined }]
			: []),
		...(search.month ? [{ label: monthLabel(search.month as MonthKey) }] : []),
	];
	return (
		<nav aria-label="Breadcrumb" className="animate-enter">
			<ol className="flex flex-wrap items-center gap-1 text-[13px]">
				{steps.map((step, i) => (
					<li key={step.label} className="flex items-center gap-1">
						{i > 0 ? (
							<ChevronRight aria-hidden="true" className="size-3.5 text-subtle-foreground" />
						) : null}
						{step.search ? (
							<Link
								from={Route.fullPath}
								search={(prev) => ({ ...prev, ...step.search })}
								resetScroll={false}
								className="rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
							>
								{step.label}
							</Link>
						) : (
							<span aria-current="page" className="px-1 py-0.5 font-medium">
								{step.label}
							</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

/** The page's shape while a Report loads: header, tabs, options, headline numbers and a chart. */
function ReportsPending() {
	return (
		<div role="status" aria-label="Loading" className="grid gap-4 animate-enter lg:gap-5">
			<div className="grid gap-2">
				<Skeleton className="h-3.5 w-16" />
				<Skeleton className="h-7 w-40 lg:h-8" />
			</div>
			<Skeleton className="h-9 w-full max-w-2xl rounded-xl" />
			<div className="flex gap-2">
				<Skeleton className="h-10 w-44 rounded-xl" />
				<Skeleton className="h-10 w-52 rounded-xl" />
				<Skeleton className="h-10 w-24 rounded-xl" />
			</div>
			<Card className="grid grid-cols-2 gap-6 p-(--card-pad) lg:grid-cols-5">
				{[0, 1, 2, 3, 4].map((i) => (
					<div key={i} className="grid gap-2">
						<Skeleton className="h-3.5 w-16" />
						<Skeleton className="h-7 w-24" />
					</div>
				))}
			</Card>
			<Card className="grid gap-4 p-(--card-pad)">
				<Skeleton className="h-4 w-40" />
				<div className="flex h-56 items-end gap-2">
					{[40, 65, 50, 80, 55, 70, 45, 90, 60, 75, 52, 68].map((h) => (
						<Skeleton
							key={h}
							className="flex-1 rounded-t-md rounded-b-none"
							style={{ height: `${h}%` }}
						/>
					))}
				</div>
			</Card>
		</div>
	);
}
