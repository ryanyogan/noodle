import type { Plan, ReceiptPart } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { List, ListRow } from "@noodle/ui/components/list";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ulid } from "ulid";
import { formatMoney, shortDay } from "../format";
import { forLabel, type MemberSummary } from "../members";
import { receiptQuery } from "../receipts";
import type { TransactionEdit, TransactionRow } from "../transactions";

/**
 * A Transaction's Receipt in its detail: what it's from, its lines, and the Splits they make,
 * which a Parent can apply in one go. Shows nothing without a Receipt.
 */
export function ReceiptSection({
	transaction,
	plan,
	members,
	onChange,
}: {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets">;
	members: MemberSummary[];
	onChange: (next: TransactionEdit | null) => void;
}) {
	const hydrated = useHydrated();
	const receipt = useQuery(receiptQuery(transaction)).data?.receipt;
	if (!receipt) return null;
	const { proposal, totalCents } = receipt;
	const bucketName = (id: string | null) =>
		plan.buckets.find((bucket) => bucket.id === id)?.name ?? "No Bucket";
	const parts = proposal?.kind === "parts" ? proposal.parts : null;
	// Applying needs every part in a Bucket of this month's Plan, and the Receipt's own total.
	const applicable =
		parts?.every((part) => plan.buckets.some((bucket) => bucket.id === part.bucketId)) === true &&
		totalCents === transaction.amountCents;
	const applied = parts !== null && isApplied(transaction, parts);

	function apply(parts: ReceiptPart[]) {
		const { amountCents, note } = transaction;
		const [whole] = parts;
		if (parts.length === 1 && whole?.bucketId) {
			return onChange({
				amountCents,
				note,
				assignment: { bucketId: whole.bucketId },
				forMemberIds: whole.for,
			});
		}
		onChange({
			amountCents,
			note,
			splits: parts.map((part) => ({
				id: ulid(),
				amountCents: part.amount,
				assignment: { bucketId: part.bucketId as string },
				forMemberIds: part.for,
			})),
		});
	}

	return (
		<section aria-labelledby="receipt-heading" className="grid gap-2">
			<h3 id="receipt-heading" className="text-xs font-medium text-subtle-foreground">
				Receipt
			</h3>
			<div className="flex items-center gap-3">
				{receipt.thumbnail ? (
					<img
						src={receipt.thumbnail}
						alt="The Receipt"
						className="size-14 shrink-0 rounded-lg border border-border object-cover"
					/>
				) : null}
				<p className="flex-1 text-sm">
					{[
						receipt.merchant ?? "Receipt",
						receipt.date && shortDay(receipt.date),
						totalCents !== null && formatMoney(totalCents),
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
			</div>
			{receipt.lines.length > 0 ? (
				<Collapsible className="group text-[13px]">
					<CollapsibleTrigger className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
						<ChevronRight
							aria-hidden="true"
							className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
						/>
						{receipt.lines.length} {receipt.lines.length === 1 ? "line" : "lines"}
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ul className="mt-2 grid gap-1">
							{receipt.lines.map((line, i) => (
								// Lines have no ID; their order is the Receipt's.
								// biome-ignore lint/suspicious/noArrayIndexKey: a Receipt's lines never reorder
								<li key={i} className="flex gap-3">
									<span className="min-w-0 flex-1 truncate">{line.text}</span>
									<span className="tabular-nums">{formatMoney(line.amount)}</span>
								</li>
							))}
						</ul>
					</CollapsibleContent>
				</Collapsible>
			) : null}
			{proposal === null ? (
				<p className="text-[13px] text-muted-foreground">Its total couldn’t be read.</p>
			) : proposal.kind === "unreconciled" ? (
				<p className="text-[13px] text-muted-foreground">
					Its lines don’t add up to its total, so it proposes no Splits.
				</p>
			) : parts ? (
				<>
					<List aria-label="Splits from the Receipt">
						{parts.map((part) => (
							<ListRow
								key={`${part.bucketId}|${part.for.join(",")}`}
								title={bucketName(part.bucketId)}
								meta={forLabel(members, part.for)}
								trailing={
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(part.amount)}
									</span>
								}
							/>
						))}
					</List>
					{applied ? (
						<p className="text-[13px] text-muted-foreground">
							{parts.length === 1 ? "Filed from its Receipt." : "Split from its Receipt."}
						</p>
					) : applicable ? (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="justify-self-start"
							disabled={!hydrated}
							onClick={() => apply(parts)}
						>
							{parts.length === 1 ? "Apply this Bucket" : "Apply these Splits"}
						</Button>
					) : (
						<p className="text-[13px] text-muted-foreground">
							{totalCents !== transaction.amountCents
								? "Its total isn’t this Transaction’s amount."
								: "Choose a Bucket for each item before applying these."}
						</p>
					)}
				</>
			) : null}
		</section>
	);
}

/** The Transaction is already as the Receipt's parts would make it. */
function isApplied(transaction: TransactionRow, parts: ReceiptPart[]): boolean {
	const same = (bucketId: string | null, forIds: string[], part: ReceiptPart) =>
		bucketId === part.bucketId && [...forIds].sort().join(",") === part.for.join(",");
	if (parts.length === 1) {
		const [whole] = parts as [ReceiptPart];
		return transaction.splits.length === 0 && same(transaction.bucketId, transaction.for, whole);
	}
	return (
		transaction.splits.length === parts.length &&
		parts.every((part) =>
			transaction.splits.some(
				(split) => split.amountCents === part.amount && same(split.bucketId, split.for, part),
			),
		)
	);
}
