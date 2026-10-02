import { canAssign } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect } from "react";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { TransactionBody } from "../../../components/transaction-editor";
import { dayName } from "../../../format";
import { membersQuery, monthQuery } from "../../../queries";
import { transactionLabel, transactionsQuery, useTransactionChange } from "../../../transactions";

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
	// The list's own filters and order: the Transaction is read from the rows it has loaded.
	const filters = list.useLoaderDeps();
	const navigate = Route.useNavigate();
	const data = useSuspenseQuery(monthQuery(month)).data;
	// The other Parent's Personal Allowance isn't this Parent's to assign to.
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	const members = useSuspenseQuery(membersQuery()).data;
	const loaded = useSuspenseInfiniteQuery(transactionsQuery(month, filters)).data.pages.flatMap(
		(page) => page.transactions,
	);
	const transaction = loaded.find((row) => row.id === transactionId);
	const change = useTransactionChange();
	// Back to the list alone: it stays where it was scrolled to, and focus returns to the row, as
	// it does when a sheet closes.
	const close = useCallback(() => {
		document.querySelector<HTMLElement>('[data-slot="list-row"] > button[aria-current]')?.focus();
		void navigate({
			to: "/transactions/$month",
			params: { month },
			search: true,
			resetScroll: false,
		});
	}, [navigate, month]);
	// Esc closes the pane as it closes the sheet, unless a menu, picker or dialog is open to take it.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector("[role=dialog],[role=alertdialog],[role=listbox],[role=menu]")) {
				return;
			}
			close();
		};
		// Before a picker's own Esc handler runs, while it is still in the page.
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [close]);
	const back = (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label="Back to Transactions"
			onClick={close}
		>
			<ChevronLeft className="size-5" />
		</Button>
	);
	if (!transaction) {
		return (
			<Card className="p-(--card-pad)">
				<DetailHeader title="Transaction" leading={back} />
				<p className="text-sm text-muted-foreground">
					This Transaction isn’t in the list as it stands. It may be further down, left out by the
					filters, or deleted.
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
						title={title}
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
