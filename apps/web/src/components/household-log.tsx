import { LOG_ITEM_KINDS, type LogCursor, type LogItemKind, type MonthKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { OptionSelect } from "@noodle/ui/components/select";
import type { TableSort } from "@noodle/ui/lib/data-table";
import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { History, X } from "lucide-react";
import { fullDay, monthName } from "../format";
import { logKey } from "../household-changes";
import { type DatedLogRow, getLog } from "../server/log";
import { describeChange, fromScenario, scopeText } from "./plan-history";
import { useParents } from "./whose-pay";

// The Log (issue 139): every change made to the Household, newest first, in one table in
// Household settings: when, who, what, the change (before → after) and the month it takes
// effect. It comes a page at a time from the server, already in order and with the other
// Parent's Personal Allowance masked there (ADR-0003, ADR-0051). Pages link to it with "See what
// changed" where they used to list the Plan's changes themselves.

/** The Log's section on Household settings: where "See what changed" lands. */
export const LOG_HASH = "log";

/** The Log's orders besides newest first, as the address says them. */
export const LOG_ORDERS = ["oldest", "who", "who-desc"] as const;
export type LogOrder = (typeof LOG_ORDERS)[number];

export type LogFilters = { month?: MonthKey; who?: string; kind?: LogItemKind; order?: LogOrder };

/** The table's order for an address: newest first when it names none. */
const sortOf = (order: LogOrder | undefined): TableSort =>
	order === "who" || order === "who-desc"
		? { id: "who", desc: order === "who-desc" }
		: { id: "when", desc: order !== "oldest" };

const orderOf = (sort: TableSort): LogOrder | undefined =>
	sort.id === "who" ? (sort.desc ? "who-desc" : "who") : sort.desc ? undefined : "oldest";

/**
 * The Log, a page at a time, in the order asked for: the server sorts, so the order holds across
 * pages. Under the months' key, so a change to the Plan made in another tab or by the other
 * Parent shows without a reload; a Rule, a snapshot, a Bank Connection or a Fresh start does
 * through the Household's live updates (`logKey` in household-changes.ts).
 */
export const logQuery = (filters: LogFilters) =>
	infiniteQueryOptions({
		queryKey: [
			...logKey,
			filters.month ?? null,
			filters.who ?? null,
			filters.kind ?? null,
			filters.order ?? null,
		],
		queryFn: ({ pageParam }) => {
			const sort = sortOf(filters.order);
			return getLog({
				data: {
					month: filters.month,
					who: filters.who,
					kind: filters.kind,
					sort: sort.id === "who" ? "who" : "when",
					desc: sort.desc,
					after: pageParam,
				},
			});
		},
		initialPageParam: undefined as LogCursor | undefined,
		getNextPageParam: (page) => page.next ?? undefined,
	});

const KIND_LABELS: Record<LogItemKind, string> = {
	"take-home-pay": "Take-home pay",
	bucket: "Buckets",
	commitment: "Bills",
	goal: "Goals",
	rule: "Rules",
	snapshot: "Snapshots",
	"fresh-start": "Fresh starts",
	"bank-connection": "Bank Connections",
};

/** What one of an item's kind is called, under its name. */
const KIND_NOUNS: Record<LogItemKind, string> = {
	"take-home-pay": "The Plan",
	bucket: "Bucket",
	commitment: "Bill",
	goal: "Goal",
	rule: "Rule",
	snapshot: "Your data",
	"fresh-start": "Your data",
	"bank-connection": "Bank Connection",
};

const SNAPSHOT_REASONS: Record<Extract<DatedLogRow, { source: "snapshot" }>["kind"], string> = {
	manual: "Taken by hand",
	"before-restore": "Taken before a snapshot was restored",
	"before-fresh-start": "Taken before a Fresh start",
	"before-delete": "Taken before the Household was to be deleted",
	"before-rule-apply": "Taken before a Rule was applied to past Transactions",
	"before-transactions-delete": "Taken before Transactions were deleted",
};

const FRESH_START_SAID: Record<Extract<DatedLogRow, { source: "fresh-start" }>["status"], string> =
	{
		scheduled: "Asked for · waiting to run",
		running: "Asked for · running",
		failed: "Asked for · it stopped part-way",
		done: "Done",
		cancelled: "Asked for · cancelled",
	};

/** The item a row is about. */
export function logWhat(row: DatedLogRow): string {
	switch (row.source) {
		case "plan":
			if (row.change.kind === "personal-allowance") return "Personal Allowance";
			return row.item === "take-home-pay"
				? "Take-home pay"
				: (row.change.targetName ?? "Removed item");
		case "rule":
			return `“${row.pattern}”`;
		case "snapshot":
			return "Snapshot";
		case "fresh-start":
			return "Fresh start";
		case "bank-connection":
			return row.institution ?? "A bank";
	}
}

/** What changed, before → after, in words. */
export function logChange(row: DatedLogRow): string {
	switch (row.source) {
		case "plan": {
			const scenario = fromScenario(row.change);
			return scenario ? `${describeChange(row.change)} · ${scenario}` : describeChange(row.change);
		}
		case "rule":
			return row.targetName ? `Rule made · files into ${row.targetName}` : "Rule made";
		case "snapshot":
			return row.note
				? `${SNAPSHOT_REASONS[row.kind]} · “${row.note}”`
				: SNAPSHOT_REASONS[row.kind];
		case "fresh-start":
			return FRESH_START_SAID[row.status];
		case "bank-connection":
			return row.disconnected ? "Connected · disconnected since" : "Connected";
	}
}

/** "From October on" for a Plan change; what else is in the Log holds from when it was made. */
export const logTakesEffect = (row: DatedLogRow): string =>
	row.source === "plan" ? scopeText(row.change) : "Right away";

const logWho = (row: DatedLogRow) => row.memberName ?? "Noodle";

const columns: DataTableColumn<DatedLogRow>[] = [
	{
		id: "when",
		header: "When",
		min: 6.5,
		width: "6.5rem",
		stacked: "value",
		sortable: { descFirst: true, said: { asc: "oldest first", desc: "newest first" } },
		className: "text-muted-foreground",
		cell: (row) => fullDay(row.day),
	},
	{
		id: "who",
		header: "Who",
		min: 5,
		width: "minmax(5rem,0.6fr)",
		stacked: "hidden",
		sortable: { said: { asc: "A to Z", desc: "Z to A" } },
		cell: logWho,
	},
	{
		id: "what",
		header: "What",
		min: 9,
		width: "minmax(0,1.2fr)",
		stacked: "title",
		cell: (row) => (
			<span className="grid min-w-0">
				<span className="min-w-0 font-medium break-words">{logWhat(row)}</span>
				<span className="text-[13px] text-muted-foreground">{KIND_NOUNS[row.item]}</span>
			</span>
		),
	},
	{
		id: "change",
		header: "Change",
		min: 11,
		width: "minmax(0,2fr)",
		stacked: "secondary",
		cell: (row) => <span className="min-w-0 break-words">{logChange(row)}</span>,
	},
	{
		id: "effect",
		header: "Takes effect",
		min: 8,
		width: "minmax(8rem,0.9fr)",
		stacked: "hidden",
		className: "text-muted-foreground",
		cell: logTakesEffect,
	},
	{
		// A phone has no columns: who and from when, on one line under the change.
		id: "meta",
		header: "Who and takes effect",
		min: 0,
		wide: false,
		stacked: "secondary",
		className: "text-[13px] text-muted-foreground",
		cell: (row) => `${logWho(row)} · ${logTakesEffect(row)}`,
	},
];

const ANYONE = "";
const ANYTHING = "";

/**
 * The Log's table with its filters. The filters are the page's address (`filters`), so a link
 * can open it narrowed to a month; `onFilter` asks the page for another address.
 */
export function HouseholdLog({
	filters,
	onFilter,
}: {
	filters: LogFilters;
	onFilter: (next: LogFilters) => void;
}) {
	const parents = useParents();
	const log = useInfiniteQuery(logQuery(filters));
	const rows = log.data?.pages.flatMap((page) => page.rows) ?? [];
	const narrowed = Boolean(filters.month || filters.who || filters.kind);
	return (
		<div className="grid min-w-0 gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<OptionSelect
					aria-label="Who made the change"
					size="sm"
					className="w-auto min-w-36"
					value={filters.who ?? ANYONE}
					onValueChange={(who) => onFilter({ ...filters, who: who || undefined })}
					choices={[
						{ value: ANYONE, label: "Everyone" },
						...parents.map((parent) => ({ value: parent.id, label: parent.name })),
					]}
				/>
				<OptionSelect
					aria-label="Kind of item"
					size="sm"
					className="w-auto min-w-44"
					value={filters.kind ?? ANYTHING}
					onValueChange={(kind) =>
						onFilter({ ...filters, kind: (kind || undefined) as LogItemKind | undefined })
					}
					choices={[
						{ value: ANYTHING, label: "Every kind" },
						...LOG_ITEM_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
					]}
				/>
				{filters.month ? (
					<Button
						variant="outline"
						size="sm"
						aria-label={`Takes effect in ${monthName(filters.month)}: show every month`}
						onClick={() => onFilter({ ...filters, month: undefined })}
					>
						Takes effect in {monthName(filters.month)}
						<X />
					</Button>
				) : null}
			</div>
			{log.isError ? (
				<p className="text-[13px] text-muted-foreground" role="alert">
					Couldn’t load the Log.
				</p>
			) : (
				<DataTable
					label="Log"
					columns={columns}
					data={rows}
					getRowId={(row) => row.key}
					sort={sortOf(filters.order)}
					onSortChange={(sort) => onFilter({ ...filters, order: orderOf(sort) })}
					loading={log.isPending}
					loadingRows={5}
					empty={
						<p className="px-(--card-pad) py-4 text-[13px] text-muted-foreground">
							{narrowed
								? "No changes match."
								: "Changes to the Plan, Rules, snapshots and Bank Connections will show here."}
						</p>
					}
				/>
			)}
			{log.hasNextPage ? (
				<Button
					variant="outline"
					size="sm"
					className="justify-self-start"
					disabled={log.isFetchingNextPage}
					onClick={() => log.fetchNextPage()}
				>
					{log.isFetchingNextPage ? "Loading…" : "Show older changes"}
				</Button>
			) : null}
		</div>
	);
}

/**
 * "See what changed": the one link a page shows where it used to list the Plan's changes, to the
 * Log, narrowed to the page's month when it has one.
 */
export function SeeWhatChanged({ month, className }: { month?: MonthKey; className?: string }) {
	return (
		<Button variant="ghost" size="sm" asChild className={className}>
			<Link to="/household" search={month ? { month } : {}} hash={LOG_HASH}>
				<History />
				See what changed
			</Link>
		</Button>
	);
}
