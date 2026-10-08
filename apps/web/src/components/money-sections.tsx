import { looksLikeCardPayment, looksPersonToPerson, parentNamedIn } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ulid } from "ulid";
import { cardPaymentCardsQuery, cardPaymentIntro } from "../card-payments";
import { formatMoney, shortDay } from "../format";
import { membersQuery } from "../queries";
import type { TransactionRow } from "../transactions";
import {
	type MoneyPeer,
	moneyQuery,
	type RefundView,
	type TransferView,
	transferDetail,
	useMoneyChange,
} from "../transfers";
import { CardPaymentChoice } from "./card-payment";
import { betweenUsMeans, lowerFirst, parentNames } from "./review-between-us";

/**
 * Money back, or a side of a Transfer, in its detail: what it came in as, then its Transfer and
 * its Refund link. Neither counts anywhere until a Parent links it as a Refund.
 */
export function MoneyDetail({
	transaction,
	onDone,
}: {
	transaction: TransactionRow;
	/** Called once a change is sent: the row may change or leave the list. */
	onDone: () => void;
}) {
	const { data } = useQuery(moneyQuery(transaction));
	return (
		<div className="grid gap-5">
			<List>
				<ListRow
					title={transaction.merchantName || transaction.note || "Imported"}
					meta={
						transaction.transfer ? transferDetail(transaction.transfer) : transaction.importedFrom
					}
					trailing={
						<span className="text-sm font-semibold tabular-nums">
							{formatMoney(transaction.amountCents)}
						</span>
					}
				/>
			</List>
			{data ? (
				<>
					<TransferSection transaction={transaction} view={data.transfer} onDone={onDone} />
					<RefundSection transaction={transaction} view={data.refund} onDone={onDone} />
				</>
			) : (
				<Skeleton className="h-24" />
			)}
		</div>
	);
}

/**
 * A Transaction's Transfer in its detail: where the money went (with Unmark), or, for an imported
 * Transaction nobody has assigned, a way to mark it as one. Shows nothing otherwise.
 */
export function TransferSection({
	transaction,
	view,
	onDone,
}: {
	transaction: TransactionRow;
	/** Given by MoneyDetail, which loads it; fetched here otherwise. */
	view?: TransferView;
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	const { data } = useQuery({ ...moneyQuery(transaction), enabled: view === undefined });
	const change = useMoneyChange();
	const { data: members } = useQuery(membersQuery());
	// The Household's cards, for words that agree with the choice under them (issue 141).
	const { data: cards } = useQuery(cardPaymentCardsQuery());
	const transfer = view ?? data?.transfer;
	if (!transfer || (transfer.kind === "none" && !transfer.markable)) return null;
	const label = transaction.merchantName || transaction.note || "Transaction";

	if (transfer.kind === "transfer") {
		const betweenUs = transfer.reason === "between-us" && !transfer.peer;
		return (
			<section aria-labelledby="transfer-heading" className="grid gap-2">
				<h3 id="transfer-heading" className="text-xs font-medium text-subtle-foreground">
					{transfer.peer ? "Other side" : betweenUs ? "Between us" : "Transfer"}
				</h3>
				{transfer.peer ? (
					<List>
						<PeerRow peer={transfer.peer} />
					</List>
				) : null}
				<p className="text-[13px] text-muted-foreground">
					{betweenUs
						? `Marked: ${lowerFirst(betweenUsMeans(parentNames(members ?? [])))}. It isn’t Income and it isn’t spending.`
						: `${transfer.automatic ? "Found automatically" : "Marked"}: money moving between your own Accounts, like checking to savings, so it counts nowhere.`}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					disabled={!hydrated}
					onClick={() => {
						change.mutate({ kind: "unmark", transferId: transfer.transferId, label });
						onDone();
					}}
				>
					Unmark Transfer
				</Button>
			</section>
		);
	}

	// The Parent the bank's wording names, for money out: the hint then says who.
	const named =
		transaction.amountCents > 0
			? parentNamedIn(transaction.note || transaction.merchantName, parentNames(members ?? []))
			: null;
	return (
		<section aria-labelledby="transfer-heading" className="grid gap-2">
			<h3 id="transfer-heading" className="text-xs font-medium text-subtle-foreground">
				Transfer
			</h3>
			<p className="text-[13px] text-muted-foreground">
				{looksLikeCardPayment(transaction.note || transaction.merchantName)
					? cardPaymentIntro(cards)
					: named
						? `Looks like money sent to ${named}. That’s between us: money one of you sent the other isn’t spending.`
						: looksPersonToPerson(transaction.note || transaction.merchantName)
							? "Looks like money sent to a person. If it went to the other Parent, it’s between us: money one of you sent the other isn’t spending."
							: `Between your own Accounts, like checking to savings or paying the card? That’s a Transfer. ${betweenUsMeans(parentNames(members ?? []))}? That’s between us. Neither is spending.`}
			</p>
			<div className="flex flex-wrap gap-2">
				{/* Money out has the one named choice, which asks which card (issue 136), unless it reads
				    as money sent to a person. A line that reads as a card payment has it instead of the
				    plain mark; any other keeps the plain mark beside it. */}
				{transaction.amountCents > 0 &&
				!named &&
				!looksPersonToPerson(transaction.note || transaction.merchantName) ? (
					<CardPaymentChoice transaction={transaction} label={label} onDone={onDone} />
				) : null}
				{transaction.amountCents > 0 &&
				looksLikeCardPayment(transaction.note || transaction.merchantName) ? null : (
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={!hydrated}
						onClick={() => {
							change.mutate({
								kind: "mark",
								transferId: ulid(),
								transactionId: transaction.id,
								label,
							});
							onDone();
						}}
					>
						Mark as Transfer
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={!hydrated}
					onClick={() => {
						change.mutate({
							kind: "mark",
							transferId: ulid(),
							transactionId: transaction.id,
							label,
							reason: "between-us",
						});
						onDone();
					}}
				>
					It’s between us
				</Button>
			</div>
		</section>
	);
}

/**
 * Money back's Refund link: the purchase it refunds (with Unlink), or the purchases it likely
 * refunds, to link one. Linked, it goes back to the purchase's Bucket.
 */
function RefundSection({
	transaction,
	view,
	onDone,
}: {
	transaction: TransactionRow;
	view: RefundView;
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	const change = useMoneyChange();
	if (view.kind === "none") return null;
	const label = transaction.merchantName || transaction.note || "Money back";

	if (view.kind === "refund") {
		return (
			<section aria-labelledby="refund-heading" className="grid gap-2">
				<h3 id="refund-heading" className="text-xs font-medium text-subtle-foreground">
					Refund for
				</h3>
				<List>
					<PeerRow peer={view.original} />
				</List>
				<p className="text-[13px] text-muted-foreground">
					It goes back to the Bucket the purchase came from.
				</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					disabled={!hydrated}
					onClick={() => {
						change.mutate({ kind: "unlink", refundId: view.refundId, label });
						onDone();
					}}
				>
					Unlink Refund
				</Button>
			</section>
		);
	}

	return (
		<section aria-labelledby="refund-heading" className="grid gap-2">
			<h3 id="refund-heading" className="text-xs font-medium text-subtle-foreground">
				Refund
			</h3>
			<p className="text-[13px] text-muted-foreground">
				{view.likely.length > 0
					? "Is this a Refund for one of these? Linking it gives the money back to the Bucket the purchase came from."
					: "No purchase in the 90 days before it looks like one this refunds."}
			</p>
			{view.likely.length > 0 ? (
				<List>
					{view.likely.map((peer) => (
						<PeerRow
							key={peer.id}
							peer={peer}
							action={
								<Button
									type="button"
									variant="secondary"
									size="sm"
									disabled={!hydrated}
									aria-label={`Link as a Refund for ${peer.merchantName || peer.note || "Quick Add"}, ${formatMoney(peer.amountCents)}, ${shortDay(peer.date)}`}
									onClick={() => {
										change.mutate({
											kind: "link",
											refundId: ulid(),
											refundTransactionId: transaction.id,
											originalTransactionId: peer.id,
											label,
										});
										onDone();
									}}
								>
									Link
								</Button>
							}
						/>
					))}
				</List>
			) : null}
		</section>
	);
}

/** The other side of a Transfer, or a Refund's purchase: what it says, where and when, and its amount. */
function PeerRow({ peer, action }: { peer: MoneyPeer; action?: React.ReactNode }) {
	return (
		<ListRow
			title={peer.merchantName || peer.note || (peer.account ? "Imported" : "Quick Add")}
			meta={[peer.account ?? "Quick Add", shortDay(peer.date)].join(" · ")}
			trailing={
				<div className="flex items-center gap-3">
					<span className="text-sm font-semibold tabular-nums">
						{formatMoney(peer.amountCents)}
					</span>
					{action}
				</div>
			}
		/>
	);
}
