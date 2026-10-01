import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { WithTooltip } from "@noodle/ui/components/tooltip";
import { cn } from "@noodle/ui/lib/utils";
import { CircleHelp, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { type GlossaryEntry, type GlossaryId, glossaryEntries } from "../glossary";

// The Glossary opens over whatever page is showing, from the help icon in the shell and from a
// term's "?" popover (ADR-0018). /glossary still shows the same list as a page, for a link.

type GlossaryState = { open: boolean; term: GlossaryId | null };

let state: GlossaryState = { open: false, term: null };
/** Where focus goes back to when it closes, when that isn't what had focus as it opened. */
let returnTo: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: GlossaryState) {
	state = next;
	for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/**
 * Opens the Glossary over the page, at `term` if given. `from` is the control focus returns to
 * when it closes, for one that won't have focus as it opens (a popover's trigger).
 */
export function openGlossary(term: GlossaryId | null = null, from: HTMLElement | null = null) {
	returnTo = from;
	set({ open: true, term });
}

const matches = (entry: GlossaryEntry, query: string) =>
	[entry.term, entry.short, entry.more, entry.was].some((text) =>
		text?.toLowerCase().includes(query),
	);

/** Every term, A to Z, or those whose words include `query`; `highlight` is marked. */
export function GlossaryList({
	query = "",
	highlight = null,
	className,
}: {
	query?: string;
	highlight?: GlossaryId | null;
	className?: string;
}) {
	const wanted = query.trim().toLowerCase();
	const shown = wanted
		? glossaryEntries.filter(([, entry]) => matches(entry, wanted))
		: glossaryEntries;
	if (shown.length === 0) {
		return (
			<p className="py-6 text-center text-sm text-muted-foreground">
				No words match “{query.trim()}”.
			</p>
		);
	}
	return (
		<dl className={cn("grid gap-1", className)}>
			{shown.map(([id, entry]) => (
				<div
					key={id}
					id={id}
					data-highlighted={id === highlight || undefined}
					className={cn(
						"grid scroll-mt-4 gap-1 rounded-xl px-3 py-2.5",
						"target:bg-brand-soft data-highlighted:bg-brand-soft",
					)}
				>
					<dt className="text-[15px] font-semibold">{entry.term}</dt>
					<dd className="grid gap-1 text-sm text-muted-foreground">
						<p>{entry.short}</p>
						{entry.more ? <p>{entry.more}</p> : null}
						{entry.was ? <p className="text-[13px]">Used to be called “{entry.was}”.</p> : null}
					</dd>
				</div>
			))}
		</dl>
	);
}

/** A search box over the Glossary, saying how many words it finds. */
export function GlossarySearch({
	query,
	onQueryChange,
}: {
	query: string;
	onQueryChange: (query: string) => void;
}) {
	const id = useId();
	const wanted = query.trim().toLowerCase();
	const count = wanted
		? glossaryEntries.filter(([, entry]) => matches(entry, wanted)).length
		: glossaryEntries.length;
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="sr-only">
				Search the Glossary
			</label>
			<div className="relative">
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
				/>
				<Input
					id={id}
					type="search"
					placeholder="Search words"
					autoComplete="off"
					value={query}
					onChange={(event) => onQueryChange(event.currentTarget.value)}
					className="ps-9"
				/>
			</div>
			<p role="status" className="sr-only">
				{wanted ? `${count} ${count === 1 ? "word" : "words"} found` : ""}
			</p>
		</div>
	);
}

/** The Glossary over the page: a dialog on desktop, a sheet from the bottom on phones. */
export function GlossaryDialog() {
	const { open, term } = useSyncExternalStore(
		subscribe,
		() => state,
		() => state,
	);
	const [query, setQuery] = useState("");
	const list = useRef<HTMLDivElement>(null);

	// Opened at a term: show it at the top of the list.
	useEffect(() => {
		if (!open || !term) return;
		const frame = requestAnimationFrame(() => {
			list.current
				?.querySelector(`[id="${term}"]`)
				?.scrollIntoView({ block: "start", behavior: "instant" });
		});
		return () => cancelAnimationFrame(frame);
	}, [open, term]);

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					set({ open: false, term: state.term });
					setQuery("");
				}
			}}
		>
			<SheetContent
				aria-describedby={undefined}
				className={cn(
					// Phones have the grabber above the header.
					"grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-3 overflow-hidden lg:grid-rows-[auto_auto_minmax(0,1fr)]",
					"h-[calc(100dvh-16px-env(safe-area-inset-top))] lg:h-[min(44rem,calc(100dvh-48px))] lg:w-140",
				)}
				// Searching isn't something to keep: leaving doesn't need to ask (LeaveGuard).
				onInputCapture={(event) => {
					delete event.currentTarget.dataset.dirty;
				}}
				onCloseAutoFocus={(event) => {
					const target = returnTo;
					returnTo = null;
					if (target?.isConnected) {
						event.preventDefault();
						target.focus({ preventScroll: true });
					}
				}}
			>
				<SheetHeader title="Glossary" />
				<GlossarySearch query={query} onQueryChange={setQuery} />
				<div ref={list} className="-mx-2 overflow-y-auto overscroll-contain px-0.5 pb-2">
					<GlossaryList query={query} highlight={query ? null : term} />
				</div>
			</SheetContent>
		</Sheet>
	);
}

/** A small "?" in the shell that opens the Glossary, named and with a tooltip. */
export function GlossaryButton({ className }: { className?: string }) {
	return (
		<WithTooltip label="Glossary">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Glossary"
				aria-haspopup="dialog"
				className={className}
				onClick={() => openGlossary()}
			>
				<CircleHelp className="size-5" />
			</Button>
		</WithTooltip>
	);
}
