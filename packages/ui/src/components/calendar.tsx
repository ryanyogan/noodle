import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { type DayButton, DayPicker, getDefaultClassNames } from "react-day-picker";
import { Button, buttonVariants } from "#components/button";
import { cn } from "#lib/utils";

/** A day as the app keeps it: local yyyy-mm-dd. */
function isoDay(date: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * shadcn's Calendar (radix-nova, react-day-picker) on the app's tokens. Each day button carries
 * `data-day` as yyyy-mm-dd, and the month and year dropdowns are labelled selects, so specs can
 * reach any date without typing.
 */
function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	captionLayout = "label",
	components,
	...props
}: React.ComponentProps<typeof DayPicker>) {
	const defaults = getDefaultClassNames();
	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn(
				"group/calendar p-3 [--cell-radius:var(--radius-lg)] [--cell-size:--spacing(9)] max-lg:[--cell-size:--spacing(11)]",
				className,
			)}
			captionLayout={captionLayout}
			formatters={{
				formatMonthDropdown: (date) => date.toLocaleString("en-US", { month: "short" }),
			}}
			classNames={{
				root: cn("w-fit", defaults.root),
				months: cn("relative flex flex-col gap-4 md:flex-row", defaults.months),
				month: cn("flex w-full flex-col gap-3", defaults.month),
				nav: cn(
					"absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
					defaults.nav,
				),
				button_previous: cn(
					buttonVariants({ variant: "ghost" }),
					"size-(--cell-size) rounded-(--cell-radius) p-0 select-none aria-disabled:opacity-50",
					defaults.button_previous,
				),
				button_next: cn(
					buttonVariants({ variant: "ghost" }),
					"size-(--cell-size) rounded-(--cell-radius) p-0 select-none aria-disabled:opacity-50",
					defaults.button_next,
				),
				month_caption: cn(
					"flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
					defaults.month_caption,
				),
				dropdowns: cn(
					"flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-sm font-medium",
					defaults.dropdowns,
				),
				dropdown_root: cn(
					"relative rounded-(--cell-radius) border border-border bg-menu-hover",
					"has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-brand-soft",
					defaults.dropdown_root,
				),
				dropdown: cn("absolute inset-0 cursor-pointer bg-popover opacity-0", defaults.dropdown),
				caption_label: cn(
					"font-medium select-none",
					captionLayout === "label"
						? "text-sm"
						: "flex h-8 items-center gap-1 rounded-(--cell-radius) pr-1.5 pl-2.5 text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
					defaults.caption_label,
				),
				month_grid: cn("w-full border-collapse", defaults.month_grid),
				weekdays: cn("flex", defaults.weekdays),
				weekday: cn(
					"flex-1 rounded-(--cell-radius) text-[0.8rem] font-normal text-muted-foreground select-none",
					defaults.weekday,
				),
				week: cn("mt-1 flex w-full", defaults.week),
				day: cn(
					"group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none",
					"[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius) [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
					defaults.day,
				),
				range_start: cn("rounded-l-(--cell-radius) bg-menu-hover", defaults.range_start),
				range_middle: cn("rounded-none", defaults.range_middle),
				range_end: cn("rounded-r-(--cell-radius) bg-menu-hover", defaults.range_end),
				today: cn(
					"rounded-(--cell-radius) bg-menu-hover font-medium text-foreground data-[selected=true]:rounded-none",
					defaults.today,
				),
				outside: cn("text-subtle-foreground aria-selected:text-muted-foreground", defaults.outside),
				disabled: cn("text-muted-foreground opacity-40", defaults.disabled),
				hidden: cn("invisible", defaults.hidden),
				...classNames,
			}}
			components={{
				Root: ({ className, rootRef, ...rest }) => (
					<div data-slot="calendar" ref={rootRef} className={cn(className)} {...rest} />
				),
				Chevron: ({ className, orientation, ...rest }) => {
					const Icon =
						orientation === "left"
							? ChevronLeftIcon
							: orientation === "right"
								? ChevronRightIcon
								: ChevronDownIcon;
					return <Icon aria-hidden="true" className={cn("size-4", className)} {...rest} />;
				},
				DayButton: CalendarDayButton,
				...components,
			}}
			{...props}
		/>
	);
}

function CalendarDayButton({
	className,
	day,
	modifiers,
	...props
}: React.ComponentProps<typeof DayButton>) {
	const defaults = getDefaultClassNames();
	const ref = React.useRef<HTMLButtonElement>(null);
	React.useEffect(() => {
		if (modifiers.focused) ref.current?.focus();
	}, [modifiers.focused]);
	const single =
		modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle;
	return (
		<Button
			ref={ref}
			variant="ghost"
			size="icon"
			data-day={isoDay(day.date)}
			data-selected-single={single}
			data-range-start={modifiers.range_start}
			data-range-end={modifiers.range_end}
			data-range-middle={modifiers.range_middle}
			className={cn(
				"relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) rounded-(--cell-radius) border-0 font-normal text-foreground tabular-nums leading-none",
				"group-data-[outside=true]/day:text-subtle-foreground",
				"group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-3 group-data-[focused=true]/day:ring-brand-soft",
				"data-[selected-single=true]:bg-primary data-[selected-single=true]:font-medium data-[selected-single=true]:text-primary-foreground",
				"data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground",
				"data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground",
				"data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-menu-hover",
				defaults.day,
				className,
			)}
			{...props}
		/>
	);
}

export { Calendar, CalendarDayButton, isoDay };
