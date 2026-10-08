import * as React from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "#components/command";
import { type Choice, type ChoiceGroup, type Choices, isGroup } from "#components/select";
import { Tile } from "#components/tile";
import { searchFit } from "#lib/choice-search";
import { cn } from "#lib/utils";

/** A choice's name as plain words: what a search reads and what a test finds it by. */
const choiceText = (c: Choice) => c.text ?? (typeof c.label === "string" ? c.label : c.value);

/**
 * The small square that leads a choice (issue 154): a Bucket's colour with its `letter`, as its
 * Tile in the Plan, or a neutral one holding an icon (a bill, a Goal), so a list's marks line up.
 * The letter is drawn by the stylesheet, not written in the page: the choice's words stay its name
 * alone, for a screen reader, a copy and a test.
 */
function ChoiceMark({
	className,
	letter,
	...props
}: React.ComponentProps<typeof Tile> & { letter?: string }) {
	return (
		<Tile
			aria-hidden="true"
			data-slot="choice-mark"
			data-letter={letter}
			className={cn(
				"size-6 rounded-lg text-[11px] [&_svg]:size-3.5",
				letter && "before:content-[attr(data-letter)]",
				className,
			)}
			{...props}
		/>
	);
}

/** A choice as its field shows it once chosen: its mark, then its name, cut short if it must be. */
function ChosenChoice({ choice }: { choice: Choice }) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			{choice.mark}
			<span className="truncate">{choice.label}</span>
		</span>
	);
}

/**
 * How well a search fits a choice: by its name, or by its other words, which count just under the
 * same fit in a name (typing "bill" lists "Phone bill" before the bills found by their kind).
 */
function fitOf(choice: Choice, typed: string): number | null {
	const name = searchFit([choiceText(choice)], typed);
	const also = choice.keywords?.length ? searchFit(choice.keywords, typed) : null;
	if (also === null) return name;
	return name === null ? also + 0.5 : Math.min(name, also + 0.5);
}

type Found = { group: ChoiceGroup | null; choices: Choice[]; fit: number };

/**
 * What a search leaves of the list: each group's choices that fit, best first, and the groups in
 * the order of their best fit, so the first row is the best match of all and Enter takes it.
 * Groups that tie keep their order. Nothing typed leaves the list as it was given.
 */
function foundChoices(choices: Choices, typed: string): Found[] {
	// Choices outside any group that follow one another are one run, ordered together.
	const runs: { group: ChoiceGroup | null; choices: Choice[] }[] = [];
	for (const entry of choices) {
		const last = runs.at(-1);
		if (isGroup(entry)) runs.push({ group: entry, choices: entry.choices });
		else if (last && !last.group) last.choices.push(entry);
		else runs.push({ group: null, choices: [entry] });
	}
	const found = runs.flatMap((run): Found[] => {
		const fits = run.choices
			.map((choice) => ({ choice, fit: fitOf(choice, typed) }))
			.filter((c): c is { choice: Choice; fit: number } => c.fit !== null)
			.sort((a, b) => a.fit - b.fit);
		const [best] = fits;
		return best ? [{ group: run.group, choices: fits.map((c) => c.choice), fit: best.fit }] : [];
	});
	return found.sort((a, b) => a.fit - b.fit);
}

/**
 * The one list a choice is picked from with a search box (issue 154): Combobox's and the app's
 * Bucket picker's, so they can't look or search differently. Each choice is a row at least 40px
 * tall (44px on a phone) with its `mark` first; the current one is in medium weight on the brand's
 * soft ground with a tick. Group headings stay in view while their group scrolls. Typing narrows
 * with `searchFit` (the beginning of any word, forgiving a slip), best match first.
 *
 * `children` are rows after the choices (the Bucket picker's "Create Bucket"); `foot` sits under
 * the list and doesn't scroll.
 */
function ChoiceList({
	choices,
	current,
	onChoose,
	searchPlaceholder,
	empty,
	loading,
	search: controlled,
	onSearchChange,
	listClassName,
	children,
	foot,
}: {
	choices: Choices;
	/** The chosen value: marked, and where the list starts when it opens. */
	current: string;
	onChoose: (value: string) => void;
	searchPlaceholder: string;
	/** Said when a search finds nothing. */
	empty: string;
	/** Said in place of `empty` while the choices are on their way. */
	loading?: string;
	/** What's typed, when the caller needs it (to offer to create what isn't there). */
	search?: string;
	onSearchChange?: (search: string) => void;
	listClassName?: string;
	children?: React.ReactNode;
	foot?: React.ReactNode;
}) {
	const [inner, setInner] = React.useState("");
	const search = controlled ?? inner;
	const list = React.useRef<HTMLDivElement>(null);
	// It opens on the current choice, scrolled into view, rather than at the top of the list.
	React.useEffect(() => {
		const frame = requestAnimationFrame(() =>
			list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }),
		);
		return () => cancelAnimationFrame(frame);
	}, []);
	const item = (c: Choice) => (
		<CommandItem
			key={c.value}
			value={c.value}
			disabled={c.disabled}
			checked={c.value === current}
			onSelect={() => onChoose(c.value)}
		>
			{c.mark}
			<span className="min-w-0 break-words">{c.label}</span>
		</CommandItem>
	);
	return (
		// It narrows the list itself: cmdk's own scoring finds letters anywhere in a name, in any
		// order of rows, and can't forgive a slip.
		<Command loop shouldFilter={false} defaultValue={current}>
			<CommandInput
				placeholder={searchPlaceholder}
				value={search}
				onValueChange={(next) => {
					setInner(next);
					onSearchChange?.(next);
				}}
			/>
			<CommandList ref={list} className={listClassName}>
				{loading ? (
					<p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
						{loading}
					</p>
				) : (
					<CommandEmpty>{empty}</CommandEmpty>
				)}
				{foundChoices(choices, search).map((run) =>
					run.group ? (
						<CommandGroup key={run.group.label} heading={run.group.label}>
							{run.choices.map(item)}
						</CommandGroup>
					) : (
						run.choices.map(item)
					),
				)}
				{children}
			</CommandList>
			{foot ? (
				<div data-slot="choice-list-foot" className="border-t p-1">
					{foot}
				</div>
			) : null}
		</Command>
	);
}

export { ChoiceList, ChoiceMark, ChosenChoice, choiceText, foundChoices };
