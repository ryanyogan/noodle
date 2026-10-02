import type * as React from "react";
import { formatMoney } from "#lib/money";
import { cn } from "#lib/utils";

/**
 * An amount of money, from cents: "$1,240" or "$1,240.50", in tabular figures and never broken
 * across lines. `whole` rounds to dollars (projections), `signed` puts a "+" on a gain, and
 * `flagNegative` puts a negative amount in the over ink.
 */
function Money({
	cents,
	whole = false,
	signed = false,
	flagNegative = false,
	className,
	...props
}: Omit<React.ComponentProps<"span">, "children"> & {
	cents: number;
	whole?: boolean;
	signed?: boolean;
	flagNegative?: boolean;
}) {
	const amount = whole ? Math.round(cents / 100) * 100 : cents;
	return (
		<span
			data-slot="money"
			className={cn(
				"whitespace-nowrap tabular-nums",
				flagNegative && amount < 0 && "text-over",
				className,
			)}
			{...props}
		>
			{signed && amount > 0 ? "+" : ""}
			{formatMoney(amount)}
		</span>
	);
}

export { Money };
