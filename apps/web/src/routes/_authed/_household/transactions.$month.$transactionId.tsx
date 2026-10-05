import { canAssign } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi, Link, Navigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useCallback } from "react";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { TransactionBody } from "../../../components/transaction-editor";
import { dayName } from "../../../format";
import { membersQuery, monthQuery } from "../../../queries";
import {
	monthOfTransaction,
	transactionLabel,
	transactionQuery,
	transactionsQuery,
	useTransactionChange,
} from "../../../transactions";

const list = getRouteApi("/_authed/_household/transactions/$month");

/**
 * A Transaction beside its month's list (#67): from lg its editor fills the right pane while the
 * list keeps its place; below lg it is a page with Back (a tap on a phone still opens the sheet).
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
	const filters = list.useLoaderDeps();
	const navigate = Route.useNavigate();
	const data = useSuspenseQuery(monthQuery(month)).data;
	// The other Parent's Personal Allowance isn't this Parent's to assign to.
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	const members = useSuspenseQuery(membersQuery()).data;
	const loaded = useSuspenseInfiniteQuery(transactionsQuery(month, filters)).data.pages.flatMap(
		(page) => page.transactions,
	);
	const listed = loaded.find((row) => row.id === transactionId);
	const one = useQuery({ ...transactionQuery(month, transactionId), enabled: !listed });
	const transaction = listed ?? one.data ?? undefined;
	const change = useTransactionChange();
	// Back to the list alone, by its address rather than by going Back, so it works when this
	// address was the first one opened: the list stays where it was scrolled to, and focus returns
	// to the row, as it does when a sheet closes. Esc does the same from the list's route.
	const close = useCallback(() => {
		document.querySelector<HTMLElement>('[data-slot="list-row"] button[aria-current]')?.focus();
		void navigate({
			to: "/transactions/$month",
			params: { month },
			search: true,
			resetScroll: false,
		});
	}, [navigate, month]);
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
	if (!listed && one.isPending) return <DetailPending />;
	if (!transaction) {
		// Deleted, or not this Parent's to see: the two read the same (ADR-0003).
		return (
			<Card className="p-(--card-pad)">
				<DetailHeader title="Transaction" leading={back} />
				<p className="text-sm text-muted-foreground">
					There’s no Transaction here. It may have been deleted.
				</p>
			</Card>
		);
	}
	// An address with another month's Transaction goes to its own month, whose Plan it's filed in.
	const itsMonth = monthOfTransaction(transaction);
	if (itsMonth !== month) {
		return (
			<Navigate
				to="/transactions/$month/$transactionId"
				params={{ month: itsMonth, transactionId }}
				replace
			/>
		);
	}
	// Spending from a Goal is changed on its Goal, as its row in the list goes there.
	if (transaction.goal) {
		return (
			<Card className="p-(--card-pad)">
				<DetailHeader title={transactionLabel(transaction)} leading={back} />
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
		<Card className="p-(--card-pad)">
			<TransactionBody
				inline
				transaction={transaction}
				today={data.asOf}
				plan={plan}
				members={members}
				parentId={parentId}
				heading={(title) => (
					<DetailHeader
						eyebrow={dayName(transaction.date, data.asOf)}
						// Under 360 the title sits between Back and the arrows: a step smaller keeps it on one line.
						title={<span className="max-[359px]:text-base">{title}</span>}
						leading={back}
						pager={
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
						}
					/>
				)}
				onClose={close}
				onChange={(next) => {
					change.mutate({ transaction, label: transactionLabel(transaction), next });
					close();
				}}
			/>
		</Card>
	);
}
