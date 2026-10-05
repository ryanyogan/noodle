import {
	addDays,
	addMonths,
	type DayKey,
	duesBetween,
	type MonthKey,
	matchCharges,
	monthlyEquivalent,
	yearlyCost,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DetailColumns } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Stat, StatGrid } from "@noodle/ui/components/stat";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, notFound, useHydrated } from "@tanstack/react-router";
import { ChevronLeft, Pencil } from "lucide-react";
import { useState } from "react";
import { termsSchedule } from "../../../commitments";
import { DateTile, dueDay, dueStatus } from "../../../components/coming-up";
import { CommitmentSheet, useCommitmentChanges } from "../../../components/commitment-editor";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { PlanHistoryList } from "../../../components/plan-history";
import { formatMoney, fullDay, monthName } from "../../../format";
import { commitmentsQuery, goalsQuery, planHistoryQuery, useMonthState } from "../../../queries";
import { COMMITMENT_MONTHS, type CommitmentsData } from "../../../server/commitments";

// A Commitment's page: what it costs, when it's next due, the charges that paid it, when it ends
// and how its terms changed. Everything comes from the one Commitments query Coming up reads.
export const Route = createFileRoute("/_authed/_household/plan/$month/commitments/$id")({
	loader: async ({ context, params }) => {
		const { queryClient } = context;
		const has = (data: CommitmentsData) => data.commitments.some((c) => c.id === params.id);
		if (!has(await queryClient.ensureQueryData(commitmentsQuery()))) {
			// A Commitment shows in the list the moment it's added, before its save lands: wait for
			// the saves going out, then ask again before calling it gone.
			await new Promise<void>((resolve) => {
				if (queryClient.isMutating() === 0) return resolve();
				const stop = queryClient.getMutationCache().subscribe(() => {
					if (queryClient.isMutating() > 0) return;
					stop();
					resolve();
				});
			});
			if (!has(await queryClient.fetchQuery(commitmentsQuery()))) throw notFound();
		}
		await Promise.all([
			context.queryClient.ensureQueryData(planHistoryQuery(context.month, params.id)),
			// The card or loan it pays down, and what's still owed on it.
			context.queryClient.ensureQueryData(goalsQuery()),
		]);
	},
	pendingComponent: DetailPending,
	component: CommitmentPage,
});

/** How many of its next due dates a Commitment's page lists. */
const NEXT_DUES = 4;

function CommitmentPage() {
	const { id } = Route.useParams();
	const hydrated = useHydrated();
	const data = useSuspenseQuery(commitmentsQuery()).data;
	const accounts = useSuspenseQuery(goalsQuery()).data;
	const { month } = Route.useRouteContext();
	const inPlan = useMonthState(month).commitments;
	// The list's order: due this month first.
	const order = [
		...inPlan.filter((c) => c.dueDates.length > 0),
		...inPlan.filter((c) => c.dueDates.length === 0),
	].map((c) => c.id);
	const [editing, setEditing] = useState(false);
	// Owned here: ending it closes the sheet, which must not take a failure with it.
	const changes = useCommitmentChanges(month);
	const commitment = data.commitments.find((c) => c.id === id);
	const back = <BackToCommitments month={month} />;
	// A Commitment only goes away if another Parent's change removes it; the loader 404s on reload.
	if (!commitment)
		return <DetailHeader inPanel eyebrow="Commitment" title="Commitment" leading={back} />;
	const terms = currentTerms(data, id, month);
	const ended = commitment.endedFromMonth !== null && commitment.endedFromMonth <= month;
	const hasCharges = matchCharges(data, id, data.charges).length > 0;
	// The card or loan it pays down (ADR-0050); one archived since is named, with nothing to open.
	const paysDownId = commitment.accountId ?? null;
	const paysDown = accounts.accounts.find((a) => a.id === paysDownId) ?? null;
	const paysDownName =
		paysDown?.name ?? accounts.archivedAccounts.find((a) => a.id === paysDownId)?.name ?? null;
	const nextDues = (
		<div className="min-w-0 @max-3xl/detail:order-1">
			<NextDues data={data} id={id} ended={ended} />
		</div>
	);
	const charges = (
		<div className="min-w-0 @max-3xl/detail:order-2">
			<Charges data={data} id={id} month={month} payments={paysDownId !== null} />
		</div>
	);
	return (
		<>
			<DetailHeader
				inPanel
				pager={
					<DetailPager
						ids={order}
						id={id}
						noun="Commitment"
						link={(to) =>
							linkOptions({ to: "/plan/$month/commitments/$id", params: { month, id: to } })
						}
					/>
				}
				eyebrow={ended ? "Ended Commitment" : "Commitment"}
				title={commitment.name}
				leading={back}
				actions={
					terms && !ended ? (
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
			{terms && !ended ? (
				<CommitmentSheet
					month={month}
					commitment={{
						id,
						name: commitment.name,
						amount: terms.amount,
						cadence: terms.cadence,
						dueDate: terms.dueDate,
						accountId: commitment.accountId,
						carriedBalance: commitment.carriedBalance,
					}}
					open={editing}
					onOpenChange={setEditing}
					changes={changes}
				/>
			) : null}
			{changes.failed ? <div className="mb-8">{changes.failed}</div> : null}
			{/* The cost across the top. Beneath it, in a pane wide enough, two columns that both start
			    with a heading: Charges beside Next due and Terms history. With no Charges yet, their note
			    goes under Next due, so no column is left nearly empty (#73). Phones keep the reading
			    order: the cost, Next due, Charges, Terms history. */}
			<DetailColumns className="gap-8">
				{terms ? (
					<Card role="region" aria-labelledby="commitment-cost" className="col-span-full">
						<div className="grid gap-1 p-(--card-pad)">
							<h2 id="commitment-cost" className="text-[13px] font-medium text-muted-foreground">
								{ended ? "What it cost a year" : "Cost a year"}
							</h2>
							<p className="flex flex-wrap items-baseline gap-x-2">
								<span className="text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums">
									{formatMoney(yearlyCost(terms))}
								</span>
								<span className="text-sm text-muted-foreground tabular-nums">
									{terms.cadence === "monthly" ? "" : "about "}
									{formatMoney(monthlyEquivalent(terms))} a month
								</span>
							</p>
						</div>
						<StatGrid layout="ruled" wrapLast className="grid-cols-2 @md:grid-cols-3">
							<Stat label="Each payment" value={formatMoney(terms.amount)} />
							<Stat label="Schedule" value={termsSchedule(terms)} />
							<Stat
								label={ended ? "Ended" : "Ends"}
								value={
									commitment.endedFromMonth === null
										? "No end date"
										: ended
											? lastMonthText(addMonths(commitment.endedFromMonth, -1))
											: `After ${lastMonthText(addMonths(commitment.endedFromMonth, -1))}`
								}
							/>
						</StatGrid>
						{paysDownName !== null ? (
							// Its own strip, one figure wide: it reads the same on a phone and in the narrow panel.
							<StatGrid layout="ruled" className="grid-cols-1">
								<Stat
									label="Still owed"
									value={
										paysDown ? (
											<Link
												to="/accounts/$accountId"
												params={{ accountId: paysDown.id }}
												aria-label={
													paysDown.owed === null
														? `Add what’s owed on ${paysDown.name}`
														: `Still owed ${formatMoney(Math.max(0, paysDown.owed))} on ${paysDown.name}`
												}
												className="inline-flex items-center underline underline-offset-3 max-lg:min-h-11"
											>
												{paysDown.owed === null
													? "Add what’s owed"
													: formatMoney(Math.max(0, paysDown.owed))}
											</Link>
										) : (
											"—"
										)
									}
									note={
										paysDown === null
											? `Pays down ${paysDownName}, which is archived.`
											: paysDown.bankConnectionId !== null
												? `Pays down ${paysDownName}. Its bank keeps what’s owed up to date.`
												: `Pays down ${paysDownName}. Each payment filed here brings it down.`
									}
								/>
							</StatGrid>
						) : null}
						{ended ? null : (
							<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-(--card-pad) py-2.5 text-[13px] text-muted-foreground">
								<p className="py-1">Try it in Explore: nothing in the Plan changes.</p>
								<Button variant="outline" size="sm" asChild>
									<Link to="/explore" search={{ lever: `end-commitment:${id}` }}>
										See what ending it frees up
									</Link>
								</Button>
							</div>
						)}
					</Card>
				) : null}
				<div className="grid min-w-0 gap-8 @max-3xl/detail:contents">
					{hasCharges ? charges : nextDues}
					{hasCharges ? null : charges}
				</div>
				<div className="grid min-w-0 gap-8 @max-3xl/detail:contents">
					{hasCharges ? nextDues : null}
					<Section aria-labelledby="terms-history" className="min-w-0 @max-3xl/detail:order-3">
						<SectionHeader id="terms-history" title="Terms history" />
						<PlanHistoryList month={month} targetId={id} />
					</Section>
				</div>
			</DetailColumns>
		</>
	);
}

function BackToCommitments({ month }: { month: MonthKey }) {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/plan/$month/commitments" params={{ month }} aria-label="Back to Commitments">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
}

/** The terms in force this month, or, for one not started yet, the ones it starts with. */
function currentTerms(data: CommitmentsData, id: string, month: MonthKey) {
	const own = data.commitmentTerms
		.filter((t) => t.commitmentId === id)
		.sort((a, b) => (a.month < b.month ? 1 : -1));
	return own.find((t) => t.month <= month) ?? own.at(-1);
}

/** "Fri, Oct 2" this year, "Mar 15, 2027" in another. */
const dayText = (date: DayKey, today: DayKey) =>
	date.slice(0, 4) === today.slice(0, 4) ? dueDay(date, today) : fullDay(date);

function NextDues({ data, id, ended }: { data: CommitmentsData; id: string; ended: boolean }) {
	const dues = duesBetween(data, data.charges, data.asOf, addDays(data.asOf, 365))
		.filter((d) => d.commitmentId === id)
		.slice(0, NEXT_DUES);
	return (
		<Section aria-labelledby="next-due">
			<SectionHeader id="next-due" title="Next due" />
			{dues.length > 0 ? (
				<List>
					{dues.map((due) => {
						const status = dueStatus(due);
						const day = dayText(due.date, data.asOf);
						return (
							<ListRow
								key={due.date}
								aria-label={`Due ${day}, ${formatMoney(due.amount)}${status ? `, ${status}` : ""}`}
								leading={<DateTile date={due.date} />}
								title={day}
								meta={
									status ? (
										<Badge variant={due.status === "paid" ? "default" : "pace"} dot>
											{status}
										</Badge>
									) : undefined
								}
								trailing={
									<span className="text-sm font-medium tabular-nums">
										{formatMoney(due.amount)}
									</span>
								}
							/>
						);
					})}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					{ended ? "It’s no longer due." : "It isn’t due in the next year."}
				</Card>
			)}
		</Section>
	);
}

function Charges({
	data,
	id,
	month,
	payments,
}: {
	data: CommitmentsData;
	id: string;
	month: MonthKey;
	/** It pays down a card or loan: what's filed in it are payments, and the month's are counted. */
	payments: boolean;
}) {
	const charges = matchCharges(data, id, data.charges);
	const inMonth = charges.filter((charge) => charge.date.slice(0, 7) === month);
	return (
		<Section aria-labelledby="charges">
			<SectionHeader
				id="charges"
				title={payments ? "Payments" : "Charges"}
				count={charges.length}
				action={
					<span className="text-[13px] text-muted-foreground">Last {COMMITMENT_MONTHS} months</span>
				}
			/>
			{payments && inMonth.length > 0 ? (
				<p className="px-1 text-[13px] text-muted-foreground">
					{inMonth.length === 1 ? "1 payment" : `${inMonth.length} payments`}{" "}
					{month === data.asOf.slice(0, 7) ? "this month" : `in ${monthName(month)}`},{" "}
					{formatMoney(inMonth.reduce((sum, charge) => sum + charge.amount, 0))} in all.
				</p>
			) : null}
			{charges.length > 0 ? (
				// A table from sm (#47): one line a Charge, its due and paid days side by side. On phones a
				// list (#48): the day it was paid and its amount, and the due day and status only when they
				// say something (paid late, on another day, or not scheduled).
				<Card className="overflow-hidden py-0">
					<ul className="divide-y divide-border sm:hidden">
						{charges.map((charge) => {
							const due = charge.dueDate ? dayText(charge.dueDate, data.asOf) : null;
							const paid = dayText(charge.date, data.asOf);
							const note =
								charge.onTime === null
									? "Not scheduled"
									: due !== null && (charge.onTime === false || due !== paid)
										? `Due ${due}`
										: null;
							return (
								<li key={charge.id} className="grid gap-0.5 px-4 py-3 text-sm">
									<div className="flex items-baseline justify-between gap-3">
										<span>Paid {paid}</span>
										<span className="font-medium tabular-nums">{formatMoney(charge.amount)}</span>
									</div>
									{note !== null || charge.onTime === false ? (
										<div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
											{note}
											{charge.onTime === false ? (
												<Badge variant="pace" dot>
													Late
												</Badge>
											) : null}
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
					<Table className="max-sm:hidden">
						<TableCaption className="sr-only">
							{payments ? "Payments" : "Charges"} in the last {COMMITMENT_MONTHS} months
						</TableCaption>
						<TableHeader>
							<TableRow>
								<TableHead className="first:ps-4">Due</TableHead>
								<TableHead>Paid</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="last:pe-4 text-end">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{charges.map((charge) => (
								<TableRow key={charge.id}>
									<TableCell className="first:ps-4 text-muted-foreground">
										{charge.dueDate ? dayText(charge.dueDate, data.asOf) : "—"}
									</TableCell>
									<TableCell>{dayText(charge.date, data.asOf)}</TableCell>
									<TableCell>
										{charge.onTime === false ? (
											<Badge variant="pace" dot>
												Late
											</Badge>
										) : charge.onTime === null ? (
											<span className="text-muted-foreground">Not scheduled</span>
										) : (
											<span className="text-subtle-foreground">
												{charge.dueDate === charge.date
													? "Paid on the due date"
													: "Paid before it was due"}
											</span>
										)}
									</TableCell>
									<TableCell className="last:pe-4 text-end font-medium tabular-nums">
										{formatMoney(charge.amount)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Card>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					Nothing has been paid toward it in the last {COMMITMENT_MONTHS} months.
				</Card>
			)}
		</Section>
	);
}

/** "July 2026": the last month a Commitment is (or was) in the Plan. */
const lastMonthText = (month: MonthKey) => `${monthName(month)} ${month.slice(0, 4)}`;
