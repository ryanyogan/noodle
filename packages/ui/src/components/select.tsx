import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { useHydrated } from "#lib/hydrated";
import { cn } from "#lib/utils";

// shadcn/ui's Select (https://ui.shadcn.com/docs/components/select), radix-nova, on this design
// system's tokens: the trigger matches Input, the list matches Popover.
//
// Which select where (packages/ui/COMPONENTS.md): Select for a choice that changes what a page
// shows or sits inline as a chip (Reports' options, Transactions' filters, Explore's chips);
// OptionSelect for a labelled field in a form (a short list); Combobox for a long or grouped list.

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return (
		<SelectPrimitive.Group
			data-slot="select-group"
			className={cn("scroll-my-1 p-1", className)}
			{...props}
		/>
	);
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

/** The trigger look, shared with Combobox so both read as one kind of field. */
const selectTriggerClass = [
	"flex w-full min-w-0 items-center justify-between gap-1.5 border border-border bg-surface-2 text-start whitespace-nowrap text-foreground select-none",
	"transition-[border-color,background-color,box-shadow] duration-(--duration-fast) ease-standard",
	"hover:border-border-strong focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-soft",
	"disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-over aria-invalid:ring-3 aria-invalid:ring-over-soft",
	"data-placeholder:text-subtle-foreground",
	// 16px on phones so iOS Safari doesn't zoom, as Input.
	"data-[size=default]:h-10 max-lg:data-[size=default]:h-11 data-[size=default]:rounded-xl data-[size=default]:ps-3 data-[size=default]:pe-2.5 data-[size=default]:text-base md:data-[size=default]:text-sm",
	"data-[size=sm]:h-8 max-lg:data-[size=sm]:h-11 data-[size=sm]:rounded-lg data-[size=sm]:ps-2.5 data-[size=sm]:pe-2 data-[size=sm]:text-[13px]",
	"data-[size=pill]:h-8 max-lg:data-[size=pill]:h-11 data-[size=pill]:w-auto data-[size=pill]:rounded-full data-[size=pill]:ps-3 data-[size=pill]:pe-2 data-[size=pill]:text-[13px] data-[size=pill]:font-medium lg:data-[size=pill]:h-7",
	"*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5",
	"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(" ");

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	/** `default` is a form field's height; `sm` a compact chip; `pill` a rounded chip. */
	size?: "sm" | "default" | "pill";
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={size}
			className={cn(selectTriggerClass, className)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = "popper",
	align = "start",
	sideOffset = 4,
	collisionPadding = 8,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				className={cn(
					// Above sheets (z-41) and alert dialogs (z-51), so a Select works in either.
					"relative z-55 max-h-(--radix-select-content-available-height) overflow-x-hidden overflow-y-auto",
					"origin-(--radix-select-content-transform-origin) rounded-xl border bg-popover text-popover-foreground shadow-pop",
					"data-[state=open]:animate-enter",
					position === "popper" &&
						"max-w-[calc(100vw-16px)] min-w-[max(var(--radix-select-trigger-width),9rem)]",
					className,
				)}
				position={position}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				{...props}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport data-position={position} className="p-1">
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", className)}
			{...props}
		/>
	);
}

function SelectItem({
	className,
	children,
	hint,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { hint?: React.ReactNode }) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex min-h-9 max-lg:min-h-11 w-full cursor-default items-center gap-2 rounded-lg py-1.5 ps-2 pe-8 text-sm outline-hidden select-none",
				"focus:bg-surface-2 focus:text-foreground data-[state=checked]:font-medium",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon aria-hidden="true" />
				</SelectPrimitive.ItemIndicator>
			</span>
			{hint ? (
				<span className="grid min-w-0">
					<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
					<span className="text-[13px] text-muted-foreground tabular-nums">{hint}</span>
				</span>
			) : (
				<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
			)}
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function SelectScrollUpButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
	return (
		<SelectPrimitive.ScrollUpButton
			data-slot="select-scroll-up-button"
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			{...props}
		>
			<ChevronUpIcon aria-hidden="true" className="size-4" />
		</SelectPrimitive.ScrollUpButton>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
	return (
		<SelectPrimitive.ScrollDownButton
			data-slot="select-scroll-down-button"
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			{...props}
		>
			<ChevronDownIcon aria-hidden="true" className="size-4" />
		</SelectPrimitive.ScrollDownButton>
	);
}

type Choice = {
	value: string;
	label: React.ReactNode;
	/** Plain text for search and the trigger, when `label` isn't a string. */
	text?: string;
	/** A second line under the label in the list only (e.g. an amount); the trigger shows just the label. */
	hint?: string;
	disabled?: boolean;
};
type ChoiceGroup = { label: string; choices: Choice[] };
type Choices = (Choice | ChoiceGroup)[];

const isGroup = (c: Choice | ChoiceGroup): c is ChoiceGroup => "choices" in c;
const flatChoices = (choices: Choices) => choices.flatMap((c) => (isGroup(c) ? c.choices : [c]));

/** A form field's choice, controlled (`value`) or not (`defaultValue`); `name` submits it. */
type ChoiceFieldProps = {
	id?: string;
	name?: string;
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	choices: Choices;
	/** Shown while nothing is chosen (in place of a disabled first option). */
	placeholder?: string;
	disabled?: boolean;
	size?: "sm" | "default" | "pill";
	className?: string;
	"aria-label"?: string;
	"aria-invalid"?: boolean;
	"aria-describedby"?: string;
};

function useChoice({ value, defaultValue, onValueChange }: ChoiceFieldProps) {
	const [inner, setInner] = React.useState(defaultValue ?? "");
	const current = value ?? inner;
	const set = (next: string) => {
		if (value === undefined) setInner(next);
		onValueChange?.(next);
	};
	return [current, set] as const;
}

// Radix Select keeps "" for "nothing chosen", so a real "" choice ("Anyone", "Leave it") rides
// under this stand-in.
const EMPTY = "\u0000empty";

/**
 * shadcn's Select as a form field: the choices as data, groups kept, "" allowed as a choice, and
 * a hidden input under `name` so a plain form submits it.
 */
function OptionSelect(props: ChoiceFieldProps) {
	const { id, name, choices, placeholder, disabled, size, className } = props;
	const [current, set] = useChoice(props);
	// A Radix trigger does nothing before hydration, so it waits (lib/hydrated.ts).
	const hydrated = useHydrated();
	const hasEmpty = flatChoices(choices).some((c) => c.value === "");
	const toRadix = (v: string) => (v === "" && hasEmpty ? EMPTY : v);
	const item = (c: Choice) => (
		<SelectItem key={c.value} value={toRadix(c.value)} disabled={c.disabled} hint={c.hint}>
			{c.label}
		</SelectItem>
	);
	return (
		<>
			<Select
				value={toRadix(current)}
				onValueChange={(v) => set(v === EMPTY ? "" : v)}
				disabled={disabled || !hydrated}
			>
				<SelectTrigger
					id={id}
					size={size}
					className={className}
					aria-label={props["aria-label"]}
					aria-invalid={props["aria-invalid"]}
					aria-describedby={props["aria-describedby"]}
				>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{choices.map((c) =>
						isGroup(c) ? (
							<SelectGroup key={c.label}>
								<SelectLabel>{c.label}</SelectLabel>
								{c.choices.map(item)}
							</SelectGroup>
						) : (
							item(c)
						),
					)}
				</SelectContent>
			</Select>
			{name ? <input type="hidden" name={name} value={current} /> : null}
		</>
	);
}

export {
	type Choice,
	type ChoiceFieldProps,
	type ChoiceGroup,
	type Choices,
	flatChoices,
	isGroup,
	OptionSelect,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
	selectTriggerClass,
	useChoice,
};
