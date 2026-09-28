import { parseDollars } from "@noodle/domain";
import { Input } from "@noodle/ui/components/input";
import { cn } from "@noodle/ui/lib/utils";
import { type ComponentProps, useRef, useState } from "react";
import { formatMoneyInput } from "../format";

/**
 * A dollar amount that saves when the Parent leaves the field or presses Enter; Escape puts
 * back what was there. Something that isn't an amount is flagged and not saved.
 */
export function MoneyInput({
	value,
	onCommit,
	className,
	...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
	value: number;
	onCommit: (cents: number) => void;
}) {
	// What the Parent is typing; null when the field shows the saved value.
	const [draft, setDraft] = useState<string | null>(null);
	// The amount just saved, shown until `value` catches up (or rolls back), so the old amount
	// doesn't flash back while the optimistic update is on its way.
	const [saved, setSaved] = useState<{ cents: number; over: number } | null>(null);
	if (saved && saved.over !== value) setSaved(null);
	const cancelled = useRef(false);
	const invalid = draft !== null && parseDollars(draft) === null;

	function commit() {
		if (cancelled.current || draft === null) {
			cancelled.current = false;
			setDraft(null);
			return;
		}
		const cents = parseDollars(draft);
		if (cents === null) return; // stays flagged until fixed or Escaped
		setDraft(null);
		if (cents === value) return;
		setSaved({ cents, over: value });
		onCommit(cents);
	}

	return (
		<div className={cn("relative", className)}>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground text-sm"
			>
				$
			</span>
			<Input
				type="text"
				inputMode="decimal"
				autoComplete="off"
				enterKeyHint="done"
				className="pl-6 text-end tabular-nums"
				value={draft ?? formatMoneyInput(saved?.cents ?? value)}
				aria-invalid={invalid || undefined}
				onFocus={(event) => {
					setDraft(formatMoneyInput(saved?.cents ?? value));
					event.currentTarget.select();
				}}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						cancelled.current = true;
						event.currentTarget.blur();
					}
				}}
				{...props}
			/>
		</div>
	);
}
