import { CalendarIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { Button } from "#components/button";
import { Calendar } from "#components/calendar";
import { selectTriggerClass } from "#components/select";
import { useHydrated } from "#lib/hydrated";
import { cn } from "#lib/utils";

/** yyyy-mm-dd as a local Date, or undefined. */
function fromIso(iso: string | undefined) {
	const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
	return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

function toIso(date: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "Oct 1, 2026". */
function formatDay(date: Date) {
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type DatePickerProps = {
	id?: string;
	/** Submits the day as yyyy-mm-dd through a hidden input. */
	name?: string;
	/** yyyy-mm-dd, or "" for none. */
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	/** yyyy-mm-dd bounds; days outside them can't be picked. */
	min?: string;
	max?: string;
	placeholder?: string;
	/** Without it the popover offers Clear once a day is picked. */
	required?: boolean;
	disabled?: boolean;
	className?: string;
	"aria-label"?: string;
	"aria-invalid"?: boolean;
	"aria-describedby"?: string;
};

/**
 * shadcn's Date Picker (Popover + Calendar) in place of `<input type="date">`: a trigger styled
 * like the other fields that reads "Oct 1, 2026", and a calendar with month and year dropdowns.
 * Values stay yyyy-mm-dd, as the native input's were.
 */
function DatePicker({
	id,
	name,
	value,
	defaultValue = "",
	onChange,
	min,
	max,
	placeholder = "Pick a date",
	required,
	disabled,
	className,
	...aria
}: DatePickerProps) {
	const [own, setOwn] = React.useState(defaultValue);
	const current = value ?? own;
	const set = (next: string) => {
		if (value === undefined) setOwn(next);
		onChange?.(next);
	};
	const [open, setOpen] = React.useState(false);
	const hydrated = useHydrated();
	const selected = fromIso(current);
	const from = fromIso(min);
	const to = fromIso(max);
	const today = new Date();
	const anchor = selected ?? today;
	const startMonth = from ?? new Date(Math.min(anchor.getFullYear(), today.getFullYear()) - 10, 0);
	const endMonth = to ?? new Date(Math.max(anchor.getFullYear(), today.getFullYear()) + 30, 11);
	const disabledDays = [...(from ? [{ before: from }] : []), ...(to ? [{ after: to }] : [])];
	return (
		<>
			<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
				<PopoverPrimitive.Trigger
					type="button"
					id={id}
					aria-label={aria["aria-label"]}
					aria-invalid={aria["aria-invalid"]}
					aria-describedby={aria["aria-describedby"]}
					disabled={disabled || !hydrated}
					data-slot="date-picker"
					data-size="default"
					data-value={current}
					data-placeholder={selected ? undefined : ""}
					className={cn(selectTriggerClass, "justify-start gap-2", className)}
				>
					<CalendarIcon aria-hidden="true" className="text-muted-foreground" />
					<span className="truncate">{selected ? formatDay(selected) : placeholder}</span>
				</PopoverPrimitive.Trigger>
				<PopoverPrimitive.Portal>
					<PopoverPrimitive.Content
						data-slot="date-picker-content"
						align="start"
						sideOffset={4}
						collisionPadding={8}
						className={cn(
							// Above sheets (z-41) and alert dialogs (z-51), as Select.
							"z-55 w-auto origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-pop",
							"data-[state=open]:animate-enter",
						)}
					>
						<Calendar
							mode="single"
							captionLayout="dropdown"
							selected={selected}
							defaultMonth={anchor}
							startMonth={startMonth}
							endMonth={endMonth}
							disabled={disabledDays}
							autoFocus
							onSelect={(day) => {
								// Choosing the selected day keeps it and closes, just like choosing another day.
								if (day) set(toIso(day));
								setOpen(false);
							}}
						/>
						{!required && selected ? (
							<div className="flex justify-end border-t px-3 py-2">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => {
										set("");
										setOpen(false);
									}}
								>
									Clear
								</Button>
							</div>
						) : null}
					</PopoverPrimitive.Content>
				</PopoverPrimitive.Portal>
			</PopoverPrimitive.Root>
			{name ? <input type="hidden" name={name} value={current} /> : null}
		</>
	);
}

export { DatePicker, formatDay };
