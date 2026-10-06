import type { For } from "@noodle/domain";
import { useSyncExternalStore } from "react";
import type { MemberSummary } from "../members";
import { ForChips } from "./for-chips";

// Who a Parent said a waiting card is For (issue 138), by Transaction, until the card is decided:
// Confirm, the picker and "Confirm all" file it with this For, and "Always file …?" remembers it
// in the Rule. Kept here, outside the cards, so the List and "One by one" agree and a card put
// back by Undo still shows what was picked. Nothing is saved until the card is filed.
const picks = new Map<string, For>();
const listeners = new Set<() => void>();
let changes = 0;

type Card = { id: string; for: For };

/** Who the card is filed For: what was picked on it, else what the Transaction has. */
export const forPicked = (item: Card): For => picks.get(item.id) ?? item.for;

export function pickFor(item: Card, value: For) {
	if ([...value].sort().join() === [...item.for].sort().join()) picks.delete(item.id);
	else picks.set(item.id, value);
	changes++;
	for (const listener of listeners) listener();
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
