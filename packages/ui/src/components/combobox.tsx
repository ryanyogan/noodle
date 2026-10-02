import { ChevronDownIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#components/command";
import {
	type Choice,
	type ChoiceFieldProps,
	flatChoices,
	isGroup,
	selectTriggerClass,
	useChoice,
} from "#components/select";
import { useHydrated } from "#lib/hydrated";
import { cn } from "#lib/utils";

/**
 * shadcn's Combobox (Popover + Command): OptionSelect's field with a search box, for a long or
 * grouped list (a Transaction's "Assigned to", a Rule's Bucket). Groups keep their headings;
 * typing narrows by each choice's text. `name` submits the value through a hidden input.
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
	const list = React.useRef<HTMLDivElement>(null);
	// Opening starts on the current choice, scrolled into view, rather than the top of the list.
	React.useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() =>
			list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }),
		);
		return () => cancelAnimationFrame(frame);
	}, [open]);
	// A Radix trigger does nothing before hydration, so it waits (lib/hydrated.ts).
	const hydrated = useHydrated();
	const chosen = flatChoices(choices).find((c) => c.value === current);
	const textOf = (c: Choice) => c.text ?? (typeof c.label === "string" ? c.label : c.value);
	const item = (c: Choice) => (
		<CommandItem
			key={c.value}
			value={c.value}
			keywords={[textOf(c)]}
			disabled={c.disabled}
			checked={c.value === current}
			onSelect={() => {
				set(c.value);
				setOpen(false);
			}}
		>
			{c.label}
		</CommandItem>
	);
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
					<span className="truncate">{chosen ? chosen.label : placeholder}</span>
					<ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
				</PopoverPrimitive.Trigger>
				<PopoverPrimitive.Portal>
					<PopoverPrimitive.Content
						data-slot="combobox-content"
						align="start"
						sideOffset={4}
						collisionPadding={8}
						className={cn(
							// Above sheets (z-41) and alert dialogs (z-51), as Select.
							"z-55 w-(--radix-popover-trigger-width) max-w-[calc(100vw-16px)] min-w-[max(var(--radix-popover-trigger-width),12rem)]",
							"origin-(--radix-popover-content-transform-origin) overflow-hidden rounded-xl border bg-popover shadow-pop",
							"data-[state=open]:animate-enter",
						)}
					>
						<Command loop defaultValue={current}>
							<CommandInput placeholder={searchPlaceholder} />
							<CommandList ref={list}>
								<CommandEmpty>{empty}</CommandEmpty>
								{choices.map((c) =>
									isGroup(c) ? (
										<CommandGroup key={c.label} heading={c.label}>
											{c.choices.map(item)}
										</CommandGroup>
									) : (
										item(c)
									),
								)}
							</CommandList>
						</Command>
					</PopoverPrimitive.Content>
				</PopoverPrimitive.Portal>
			</PopoverPrimitive.Root>
			{name ? <input type="hidden" name={name} value={current} /> : null}
		</>
	);
}

export { Combobox };
