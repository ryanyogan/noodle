import {
	type BucketMonth,
	type BucketRecord,
	type BucketState,
	type MonthKey,
	monthOfDay,
	type PlanScope,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Meter } from "@noodle/ui/components/meter";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, useHydrated } from "@tanstack/react-router";
import { ChartColumn, ChevronLeft, Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { asBucketColor, availableParts } from "../../../buckets";
import { BucketDetails } from "../../../components/bucket-editor";
import { DateTile } from "../../../components/coming-up";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanHistoryList } from "../../../components/plan-history";
import { PlanAmountForm } from "../../../components/plan-scope-field";
import { AllowanceBars, ChartCard, TrendLines } from "../../../components/report-charts";
import { formatMoney, fullDay, monthName } from "../../../format";
import { usePlanChange, withAllowance, withoutBucket } from "../../../plan-changes";
import { bucketQuery, monthQuery, planHistoryQuery, useMonthState } from "../../../queries";
import { periodLabel, type ReportTable } from "../../../reports";
import { BUCKET_MONTHS } from "../../../server/buckets";
import { archiveBucket, setAllowance } from "../../../server/plan";
import { ulidSchema } from "../../../server/schemas";
import { type TransactionRow, transactionsQuery } from "../../../transactions";

/** Whether a Parent may see what's in a Bucket: any shared one, and their own Personal Allowance. */
const isOpenTo = (bucket: Pick<BucketRecord, "owner">, parentId: string) =>
	!bucket.owner || bucket.owner === parentId;

// A Bucket's page: this month and its Pace, its last year month by month, its Transactions this
// month and its allowance history, and everything about it the Plan doesn't set (name, colour,
// Rolling, order, archiving). The other Parent's Personal Allowance shows its totals only
// (ADR-0003): its Transactions are never fetched, and the server wouldn't return them anyway.
export const Route = createFileRoute("/_authed/_household/plan/buckets/$id")({
	loader: async ({ context, params }) => {
		if (!ulidSchema.safeParse(params.id).success) throw notFound();
		const data = await context.queryClient.ensureQueryData(bucketQuery(params.id));
		if (!data.bucket) throw notFound();
		const month = monthOfDay(data.asOf);
		await Promise.all([
			context.queryClient.ensureQueryData(monthQuery(month)),
			context.queryClient.ensureQueryData(planHistoryQuery(month, params.id)),
			isOpenTo(data.bucket, context.parentId)
				? context.queryClient.ensureInfiniteQueryData(
						transactionsQuery(month, { bucket: params.id }),
					)
				: null,
		]);
	},
	component: BucketPage,
});

/** How many of this month's Transactions the page lists before "See all". */
const RECENT_TRANSACTIONS = 5;

function BucketPage() {
	const { id } = Route.useParams();
	const { parentId } = Route.useRouteContext();
	const hydrated = useHydrated();
	const data = useSuspenseQuery(bucketQuery(id)).data;
	const month = monthOfDay(data.asOf);
	const state = useMonthState(month);
	const [editing, setEditing] = useState(false);
	const allowance = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; amountCents: number; scope: PlanScope }) =>
			setAllowance({ data }),
		apply: withAllowance,
	});
	// Owned here: archiving takes the Bucket out of this month, and with it the Edit sheet.
	const archive = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey }) => archiveBucket({ data }),
		apply: withoutBucket,
	});
	const back = <BackToBuckets month={month} />;
	const record = data.bucket;
	// A Bucket only goes away if another Parent's change removes it; the loader 404s on reload.
	if (!record) return <PageHeader eyebrow="Bucket" title="Bucket" leading={back} />;
	// This month's Bucket, with any edit not saved yet; none once it's archived (or not started).
	const current = state.buckets.find((b) => b.id === id);
	const open = isOpenTo(record, parentId);
	const personal = Boolean(record.owner);
	const archived = !current && record.fromMonth <= month;
	const shared = state.buckets.filter((b) => b.owner === undefined).map((b) => b.id);
	return (
		<>
			<PageHeader
				eyebrow={personal ? "Personal Allowance" : archived ? "Archived Bucket" : "Bucket"}
				title={current?.name ?? record.name}
				leading={back}
				actions={
					current && open && state.editable ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!hydrated}
							onClick={() => setEditing(true)}
						>
							<Pencil />
							Edit
						</Button>
					) : undefined
				}
			/>
			<div className="grid max-w-2xl gap-8">
				<SaveFailed change={allowance} />
				<SaveFailed change={archive} />
				{current ? (
					<ThisMonth bucket={current} />
				) : (
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						{archived
							? `It left the Plan${record.archivedFromMonth ? ` from ${monthName(record.archivedFromMonth)} on` : ""}. Earlier months keep it.`
							: `It joins the Plan in ${monthName(record.fromMonth)}.`}
					</Card>
				)}
				<History months={data.months} color={current?.color ?? record.color} />
				{open ? (
					<BucketTransactions month={month} bucketId={id} />
				) : (
					<Section aria-labelledby="bucket-transactions">
						<SectionHeader id="bucket-transactions" title="Transactions" />
						<Card className="p-(--card-pad) text-sm text-muted-foreground">
							It’s a Personal Allowance: only its Parent sees what’s spent from it.
						</Card>
					</Section>
				)}
				<Section aria-labelledby="allowance-history">
					<SectionHeader id="allowance-history" title="Allowance history" />
					<PlanHistoryList month={month} targetId={id} />
				</Section>
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-(--card-pad) py-2.5 text-[13px] text-muted-foreground">
					<p className="py-1">Its Plan vs actual, over any period.</p>
					<Button variant="outline" size="sm" asChild>
						<Link to="/reports" search={{ view: "plan", period: "12m", buckets: [id] }}>
							<ChartColumn />
							See in Reports
						</Link>
					</Button>
				</div>
			</div>
			<Sheet open={editing && current !== undefined} onOpenChange={setEditing}>
				{editing && current ? (
					<SheetContent>
						<SheetHeader
							title={current.name}
							description={personal ? "Personal Allowance" : "Bucket"}
						/>
						<PlanAmountForm
							month={month}
							label="Allowance"
							value={current.allowance}
							onSave={(amountCents, scope) => {
								setEditing(false);
								if (amountCents !== current.allowance) {
									allowance.mutate({ bucketId: id, month, amountCents, scope });
								}
							}}
						/>
						<BucketDetails
							month={month}
							bucket={current}
							order={personal ? [id] : shared}
							index={personal ? 0 : shared.indexOf(id)}
							onArchive={(bucketId) => {
								setEditing(false);
								archive.mutate({ bucketId, month });
							}}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</>
	);
}

function BackToBuckets({ month }: { month: MonthKey }) {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/plan/$month/buckets" params={{ month }} aria-label="Back to Buckets">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
}

/** What's left of what it has this month, where that came from, and its Pace. */
function ThisMonth({ bucket }: { bucket: BucketState }) {
	const parts = availableParts(bucket);
	const share = (cents: number) => (bucket.available > 0 ? cents / bucket.available : 0);
	return (
		<Card role="region" aria-labelledby="bucket-this-month">
			<div className="grid gap-3 p-(--card-pad)">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id="bucket-this-month" className="text-[13px] font-medium text-muted-foreground">
						Left this month
					</h2>
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge>{bucket.rolling ? "Rolling" : "Fresh-start"}</Badge>
						{bucket.status === "over" ? (
							<Badge variant="over" dot>
								Over by {formatMoney(-bucket.left)}
							</Badge>
						) : bucket.status === "ahead" ? (
							<Badge variant="pace" dot>
								Ahead of Pace
							</Badge>
						) : (
							<Badge dot>On Pace</Badge>
						)}
					</div>
				</div>
				<p className="flex flex-wrap items-baseline gap-x-2">
					<span className="text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums">
						{formatMoney(Math.max(0, bucket.left))}
					</span>
					<span className="text-sm text-muted-foreground tabular-nums">
						of {formatMoney(bucket.available)}
					</span>
				</p>
				<Meter
					bucket={asBucketColor(bucket.color)}
					left={share(bucket.left)}
					paceLeft={bucket.pace.leftShare}
					over={bucket.status === "over"}
				/>
				{parts ? <p className="text-xs text-muted-foreground tabular-nums">{parts}</p> : null}
			</div>
			<dl className="grid grid-cols-2 border-t sm:grid-cols-3">
				<Stat label="Spent" value={formatMoney(bucket.spent)} />
				<Stat label="Pace by today" value={formatMoney(bucket.pace.spent)} />
				<Stat label="Allowance" value={formatMoney(bucket.allowance)} />
			</dl>
		</Card>
	);
}

/** Its last year: spent against allowance each month and, while it was Rolling, its balance. */
function History({ months, color }: { months: BucketMonth[]; color: number }) {
	const hydrated = useHydrated();
	// From the first month it was in the Plan, so a new Bucket doesn't open on empty months.
	const first = months.findIndex((m) => m.inPlan);
	const shown = first < 0 ? [] : months.slice(first);
	if (shown.length === 0) return null;
	const rolling = shown.some((m) => m.rolling);
	const table: ReportTable = {
		title: "Spent vs allowance",
		columns: [
			{ label: "Month", kind: "text" },
			{ label: "Allowance", kind: "money" },
			{ label: "Spent", kind: "money" },
			{ label: rolling ? "Balance" : "Left", kind: "money" },
		],
		rows: shown.map((m) => [periodLabel(m.month, "long"), m.allowance, m.spent, m.left]),
	};
	const chart = (node: ReactNode, height: string) =>
		hydrated ? node : <Skeleton className={`${height} w-full rounded-lg`} />;
	return (
		<>
			<ChartCard
				title="Spent vs allowance"
				description={`The last ${Math.min(shown.length, BUCKET_MONTHS)} months`}
				table={table}
			>
				{chart(
					<AllowanceBars
						labelOf={periodLabel}
						rows={shown.map((m) => ({
							period: m.month,
							allowance: m.allowance,
							spent: m.spent,
							over: m.left < 0,
						}))}
					/>,
					"h-52",
				)}
			</ChartCard>
			{rolling ? (
				<ChartCard
					title="Rolling balance"
					description="What it had left at each month’s end, carried into the next"
					table={{
						title: "Rolling balance",
						columns: [
							{ label: "Month", kind: "text" },
							{ label: "Balance", kind: "money" },
						],
						rows: shown.map((m) => [periodLabel(m.month, "long"), m.rolling ? m.left : null]),
					}}
				>
					{chart(
						<TrendLines
							labelOf={periodLabel}
							rows={shown.map((m) => ({ period: m.month, balance: m.rolling ? m.left : null }))}
							series={[{ key: "balance", label: "Balance", color: `var(--bucket-${color})` }]}
						/>,
						"h-48",
					)}
				</ChartCard>
			) : null}
		</>
	);
}

/** This month's Transactions in the Bucket, newest first; the Transactions list has the rest. */
function BucketTransactions({ month, bucketId }: { month: MonthKey; bucketId: string }) {
	const list = useSuspenseInfiniteQuery(transactionsQuery(month, { bucket: bucketId })).data;
	const all = list.pages.flatMap((p) => p.transactions);
	const more = all.length > RECENT_TRANSACTIONS || list.pages.at(-1)?.next != null;
	const shown = all.slice(0, RECENT_TRANSACTIONS);
	return (
		<Section aria-labelledby="bucket-transactions">
			<SectionHeader
				id="bucket-transactions"
				title={`Transactions in ${monthName(month)}`}
				action={
					shown.length > 0 ? (
						<Button variant="ghost" size="sm" asChild>
							<Link to="/transactions/$month" params={{ month }} search={{ bucket: bucketId }}>
								{more ? "See all" : "In Transactions"}
							</Link>
						</Button>
					) : undefined
				}
			/>
			{shown.length > 0 ? (
				<List>
					{shown.map((t) => (
						<TransactionLine key={t.id} transaction={t} bucketId={bucketId} />
					))}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					Nothing spent from it yet this month.
				</Card>
			)}
		</Section>
	);
}

function TransactionLine({
	transaction,
	bucketId,
}: {
	transaction: TransactionRow;
	bucketId: string;
}) {
	const split = transaction.splits.length > 0;
	// A split Transaction counts here only for its Splits in this Bucket.
	const amount = split
		? transaction.splits
				.filter((s) => s.bucketId === bucketId)
				.reduce((sum, s) => sum + s.amountCents, 0)
		: transaction.amountCents;
	const title = transaction.note || (transaction.importedFrom ? "Imported" : "Quick Add");
	const meta = [
		split ? `Part of ${formatMoney(transaction.amountCents)}` : null,
		transaction.importedFrom,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<ListRow
			aria-label={`${title}, ${fullDay(transaction.date)}, ${formatMoney(amount)}`}
			leading={<DateTile date={transaction.date} />}
			title={title}
			meta={meta || undefined}
			trailing={<span className="text-sm font-medium tabular-nums">{formatMoney(amount)}</span>}
		/>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-0.5 border-l px-(--card-pad) py-3 first:border-l-0 max-sm:last:col-span-2 max-sm:last:border-t max-sm:last:border-l-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="text-sm font-semibold tabular-nums">{value}</dd>
		</div>
	);
}
