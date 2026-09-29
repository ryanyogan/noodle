import type { BucketState } from "@noodle/domain";
import type { BucketColor } from "@noodle/ui/components/tile";
import { formatMoney } from "./format";

/** The Bucket colours in their fixed, colour-blind-validated order (ADR-0008). */
export const bucketColors: { value: BucketColor; name: string }[] = [
	{ value: 1, name: "Blue" },
	{ value: 2, name: "Red" },
	{ value: 3, name: "Cyan" },
	{ value: 4, name: "Green" },
	{ value: 5, name: "Violet" },
	{ value: 6, name: "Aqua" },
	{ value: 7, name: "Brown" },
	{ value: 8, name: "Magenta" },
];

export const asBucketColor = (color: number): BucketColor =>
	(Number.isInteger(color) && color >= 1 && color <= 8 ? color : 1) as BucketColor;

/** A new Bucket's colour: the first in order that no Bucket uses, else the least used. */
export function nextBucketColor(used: number[]): BucketColor {
	const counts = bucketColors.map(({ value }) => used.filter((c) => c === value).length);
	return asBucketColor(counts.indexOf(Math.min(...counts)) + 1);
}

/** The letter shown in a Bucket's tile. */
export const monogram = (name: string) => name.trim().charAt(0).toUpperCase() || "·";

/**
 * What a Bucket has this month, part by part: "$400 planned + $35 rolled over − $20 moved out".
 * Null when its allowance is all there is.
 */
export function availableParts(
	bucket: Pick<BucketState, "allowance" | "rolledOver" | "moved">,
): string | null {
	if (bucket.rolledOver === 0 && bucket.moved === 0) return null;
	const part = (amount: number, gained: string, lost: string) =>
		amount > 0
			? ` + ${formatMoney(amount)} ${gained}`
			: amount < 0
				? ` − ${formatMoney(-amount)} ${lost}`
				: "";
	return `${formatMoney(bucket.allowance)} planned${part(bucket.rolledOver, "rolled over", "overspent last month")}${part(bucket.moved, "moved in", "moved out")}`;
}
