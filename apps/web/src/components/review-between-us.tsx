import { looksPersonToPerson, parentNamedIn } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { Users } from "lucide-react";
import type { MemberSummary } from "../members";
import { TermHelp } from "./term-help";

// Review's card for money out that reads as sent to a person (issue 92, ADR-0052): "It's between
// us" is its first suggestion, a Bucket its second. Only ever offered: a Parent says so.

/** A card in Review that reads as money sent person to person, and the Parent it names, if any. */
export type BetweenUsOffer = { name: string | null };

/** The Parents' names, as a bank's wording might carry them. */
export const parentNames = (members: readonly MemberSummary[]) =>
	members.filter((member) => member.kind === "parent" && !member.removed).map((m) => m.name);

/**
 * Whether money out is offered as between the two Parents: its wording is Zelle, Venmo, PayPal,
 * Cash App or Apple Cash, or it names a Parent. Never for money back.
 */
export function betweenUsOffer(
	line: { text: string | null | undefined; amountCents: number },
	names: readonly string[],
): BetweenUsOffer | null {
	if (line.amountCents <= 0 || !looksPersonToPerson(line.text, names)) return null;
	return { name: parentNamedIn(line.text, names) };
}

/**
 * What Between us is, naming the two Parents where both names are known, so it isn't taken for a
 * Transfer (issue 152): "Money Alex sent Sam, or Sam sent Alex".
 */
export function betweenUsMeans(names: readonly string[]): string {
	const [first, second] = names;
	return first && second && names.length === 2
		? `Money ${first} sent ${second}, or ${second} sent ${first}`
		: "Money one of you sent the other";
}

/** A sentence's opening, for after a colon. */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What a Transfer is, beside Between us: the Household's own Accounts, with an everyday example. */
export const TRANSFER_MEANS = "Between your own Accounts, like checking to savings.";

/** Why it goes in no Bucket, on its card. */
export const BETWEEN_US_WHY =
	"Money one of you sent the other isn’t spending. If it paid someone else, pick a Bucket.";

/** What the mark says once it's made. */
export const betweenUsDone = (label: string) => `${label} is between you: not counted as spending.`;

/** The card's suggestion: what it is, and who the line names. */
export function BetweenUsSuggestion({ offer }: { offer: BetweenUsOffer }) {
	return (
		<>
			<Tile aria-hidden="true">
				<Users />
			</Tile>
			<div className="grid min-w-0 flex-1">
				<span className="text-sm font-medium wrap-anywhere">It’s between us · not spending</span>
				<span className="text-xs text-muted-foreground wrap-anywhere">
					{offer.name
						? `Looks like money sent to ${offer.name}`
						: "Looks like money sent to a person"}
				</span>
			</div>
			<TermHelp term="between-us" />
		</>
	);
}

/**
 * A Review card's wide button when the card is narrower than 15 text sizes (text at about 200% on
 * a phone): it has a row to itself and its words wrap inside it, so none is cut at its edge.
 */
export const largeTextButton =
	"@max-[15rem]/card:h-auto! @max-[15rem]/card:min-h-11 @max-[15rem]/card:basis-full! @max-[15rem]/card:py-2 @max-[15rem]/card:whitespace-normal";

/**
 * The card's picker under the same limit: its words wrap inside it rather than end in "…"
 * ("Pick a B…" at 320 with text at 200%).
 */
export const largeTextPicker =
	"@max-[15rem]/card:h-auto! @max-[15rem]/card:min-h-11 @max-[15rem]/card:py-2 @max-[15rem]/card:whitespace-normal @max-[15rem]/card:*:first:whitespace-normal";

/** The card's first action. On a phone it has the first row with Edit; the picker is under them. */
export function BetweenUsButton({
	disabled,
	onClick,
}: {
	disabled: boolean;
	onClick?: () => void;
}) {
	return (
		<Button
			className={cn("max-sm:order-first max-sm:min-w-0 max-sm:flex-1", largeTextButton)}
			disabled={disabled}
			onClick={onClick}
		>
			<Users />
			It’s between us
		</Button>
	);
}
