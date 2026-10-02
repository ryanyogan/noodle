import type { BucketMonth, BucketRecord, BucketState, MonthKey } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { FormError } from "@noodle/ui/components/field";
import { List } from "@noodle/ui/components/list";
import { Meter } from "@noodle/ui/components/meter";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { toast } from "@noodle/ui/components/toast";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, notFound, useHydrated } from "@tanstack/react-router";
import { ArchiveRestore, ChartColumn, ChevronLeft, Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { asBucketColor, availableParts } from "../../../buckets";
import { BucketSheet, useBucketChanges } from "../../../components/bucket-editor";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { PlanHistoryList } from "../../../components/plan-history";
import { PlanAmountForm } from "../../../components/plan-scope-field";
import { AllowanceBars, ChartCard, TrendLines } from "../../../components/report-charts";
import { TermHelp } from "../../../components/term-help";
import { EditTransactionSheet, TransactionItem } from "../../../components/transaction-list";
import { formatMoney, monthName } from "../../../format";
import {
	bucketQuery,
	membersQuery,
	monthQuery,
	planHistoryQuery,
	useMonthState,
} from "../../../queries";
import { periodLabel, type ReportTable } from "../../../reports";
import { BUCKET_MONTHS } from "../../../server/buckets";
import { restoreBucket } from "../../../server/plan";
import { ulidSchema } from "../../../server/schemas";
import { type TransactionRow, transactionsQuery } from "../../../transactions";

/** Whether a Parent may see what's in a Bucket: any shared one, and their own Personal Allowance. */
const isOpenTo = (bucket: Pick<BucketRecord, "owner">, parentId: string) =>
	!bucket.owner || bucket.owner === parentId;

// A Bucket's page: this month and its Pace, its last year month by month, its Transactions this
// month and its allowance history, and everything about it the Plan doesn't set (name, colour,
// carries over, order, archiving). The other Parent's Personal Allowance shows its totals only
// (ADR-0003): its Transactions are never fetched, and the server wouldn't return them anyway.
export const Route = createFileRoute("/_authed/_household/plan/$month/buckets/$id")({
	loader: async ({ context, params }) => {
		if (!ulidSchema.safeParse(params.id).success) throw notFound();
		const data = await context.queryClient.ensureQueryData(bucketQuery(params.id));
		if (!data.bucket) throw notFound();
		const month = context.month;
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
	pendingComponent: DetailPending,
	component: BucketPage,
});

/** How many of this month's Transactions the page lists before "See all". */
const RECENT_TRANSACTIONS = 5;

function BucketPage() {
	const { id } = Route.useParams();
	const { parentId, month } = Route.useRouteContext();
	const hydrated = useHydrated();
	const data = useSuspenseQuery(bucketQuery(id)).data;
	const state = useMonthState(month);
	const history = useQuery(planHistoryQuery(month, id)).data;
	const [editing, setEditing] = useState(false);
	const [restoring, setRestoring] = useState(false);
	// Owned here: archiving takes the Bucket out of this month, and with it the sheet.
	const changes = useBucketChanges(month);
	const back = <BackToBuckets month={month} />;
	const record = data.bucket;
	// A Bucket only goes away if another Parent's change removes it; the loader 404s on reload.
	if (!record) return <DetailHeader eyebrow="Bucket" title="Bucket" leading={back} />;
	// This month's Bucket, with any edit not saved yet; none once it's archived (or not started).
	const current = state.buckets.find((b) => b.id === id);
	const open = isOpenTo(record, parentId);
	const personal = Boolean(record.owner);
	const archived = !current && record.fromMonth <= month;
	const shared = state.buckets.filter((b) => b.owner === undefined).map((b) => b.id);
	// Its last allowance, to restore it with. A Bucket archived in the month it started was in no
	// month's Plan, so its Plan history (newest first) gives the amount it had.
	const lastAllowance =
		[...data.months].reverse().find((m) => m.inPlan)?.allowance ??
		history?.changes.find((c) => c.targetId === id && typeof c.after?.amount === "number")?.after
			?.amount ??
		null;
	return (
		<>
			<DetailHeader
				pager={
					<DetailPager
						ids={state.buckets.filter((b) => isOpenTo(b, parentId) || b.owner).map((b) => b.id)}
						id={id}
						noun="Bucket"
						link={(to) =>
							linkOptions({ to: "/plan/$month/buckets/$id", params: { month, id: to } })
						}
					/>
				}
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
					) : archived && !personal && state.editable ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!hydrated}
							onClick={() => setRestoring(true)}
						>
							<ArchiveRestore />
							Restore to the Plan
						</Button>
					) : undefined
				}
			/>
			{/* In a wide pane: this month and its Transactions on the left; how it's gone over time on the right.
			    On phones the two columns' parts interleave, in the order they always had. */}
			<div className="grid max-w-2xl gap-8 @3xl:max-w-none @3xl:grid-cols-2 @3xl:items-start @3xl:gap-6">
				<div className="@max-3xl:contents @3xl:grid @3xl:min-w-0 @3xl:gap-8">
					{changes.failed}
					{current ? (
						<ThisMonth bucket={current} />
					) : (
						<Card className="p-(--card-pad) text-sm text-muted-foreground">
							{archived
								? `It left the Plan${record.archivedFromMonth ? ` from ${monthName(record.archivedFromMonth)} on` : ""}. Earlier months keep it.`
								: `It joins the Plan in ${monthName(record.fromMonth)}.`}
						</Card>
					)}
					<div className="grid min-w-0 gap-8 @max-3xl:order-2">
						{open ? (
							<BucketTransactions
								month={month}
								bucketId={id}
								parentId={parentId}
								archived={archived}
							/>
						) : (
							<Section aria-labelledby="bucket-transactions">
								<SectionHeader id="bucket-transactions" title="Transactions" />
								<Card className="p-(--card-pad) text-sm text-muted-foreground">
									It’s a Personal Allowance: only its Parent sees what’s spent from it.
								</Card>
							</Section>
						)}
					</div>
				</div>
				<div className="@max-3xl:contents @3xl:grid @3xl:min-w-0 @3xl:gap-8">
					<div className="grid min-w-0 gap-8 @max-3xl:order-1">
						<History months={data.months} color={current?.color ?? record.color} />
					</div>
					<div className="grid min-w-0 gap-8 @max-3xl:order-3">
						<Section aria-labelledby="allowance-history">
							<SectionHeader id="allowance-history" title="Allowance history" />
							<PlanHistoryList month={month} targetId={id} />
						</Section>
						<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-(--card-pad) py-2.5 text-[13px] text-muted-foreground">
							<p className="py-1">Compare planned and spent for any period</p>
							<Button variant="outline" size="sm" asChild>
								<Link to="/reports" search={{ view: "plan", period: "12m", buckets: [id] }}>
									<ChartColumn />
									See in Reports
								</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
			{current ? (
				<BucketSheet
					month={month}
					bucket={current}
					order={personal ? [] : shared}
					open={editing}
					onOpenChange={setEditing}
					changes={changes}
				/>
			) : null}
			<RestoreSheet
				open={restoring}
				onOpenChange={setRestoring}
				month={month}
				bucketId={id}
				name={record.name}
				lastAllowance={lastAllowance}
			/>
		</>
	);
}

/**
 * Brings an archived Bucket back into the Plan from this month on, with an allowance (its last,
 * to start with). The months it was archived for stay at $0.
 */
function RestoreSheet({
	open,
	onOpenChange,
	month,
	bucketId,
	name,
	lastAllowance,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	month: MonthKey;
	bucketId: string;
	name: string;
	lastAllowance: number | null;
}) {
	const queryClient = useQueryClient();
	const restore = useMutation({
		mutationFn: (amountCents: number) => restoreBucket({ data: { bucketId, month, amountCents } }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: monthQuery(month).queryKey }),
				queryClient.invalidateQueries({ queryKey: bucketQuery(bucketId).queryKey }),
			]);
			toast(`${name} is back in the Plan from ${monthName(month)} on.`);
			onOpenChange(false);
		},
	});
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader
						title={`Restore ${name}`}
						description={`It comes back into the Plan from ${monthName(month)} on. The months it was archived stay as they were.`}
					/>
					<PlanAmountForm
						month={month}
						label="Allowance"
						value={lastAllowance}
						withScope={false}
						submitLabel="Restore to the Plan"
						onSave={(amountCents) => restore.mutate(amountCents)}
					/>
					{restore.isError ? (
						<FormError>Couldn’t restore it. Check your connection and try again.</FormError>
					) : null}
				</SheetContent>
			) : null}
		</Sheet>
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
						<Badge>{bucket.rolling ? "Carries over" : "Resets monthly"}</Badge>
						{bucket.status === "over" ? (
							<Badge variant="over" dot>
								Over by {formatMoney(-bucket.left)}
							</Badge>
						) : bucket.status === "ahead" ? (
							<Badge variant="pace" dot>
								Ahead of pace
							</Badge>
						) : (
							<Badge dot>On pace</Badge>
						)}
					</div>
				</div>
				<p className="flex flex-wrap items-baseline gap-x-2">
					<span className="text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums">
						{formatMoney(Math.max(0, bucket.left))}
					</span>
					{/* Below zero, "of −$1,035" says nothing: the parts beneath explain it instead. */}
					{bucket.available >= 0 ? (
						<span className="text-sm text-muted-foreground tabular-nums">
							of {formatMoney(bucket.available)}
						</span>
					) : null}
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
				<Stat
					label="Even spending by today"
					help={<TermHelp term="pace" />}
					value={formatMoney(bucket.pace.spent)}
				/>
				<Stat label="Planned this month" value={formatMoney(bucket.allowance)} />
			</dl>
		</Card>
	);
}

/** Its last year: spent against allowance each month and, while it carried over, its balance. */
function History({ months, color }: { months: BucketMonth[]; color: number }) {
	const hydrated = useHydrated();
	// Only the months it was in the Plan, so a new Bucket doesn't open on empty months and an
	// archived one doesn't end on them.
	const first = months.findIndex((m) => m.inPlan);
	const last = months.length - 1 - [...months].reverse().findIndex((m) => m.inPlan);
	const shown = first < 0 ? [] : months.slice(first, last + 1);
	if (shown.length === 0) return null;
	const carriesOver = shown.some((m) => m.rolling);
	const table: ReportTable = {
		title: "Spent vs allowance",
		columns: [
			{ label: "Month", kind: "text" },
			{ label: "Allowance", kind: "money" },
			{ label: "Spent", kind: "money" },
			{ label: carriesOver ? "Balance" : "Left", kind: "money" },
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
			{carriesOver ? (
				<ChartCard
					title="Carried over each month"
					description="What it had left at each month’s end, carried into the next"
					table={{
						title: "Carried over each month",
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

/**
 * This month's Transactions in the Bucket, newest first, each opening the editor as on
 * Transactions; the Transactions list has the rest.
 */
function BucketTransactions({
	month,
	bucketId,
	parentId,
	archived,
}: {
	month: MonthKey;
	bucketId: string;
	parentId: string;
	archived: boolean;
}) {
	const list = useSuspenseInfiniteQuery(transactionsQuery(month, { bucket: bucketId })).data;
	const { plan, asOf } = useSuspenseQuery(monthQuery(month)).data;
	const members = useQuery(membersQuery()).data ?? [];
	const [editing, setEditing] = useState<TransactionRow | null>(null);
	const shown = list.pages.flatMap((p) => p.transactions).slice(0, RECENT_TRANSACTIONS);
	return (
		<Section aria-labelledby="bucket-transactions">
			<SectionHeader
				id="bucket-transactions"
				title={`Transactions in ${monthName(month)}`}
				action={
					shown.length > 0 ? (
						<Button variant="ghost" size="sm" asChild>
							<Link to="/transactions/$month" params={{ month }} search={{ bucket: bucketId }}>
								All in Transactions
							</Link>
						</Button>
					) : undefined
				}
			/>
			{shown.length > 0 ? (
				<List aria-label={`Latest in ${monthName(month)}`}>
					{shown.map((transaction) => (
						<TransactionItem
							key={transaction.id}
							transaction={transaction}
							plan={plan}
							members={members}
							dated
							onEdit={setEditing}
						/>
					))}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					{archived
						? "It’s archived, so nothing goes into it."
						: "Nothing spent from it yet this month."}
				</Card>
			)}
			<EditTransactionSheet
				transaction={editing}
				today={asOf}
				parentId={parentId}
				onClose={() => setEditing(null)}
			/>
		</Section>
	);
}

function Stat({ label, value, help }: { label: string; value: string; help?: ReactNode }) {
	return (
		<div className="grid gap-0.5 border-l px-(--card-pad) py-3 first:border-l-0 max-sm:last:col-span-2 max-sm:last:border-t max-sm:last:border-l-0">
			<dt className="flex items-center gap-1 text-xs text-muted-foreground">
				{label}
				{help}
			</dt>
			<dd className="text-sm font-semibold tabular-nums">{value}</dd>
		</div>
	);
}
