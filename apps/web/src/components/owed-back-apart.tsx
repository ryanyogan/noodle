import type { BucketState, CommitmentState } from "@noodle/domain";
import { formatMoney } from "../format";
import { owedBackApartText } from "../owed-back";

/**
 * The Owed back part of the month's purchases, apart from spending (ADR-0058, revised
 * 2026-10-08): the month's total, then each Bucket and Commitment that has any. No spending
 * figure counts it, so this is where a Parent sees it: on the Plan it sits under the Buckets it
 * explains. Nothing when the month has none.
 */
export function OwedBackApart({
	owedBack,
	buckets,
	commitments,
}: {
	owedBack: number;
	buckets: readonly Pick<BucketState, "id" | "name" | "owedBack" | "owedBackSettled">[];
	commitments: readonly Pick<CommitmentState, "id" | "name" | "owedBack">[];
}) {
	if (owedBack <= 0) return null;
	const parts = [
		...buckets
			.filter((bucket) => (bucket.owedBack ?? 0) > 0)
			.map((bucket) => ({
				id: bucket.id,
				name: bucket.name,
				text: owedBackApartText(bucket.owedBack, bucket.owedBackSettled),
			})),
		...commitments
			.filter((commitment) => (commitment.owedBack?.amount ?? 0) > 0)
			.map((commitment) => ({
				id: commitment.id,
				name: commitment.name,
				text: owedBackApartText(commitment.owedBack?.amount, commitment.owedBack?.settled),
			})),
	];
	return (
		<section
			aria-label="Owed back this month"
			data-testid="owed-back-apart"
			className="grid gap-1 rounded-xl border bg-card px-3 py-2.5 text-sm sm:px-4"
		>
			<p>
				<span className="font-semibold tabular-nums">{formatMoney(owedBack)} owed back</span> on
				this month’s purchases. It isn’t counted as spending.
			</p>
			{parts.length > 0 ? (
				<ul className="grid gap-0.5 text-muted-foreground">
					{parts.map((part) => (
						<li key={part.id} data-testid={`owed-back-apart-${part.id}`} className="tabular-nums">
							<span className="font-medium text-foreground">{part.name}</span>: {part.text}
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
