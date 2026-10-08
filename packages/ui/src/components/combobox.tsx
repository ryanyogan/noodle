import { ChevronDownIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import { ChoiceList, ChosenChoice } from "#components/choice-list";
import {
	type ChoiceFieldProps,
	flatChoices,
	selectTriggerClass,
	useChoice,
} from "#components/select";
import { useHydrated } from "#lib/hydrated";
import { cn } from "#lib/utils";

/**
 * shadcn's Combobox (Popover + Command): OptionSelect's field with a search box, for a long or
 * grouped list (a Transaction's "Assigned to", a Rule's Bucket). The list is ChoiceList: groups
 * keep their headings, each choice leads with its `mark`, and typing finds a name by the beginning
 * of any of its words. `name` submits the value through a hidden input.
 */
function Combobox({
	searchPlaceholder = "Search…",
	empty = "Nothing matches.",
	...props
}: ChoiceFieldProps & { searchPlaceholder?: string; empty?: string }) {
	const {
		id,
		name,
		choices,
		placeholder = "Choose…",
		disabled,
		size = "default",
		className,
	} = props;
	const [current, set] = useChoice(props);
	const [open, setOpen] = React.useState(false);
	// A Radix trigger does nothing before hydration, so it waits (lib/hydrated.ts).
	const hydrated = useHydrated();
	const chosen = flatChoices(choices).find((c) => c.value === current);
	return (
		<>
			<PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
				<PopoverPrimitive.Trigger
					type="button"
					id={id}
					role="combobox"
					aria-expanded={open}
					aria-label={props["aria-label"]}
					aria-invalid={props["aria-invalid"]}
					aria-describedby={props["aria-describedby"]}
					disabled={disabled || !hydrated}
					data-size={size}
					data-placeholder={chosen ? undefined : ""}
					className={cn(selectTriggerClass, className)}
				>
					{chosen ? (
						<ChosenChoice choice={chosen} />
					) : (
						<span className="truncate">{placeholder}</span>
					)}
					<ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
				</PopoverPrimitive.Trigger>
				<PopoverPrimitive.Portal>
					<PopoverPrimitive.Content
						data-slot="combobox-content"
						align="start"
						sideOffset={4}
						collisionPadding={8}
						// Inside a sheet the page is held still (Radix's scroll lock), which takes the wheel
						// and a finger's drag from anything outside the sheet's own element, as this list
						// is: kept here, they scroll the list.
						onWheel={(event) => event.stopPropagation()}
						onTouchMove={(event) => event.stopPropagation()}
						className={cn(
							// Above sheets (z-41) and alert dialogs (z-51), as Select.
							"z-55 w-(--radix-popover-trigger-width) max-w-[calc(100vw-16px)] min-w-[max(var(--radix-popover-trigger-width),12rem)]",
							"origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl border bg-popover shadow-pop",
							"data-[state=open]:animate-enter",
						)}
					>
						<ChoiceList
							choices={choices}
							current={current}
							searchPlaceholder={searchPlaceholder}
							empty={empty}
							onChoose={(value) => {
								set(value);
								setOpen(false);
							}}
						/>
					</PopoverPrimitive.Content>
				</PopoverPrimitive.Portal>
			</PopoverPrimitive.Root>
			{name ? <input type="hidden" name={name} value={current} /> : null}
		</>
	);
}

export { Combobox };
