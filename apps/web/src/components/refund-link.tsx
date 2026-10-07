import { Button } from "@noodle/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { dayName, formatMoney } from "../format";
import type { MoneyInLine } from "../money-in";
import { moneyInRefundQuery, useRefundLink } from "../refund-link";

// "Which purchase is this a Refund for?" under a Refund money-in line (issue 131, ADR-0057): the
// purchase's Bucket or Commitment gets the money back in the month it landed.

const purchaseName = (note: string | null) => note?.trim() || "Purchase";

/** A Refund in checking: the purchase it is linked to, with Unlink, or the likely ones to pick. */
export function RefundLinking({ line, today }: { line: MoneyInLine; today: string }) {
	const id = useId();
	const refund = useQuery(moneyInRefundQuery(line.id)).data;
	const link = useRefundLink();
	if (!refund) return null;
	if (refund.link) {
		const { purchase, countsOn, ended } = refund.link;
		return (
			<div className="grid justify-items-start gap-2" data-testid="refund-link">
				<p className="text-sm text-muted-foreground">
					A Refund for{" "}
					<span className="font-medium text-foreground">
						{purchase ? purchaseName(purchase.note) : "a purchase you can’t see"}
					</span>
					{purchase ? ` · ${dayName(purchase.date, today)} · ${formatMoney(purchase.amount)}` : ""}.
					Its Bucket or Commitment got {formatMoney(line.amount)} back, counted{" "}
					{dayName(countsOn, today)}.{ended ? " That month has ended, so the link stays." : ""}
				</p>
				{ended ? null : (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={link.isPending}
						onClick={() => link.mutate({ incomeId: line.id, transactionId: null })}
					>
						Unlink
					</Button>
				)}
			</div>
		);
	}
	return (
		<div className="grid gap-2" data-testid="refund-link">
			<p id={`${id}-q`} className="text-sm text-muted-foreground">
				{refund.likely.length > 0
					? "Which purchase is this a Refund for? Its Bucket or Commitment gets the money back in the month it landed."
					: `Which purchase is this a Refund for? No filed purchase of ${formatMoney(line.amount)} or more from the 90 days before it is here. It isn’t counted as Income.`}
			</p>
			{refund.likely.length > 0 ? (
				<ul className="grid gap-2" aria-labelledby={`${id}-q`}>
					{refund.likely.map((purchase) => (
						<li
							key={purchase.id}
							className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
							data-testid="refund-purchase"
						>
							<span className="min-w-0 text-sm">
								<span className="font-medium">{purchaseName(purchase.note)}</span>
								<span className="text-muted-foreground">
									{" "}
									· {dayName(purchase.date, today)} · {formatMoney(purchase.amount)}
								</span>
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={link.isPending}
								aria-label={`Link to ${purchaseName(purchase.note)}, ${formatMoney(purchase.amount)}`}
								onClick={() => link.mutate({ incomeId: line.id, transactionId: purchase.id })}
							>
								This one
							</Button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
