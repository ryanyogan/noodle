import type { For } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { cn } from "@noodle/ui/lib/utils";
import { useSyncExternalStore } from "react";
import { forLabel, type MemberSummary } from "../members";
import { ForChips } from "./for-chips";

// Who a Parent said a waiting card is For (issue 138), by Transaction, until the card is decided:
// Confirm, the picker and "Confirm all" file it with this For, and "Always file …?" remembers it
// in the Rule. Kept here, outside the cards, so the List and "One by one" agree and a card put
// back by Undo still shows what was picked. Nothing is saved until the card is filed.
const picks = new Map<string, For>();
const listeners = new Set<() => void>();
let changes = 0;

type Card = { id: string; for: For; likelyFor?: For };

/**
 * Who the card starts as For: what the Transaction has, else who its merchant's earlier ones were
 * For (issue 155). The second is only an offer, said on the card ("For Maya, like last time"):
 * filing the card is what saves it.
 */
const forAtFirst = (item: Card): For => (item.for.length > 0 ? item.for : (item.likelyFor ?? []));

/** Who the card is filed For: what was picked on it, else what it started as. */
export const forPicked = (item: Card): For => picks.get(item.id) ?? forAtFirst(item);

/** The card is For who its merchant's earlier ones were, and no Parent has said otherwise. */
const likeLastTime = (item: Card) =>
	!picks.has(item.id) && item.for.length === 0 && (item.likelyFor?.length ?? 0) > 0;

function changed() {
	changes++;
	for (const listener of listeners) listener();
}

export function pickFor(item: Card, value: For) {
	if ([...value].sort().join() === [...forAtFirst(item)].sort().join()) picks.delete(item.id);
	else picks.set(item.id, value);
	changed();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The For chips of a Review card, beside its Bucket picker. */
export function ReviewFor({
	item,
	label,
	members,
	disabled,
	className,
}: {
	item: Card;
	/** The card's Transaction, as the card says it. */
	label: string;
	members: MemberSummary[];
	disabled?: boolean;
	className?: string;
}) {
	useSyncExternalStore(
		subscribe,
		() => changes,
		() => 0,
	);
	return (
		<ForChips
			members={members}
			value={forPicked(item)}
			onChange={(value) => pickFor(item, value ?? [])}
			what={`Who ${label} is For`}
			disabled={disabled}
			className={className}
		/>
	);
}

/**
 * "For Maya, like last time" on a Review card that starts as For who its merchant's earlier
 * Transactions were For (issue 155), with the way out of it. On every such card, the ones without
 * chips too, so the For a card is filed with is always one the Parent was shown.
 */
export function ReviewForLikely({
	item,
	label,
	members,
	disabled,
	className,
}: {
	item: Card;
	/** The card's Transaction, as the card says it. */
	label: string;
	members: MemberSummary[];
	disabled?: boolean;
	className?: string;
}) {
	useSyncExternalStore(
		subscribe,
		() => changes,
		() => 0,
	);
	if (!likeLastTime(item)) return null;
	return (
		<p
			data-testid="review-for-likely"
			className={cn("flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground", className)}
		>
			<span>For {forLabel(members, forPicked(item))}, like last time</span>
			<Button
				type="button"
				variant="link"
				size="sm"
				disabled={disabled}
				aria-label={`Not this time: ${label} is For Everyone`}
				onClick={() => {
					picks.set(item.id, []);
					changed();
				}}
			>
				Not this time
			</Button>
		</p>
	);
}
