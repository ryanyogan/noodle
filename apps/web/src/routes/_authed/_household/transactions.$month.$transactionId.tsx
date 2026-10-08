import { canAssign } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, Navigate } from "@tanstack/react-router";
import { ChevronLeft, X } from "lucide-react";
import { useCallback, useContext } from "react";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { MoneyInBody, type MoneyInTableRow } from "../../../components/money-in-editor";
import { OwedBackOnPurchase } from "../../../components/owed-back";
import { TransactionBody } from "../../../components/transaction-editor";
import { dayName } from "../../../format";
import { membersQuery, monthQuery } from "../../../queries";
import { ShownFilters } from "../../../transaction-filters-shown";
import { animateTransactionClose } from "../../../transaction-motion";
import {
	dateChange,
	monthOfTransaction,
	nameOf,
	transactionLabel,
	transactionQuery,
	transactionsQuery,
	useTransactionChange,
} from "../../../transactions";

const list = getRouteApi("/_authed/_household/transactions/$month");

// Under its row the editor is part of the table: the table's card is its card (issue 99).
const inTable =
	// Below lg nothing is clipped, so the editor's actions can stay in view while the page scrolls.
	"p-(--card-pad) max-lg:overflow-visible lg:[[data-open-place]_&]:rounded-none lg:[[data-open-place]_&]:border-0 lg:[[data-open-place]_&]:bg-transparent lg:[[data-open-place]_&]:p-0 lg:[[data-open-place]_&]:shadow-none";

/**
 * A Transaction in its month's list (#67, issue 99): from lg its editor opens in place, under its
 * row in the table, which keeps its columns and its place; below lg it is a page with Back, which
 * a tap on a row opens too, sliding in from the right (ADR-0024, 2026-10-08).
 */
export const Route = createFileRoute("/_authed/_household/transactions/$month/$transactionId")({
	pendingComponent: DetailPending,
	component: TransactionPane,
});

function TransactionPane() {
	const { transactionId } = Route.useParams();
	const { month, parentId } = Route.useRouteContext();
	// The list's own filters and order: the Transaction is read from the rows it has loaded, and
	// asked for by its ID when it isn't among them (further down, or left out by the filters).
	// The ones the list is SHOWING, not the ones just asked for: after a search or filter change
	// the list keeps its rows until the new ones arrive, and so does this (issue 129).
	const asked = list.useLoaderDeps();
	const filters = useContext(ShownFilters) ?? asked;
	const navigate = Route.useNavigate();
	const members = useSuspenseQuery(membersQuery()).data;
	const loaded = useSuspenseInfiniteQuery(transactionsQuery(month, filters)).data.pages.flatMap(
		(page) => page.transactions,
	);
	const listed = loaded.find((row) => row.id === transactionId);
	const one = useQuery({ ...transactionQuery(month, transactionId), enabled: !listed });
	const transaction = listed ?? one.data ?? undefined;
	// In a list of more than a month (issue 99) a row of another month opens where it is, against
	// its own month's Plan: the Buckets it can be filed in are that month's.
	const ranged = Boolean(filters.range);
	const planMonth = ranged && transaction ? monthOfTransaction(transaction) : month;
	const data = useSuspenseQuery(monthQuery(planMonth)).data;
	// The other Parent's Personal Allowance isn't this Parent's to assign to.
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	const change = useTransactionChange();
	// Back to the list alone, by its address rather than by going Back, so it works when this
	// address was the first one opened: the list stays where it was scrolled to, and focus returns
	// to the row, as it does when a sheet closes. Esc does the same from the list's route.
	const leave = useCallback(
		() =>
			void navigate({
				to: "/transactions/$month",
				params: { month },
				search: true,
				resetScroll: false,
			}),
		[navigate, month],
	);
	const close = useCallback(() => {
		document.querySelector<HTMLElement>('[data-slot="list-row"] button[aria-current]')?.focus();
		animateTransactionClose(leave);
	}, [leave]);
	// A link, as the other details' Back is: it works before the pane has hydrated.
	const back = (
		<Button variant="ghost" size="icon" asChild>
			<Link
				to="/transactions/$month"
				params={{ month }}
				search
				resetScroll={false}
				aria-label="Back to Transactions"
				onClick={() =>
					document
						.querySelector<HTMLElement>('[data-slot="list-row"] button[aria-current]')
						?.focus()
				}
			>
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
	// From lg the editor is under its row, which is right there: Close, at the end of the header
	// beside previous and next, instead of Back (issue 99). A link too, so it works before hydration.
	const closeLink = (
		<Button variant="ghost" size="icon" asChild className="max-lg:hidden">
			<Link
				to="/transactions/$month"
				params={{ month }}
				search
				resetScroll={false}
				aria-label="Close"
				onClick={(event) => {
					event.preventDefault();
					close();
				}}
			>
				<X className="size-5" />
			</Link>
		</Button>
	);
	if (!listed && one.isPending) return <DetailPending />;
	if (!transaction) {
		// Deleted, or not this Parent's to see: the two read the same (ADR-0003).
		return (
			<Card className={inTable}>
				<DetailHeader title="Transaction" leading={back} pager={closeLink} />
				<p className="text-sm text-muted-foreground">
					There’s no Transaction here. It may have been deleted.
				</p>
			</Card>
		);
	}
	// An address with another month's Transaction goes to its own month, whose Plan it's filed in.
	const itsMonth = monthOfTransaction(transaction);
	if (itsMonth !== month && !ranged) {
		return (
			<Navigate
				to="/transactions/$month/$transactionId"
				params={{ month: itsMonth, transactionId }}
				replace
			/>
		);
	}
	// Money in is a row of the same table (issue 152, ADR-0061), and opens where any row does.
	if (transaction.moneyIn) {
		const row = transaction as MoneyInTableRow;
		return (
			<Card className={inTable}>
				<MoneyInBody
					// Another line, or this one changed on another screen: the form starts again on it.
					key={`${row.id}:${row.version}`}
					row={row}
					today={data.asOf}
					heading={(title) => (
						<DetailHeader
							eyebrow={<span className="lg:hidden">{dayName(row.date, data.asOf)}</span>}
							title={
								<>
									<span className="max-[359px]:text-base lg:sr-only">{title}</span>
									<span className="max-lg:hidden">
										<span className="sr-only">: </span>
										{row.note?.trim() || "Money in"}
									</span>
								</>
							}
							leading={back}
							pager={
								<>
									<DetailPager
										ids={loaded.filter((one) => !one.goal).map((one) => one.id)}
										id={row.id}
										noun="Transaction"
										link={(id) => ({
											to: "/transactions/$month/$transactionId",
											params: { month, transactionId: id },
											search: true,
											resetScroll: false,
										})}
									/>
									{closeLink}
								</>
							}
						/>
					)}
					onClose={close}
					onLeave={(toMonth) => (ranged && toMonth ? close() : leave())}
				/>
			</Card>
		);
	}
	// Spending from a Goal is changed on its Goal, as its row in the list goes there.
	if (transaction.goal) {
		return (
			<Card className={inTable}>
				<DetailHeader title={transactionLabel(transaction)} leading={back} pager={closeLink} />
				<p className="text-sm text-muted-foreground">
					This was spent from{" "}
					<Link
						to="/goals/$goalId"
						params={{ goalId: transaction.goal.id }}
						className="underline underline-offset-4"
					>
						{transaction.goal.name}
					</Link>
					, and is changed there.
				</p>
			</Card>
		);
	}
	return (
		<Card className={inTable}>
			<TransactionBody
				paymentOptions
				inline
				wide
				transaction={transaction}
				today={data.asOf}
				plan={plan}
				members={members}
				parentId={parentId}
				heading={(title) => (
					<DetailHeader
						// A page of its own below lg says its day; under its row the row says it.
						eyebrow={<span className="lg:hidden">{dayName(transaction.date, data.asOf)}</span>}
						// Under 360 the title sits between Back and the arrows: a step smaller keeps it on one line.
						// From lg the title is the Transaction's name, as the region around it is named:
						// "Edit Transaction" is still said first, for a screen reader, but not drawn.
						title={
							<>
								<span className="max-[359px]:text-base lg:sr-only">{title}</span>
								<span className="max-lg:hidden">
									<span className="sr-only">: </span>
									{nameOf(transaction) || transactionLabel(transaction)}
								</span>
							</>
						}
						leading={back}
						pager={
							<>
								<DetailPager
									// Goal spending opens its Goal, not this pane.
									ids={loaded.filter((row) => !row.goal).map((row) => row.id)}
									id={transaction.id}
									noun="Transaction"
									link={(id) => ({
										to: "/transactions/$month/$transactionId",
										params: { month, transactionId: id },
										search: true,
										resetScroll: false,
									})}
								/>
								{closeLink}
							</>
						}
					/>
				)}
				onClose={close}
				onChange={(next) => {
					change.mutate({ transaction, label: transactionLabel(transaction), next });
					// Deleted: its row has left the list and this pane with it, so there is nothing to
					// close slowly. Staying at its address meanwhile would ask for it again by its ID.
					if (next === null) leave();
					else close();
				}}
				onDate={(date, alone) => {
					change.mutate(dateChange(transaction, date));
					// Dated out of the month shown: its row has left the list and this pane with it, as
					// a deleted one's does, so there is nothing to close slowly. A list of several months
					// keeps the row, on its new day.
					if (!ranged && date.slice(0, 7) !== monthOfTransaction(transaction)) leave();
					else if (alone) close();
				}}
			/>
			{/* Someone outside the Household paying part of it back (issue 132). */}
			<div className="[[data-slot=card]:has([data-payment-mode=true])_&]:hidden">
				<OwedBackOnPurchase transaction={transaction} members={members} />
			</div>
		</Card>
	);
}
