import {
	type BucketState,
	canAssign,
	dayKeyAt,
	hourAt,
	matchBuckets,
	monthKeyAt,
	monthOfDay,
	parseDollars,
	quickAddChoices,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@noodle/ui/components/popover";
import { RowButton } from "@noodle/ui/components/row-button";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, Delete, Ellipsis, ReceiptText, Search } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	Suspense,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, monthName, shortDay } from "../format";
import type { MemberSummary } from "../members";
import {
	bucketUsesQuery,
	membersQuery,
	monthQuery,
	quickAddRulesQuery,
	useMonthState,
} from "../queries";
import { type QuickAddVariables, useQuickAdd } from "../quick-add";
import { type CaptureDraft, type SnapResult, typedAmount } from "../snap";
import { ForPicker } from "./for-picker";
import { SnapAndSpeak } from "./quick-add-capture";

/** The search param that opens Quick Add over whatever screen is showing. */
export const quickAddSearch = { sheet: "quick-add" } as const;

/**
 * True while Quick Add is open on a history entry the app pushed, so closing it goes Back to
 * the page underneath. Arriving on a URL that already opens it (or reloading) leaves it false,
 * and closing then removes the param in place.
 */
let openedInApp = false;

/**
 * What's typed so far, kept when Quick Add closes without adding (a stray swipe, Back), so opening
 * it again picks up where it was. Cleared once it's added.
 */
const emptyDraft = { amount: "", note: "", forMemberIds: [] as string[] };
let draft = emptyDraft;

/** Call when pushing the entry that opens Quick Add. */
export function markQuickAddOpened() {
	openedInApp = true;
}

/**
 * Quick Add, over any screen in the app frame: open while the URL says `?sheet=quick-add`, so
 * the iPhone back gesture closes it and the screen underneath stays mounted. Also opens with Q.
 */
export function QuickAdd({ timeZone, parentId }: { timeZone: string; parentId: string }) {
	const open = useSearch({
		from: "/_authed/_household",
		select: (search) => search.sheet === quickAddSearch.sheet,
	});
	const navigate = useNavigate();
	const router = useRouter();
	const quickAdd = useQuickAdd();
	const content = useRef<HTMLDivElement>(null);
	const stepBack = useRef<(() => boolean) | null>(null);

	useEffect(() => {
		if (!open) openedInApp = false;
	}, [open]);

	const close = useCallback(() => {
		if (openedInApp) {
			openedInApp = false;
			router.history.back();
		} else {
			void navigate({
				to: ".",
				search: ({ sheet: _, ...rest }) => rest,
				replace: true,
				resetScroll: false,
			});
		}
	}, [navigate, router]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (open || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key !== "q" && event.key !== "Q") return;
			// Not while typing, nor from inside another dialog (the Glossary, a sheet).
			if (
				(event.target as HTMLElement).closest(
					"input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog]",
				)
			)
				return;
			event.preventDefault();
			markQuickAddOpened();
			void navigate({
				to: ".",
				search: (prev) => ({ ...prev, ...quickAddSearch }),
				resetScroll: false,
			});
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, navigate]);

	return (
		<Sheet open={open} onOpenChange={(isOpen) => (isOpen ? undefined : close())}>
			<SheetContent
				ref={content}
				aria-describedby={undefined}
				// Phones: the large detent, so the amount, the six Buckets and the keypad all fit at
				// 375×667 without scrolling (ADR-0031).
				className="gap-3 [--key:3rem] max-lg:max-h-[calc(var(--visible-height,100dvh)-8px-var(--safe-top))]"
				// Focus the sheet, not the note field, so the phone keyboard stays down.
				// Esc steps back first (More Buckets, then a typed search), and only then closes.
				onEscapeKeyDown={(event) => {
					if (stepBack.current?.()) event.preventDefault();
				}}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.focus();
				}}
			>
				<SheetHeader title="Quick Add" />
				<Suspense fallback={<QuickAddPending />}>
					<QuickAddForm
						stepBack={stepBack}
						timeZone={timeZone}
						parentId={parentId}
						onAdd={(variables) => {
							close();
							quickAdd.mutate(variables);
						}}
					/>
				</Suspense>
			</SheetContent>
		</Sheet>
	);
}

/** Whole dollars are capped at five digits: Quick Add is for everyday spending. */
const MAX_WHOLE_DIGITS = 5;

/** The grid always has this many cells: the likely Buckets, then More Buckets if any are left. */
const CELLS = 6;

/** How long the Buckets hold still after a finger lands on them, so a tile can't jump away. */
const HOLD_MS = 400;

/** Why a Bucket sits where it does, said on its tile. */
type Reason = "suggested" | "rule" | "merchant" | "likely" | "picked";
const reasonHint: Partial<Record<Reason, string>> = {
	suggested: "Suggested",
	rule: "From your Rule",
	picked: "Picked",
};

/** The amount as typed, after pressing a key; null if the key can't apply. */
function typed(amount: string, key: string): string | null {
	if (key === "Backspace") return amount.slice(0, -1);
	const [whole = "", fraction] = amount.split(".");
	if (key === ".") return fraction === undefined ? `${whole || "0"}.` : null;
	if (!/^\d$/.test(key)) return null;
	if (fraction !== undefined) return fraction.length < 2 ? amount + key : null;
	if (whole === "0") return key;
	return whole.length < MAX_WHOLE_DIGITS ? amount + key : null;
}

function QuickAddForm({
	timeZone,
	parentId,
	stepBack,
	onAdd,
}: {
	/** What Esc does before it closes: set by the form, asked by the sheet. */
	stepBack: RefObject<(() => boolean) | null>;
	timeZone: string;
	/** The signed-in Parent: the other Parent's Personal Allowance isn't theirs to spend from. */
	parentId: string;
	onAdd: (variables: QuickAddVariables) => void;
}) {
	// Fixed for this entry: the day it's dated and its ID, reused by any retry.
	const [entry] = useState(() => {
		const now = new Date();
		return {
			today: dayKeyAt(now, timeZone),
			hour: hourAt(now, timeZone),
			month: monthKeyAt(now, timeZone),
			transactionId: ulid(),
		};
	});
	const queryClient = useQueryClient();
	const uses = useQuery(bucketUsesQuery()).data ?? [];
	const rules = useQuery(quickAddRulesQuery()).data ?? [];
	const [amount, setAmount] = useState(draft.amount);
	// Read by key presses, which can arrive faster than re-renders.
	const typedSoFar = useRef(draft.amount);
	const [note, setNote] = useState(draft.note);
	const members = useSuspenseQuery(membersQuery()).data;
	const [forMemberIds, setForMemberIds] = useState(draft.forMemberIds);
	const display = useRef<HTMLOutputElement>(null);
	const added = useRef(false);
	useEffect(() => {
		if (!added.current) draft = { amount, note, forMemberIds };
	}, [amount, note, forMemberIds]);
	const cents = parseDollars(amount) ?? 0;
	// What a snapped Receipt or a phrase filled in: a Bucket to offer first, and the Receipt.
	const [suggested, setSuggested] = useState<string | null>(null);
	const [filled, setFilled] = useState(false);
	const [receipt, setReceipt] = useState<(SnapResult & { kind: "draft" }) | null>(null);
	const [attached, setAttached] = useState<(SnapResult & { kind: "attached" }) | null>(null);
	// The main page, or More Buckets (a page inside the same sheet), and what was picked there.
	const [page, setPage] = useState<"main" | "more">("main");
	const [picked, setPicked] = useState<string | null>(null);
	// The Buckets of the month it's dated in: a Receipt's, unless that month has no Plan to add it
	// to (the server refuses a Bucket that isn't in it), and then today's, and the Parent is told.
	const receiptMonth = receipt ? monthOfDay(receipt.date) : entry.month;
	const inReceiptMonth = useMonthState(receiptMonth).buckets.filter((b) => canAssign(b, parentId));
	const inThisMonth = useMonthState(entry.month).buckets.filter((b) => canAssign(b, parentId));
	const datedToday = receipt !== null && inReceiptMonth.length === 0;
	// The note steers the order (ADR-0031), once it has stopped changing for a moment, so the
	// Buckets don't shuffle with every letter.
	const steeringNote = useSettled(note, NOTE_SETTLE_MS);
	const choices: { bucket: BucketState; reason: Reason }[] = quickAddChoices({
		buckets: datedToday ? inThisMonth : inReceiptMonth,
		uses,
		rules,
		note: steeringNote,
		today: entry.today,
		hour: entry.hour,
		suggested,
	});
	// A Bucket picked from More Buckets goes first, until the amount is added to it.
	const pickedFirst = picked
		? [
				...choices
					.filter((c) => c.bucket.id === picked)
					.map((c) => ({ ...c, reason: "picked" as const })),
				...choices.filter((c) => c.bucket.id !== picked),
			]
		: choices;
	// Steadiness: within HOLD_MS of a finger landing on the grid, keep the order shown.
	const [held, setHeld] = useState(false);
	const holdTimer = useRef<number | undefined>(undefined);
	const shownOrder = useRef<string[]>([]);
	const ranked = held
		? [...pickedFirst].sort((a, b) => rank(shownOrder.current, a) - rank(shownOrder.current, b))
		: pickedFirst;
	const orderKey = ranked.map((c) => c.bucket.id).join(" ");
	useEffect(() => {
		shownOrder.current = orderKey.split(" ");
	}, [orderKey]);
	useEffect(() => () => window.clearTimeout(holdTimer.current), []);
	function hold() {
		setHeld(true);
		window.clearTimeout(holdTimer.current);
		holdTimer.current = window.setTimeout(() => setHeld(false), HOLD_MS);
	}
	const buckets = ranked.map((c) => c.bucket);
	// A suggested Bucket takes a whole row, so "Suggested" fits on a phone.
	const wide = ranked[0]?.reason === "suggested" ? 1 : 0;
	const fitsAll = ranked.length + wide <= CELLS;
	const shown = fitsAll ? ranked : ranked.slice(0, CELLS - 1 - wide);
	const grid = useRef<HTMLUListElement>(null);
	useFlip(grid, orderKey);

	// Computers: a Find box over a listbox of the likely Buckets, or of what the letters match
	// (ADR-0031). The highlight follows ↑/↓; Enter and the Add button add to it.
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const find = useRef<HTMLInputElement>(null);
	const listId = useId();
	const finding = query.trim() !== "";
	const options: { bucket: BucketState; hint?: string }[] = finding
		? matchBuckets(query, buckets, rules).map((match) => ({
				bucket: match.bucket,
				hint: match.via === "rule" ? `via your ${match.pattern} Rule` : undefined,
			}))
		: (ranked.length <= CELLS ? ranked : ranked.slice(0, CELLS - 1)).map((choice) => ({
				bucket: choice.bucket,
				hint: reasonHint[choice.reason],
			}));
	const unlisted = finding ? 0 : ranked.length - options.length;
	const activeAt = Math.min(active, Math.max(0, options.length - 1));
	const highlighted = options[activeAt]?.bucket;
	const optionId = (id: string) => `${listId}-${id}`;
	const highlightedId = highlighted?.id;
	useEffect(() => {
		if (highlightedId)
			document.getElementById(`${listId}-${highlightedId}`)?.scrollIntoView({ block: "nearest" });
	}, [highlightedId, listId]);
	// Keys pressed with nothing focused, read by the handler below (set up once).
	const desktopKeys = useRef<(event: KeyboardEvent) => void>(() => {});
	useEffect(
		() => () => {
			stepBack.current = null;
		},
		[stepBack],
	);
	function filter(next: string) {
		setQuery(next);
		setActive(0);
	}
	function move(by: number) {
		setActive(Math.max(0, Math.min(options.length - 1, activeAt + by)));
	}

	/** Fills the form in with what was read, for the Parent to check before they save it. */
	function fill(draft: CaptureDraft) {
		const said = draft.amountCents === null ? null : typedAmount(draft.amountCents);
		if (said !== null) {
			typedSoFar.current = said;
			setAmount(said);
		}
		if (draft.note) setNote(draft.note.slice(0, 80));
		if (draft.forMemberIds.length > 0) setForMemberIds(draft.forMemberIds);
		setSuggested(draft.bucketId);
		setPicked(null);
		setFilled(true);
	}

	async function snapped(result: SnapResult) {
		if (result.kind === "attached") return setAttached(result);
		// Its month's Buckets, loaded before they're offered so the sheet doesn't blank meanwhile.
		await queryClient.ensureQueryData(monthQuery(monthOfDay(result.date))).catch(() => undefined);
		setReceipt(result);
		fill(result.draft);
	}

	const shake = useCallback(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		display.current?.animate(
			[
				{ transform: "none" },
				{ transform: "translateX(-5px)" },
				{ transform: "translateX(5px)" },
				{ transform: "none" },
			],
			{ duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
		);
	}, []);

	const press = useCallback(
		(key: string) => {
			const next = typed(typedSoFar.current, key);
			if (next === null) return shake();
			typedSoFar.current = next;
			setAmount(next);
		},
		[shake],
	);

	// A hardware keyboard types the amount too (the keypad is hidden on desktop).
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if ((event.target as HTMLElement).closest("input, textarea")) return;
			if (/^[\d.]$/.test(event.key) || event.key === "Backspace") {
				event.preventDefault();
				press(event.key);
			} else desktopKeys.current(event);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [press]);

	function add(bucket: BucketState) {
		if (cents === 0) return shake();
		// A double tap lands here twice; the ID would make it count once anyway.
		if (added.current) return;
		added.current = true;
		draft = emptyDraft;
		onAdd({
			transactionId: entry.transactionId,
			bucketId: bucket.id,
			bucketName: bucket.name,
			amountCents: cents,
			note: note.trim(),
			forMemberIds,
			date: receipt && !datedToday ? receipt.date : entry.today,
			receiptId: receipt?.receiptId,
			datedToday,
		});
	}

	/** From More Buckets: with an amount, that's the save; without one, it goes first in the grid. */
	function pickFromMore(bucket: BucketState) {
		if (cents > 0) return add(bucket);
		setSuggested(null);
		setPicked(bucket.id);
		setPage("main");
	}

	/** On a computer: add to the highlighted (or clicked) Bucket; with no amount, it goes first. */
	function choose(bucket: BucketState | undefined) {
		if (!bucket) return;
		if (cents > 0) return add(bucket);
		shake();
		setSuggested(null);
		setPicked(bucket.id);
		filter("");
	}

	desktopKeys.current = (event) => {
		if (page !== "main" || !window.matchMedia("(min-width: 64rem)").matches) return;
		// A focused button, link or the For picker keeps its own keys.
		if ((event.target as HTMLElement).closest("button, a, [role=radio], [role=checkbox]")) return;
		if (/^[a-z]$/i.test(event.key)) {
			event.preventDefault();
			filter(event.key);
			find.current?.focus();
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			move(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(highlighted);
		}
	};
	stepBack.current = () => {
		if (page === "more") {
			setPage("main");
			return true;
		}
		if (query) {
			filter("");
			return true;
		}
		return false;
	};

	if (attached) {
		const { transaction } = attached;
		return (
			<div className="grid justify-items-center gap-3 py-6 text-center">
				<p className="text-sm text-muted-foreground">
					That Receipt is for {transaction.note || "a Transaction"},{" "}
					{formatMoney(transaction.amountCents)} on {shortDay(transaction.date)}, already in
					Transactions. It’s attached there
					{attached.applied ? ", split across its Buckets." : "."}
				</p>
				<Button variant="outline" asChild>
					<Link
						to="/transactions/$month/$transactionId"
						params={{ month: monthOfDay(transaction.date), transactionId: transaction.id }}
					>
						See it in Transactions
					</Link>
				</Button>
			</div>
		);
	}

	if (buckets.length === 0) {
		return (
			<div className="grid justify-items-center gap-3 py-6 text-center">
				<p className="text-sm text-muted-foreground">
					Quick Add files spending into a Bucket. Add one to your Plan first.
				</p>
				<Button variant="outline" asChild>
					<Link to="/plan/$month" params={{ month: entry.month }}>
						Set up the Plan
					</Link>
				</Button>
			</div>
		);
	}

	if (page === "more") {
		return (
			<MoreBuckets
				buckets={buckets}
				rules={rules}
				onBack={() => setPage("main")}
				onPick={pickFromMore}
			/>
		);
	}

	const [whole = "", fraction] = amount.split(".");
	return (
		<>
			{/* On a screen too short for all of it, the sheet scrolls under the keypad, which stays put.
			    Each control's scroll margin is the keypad's height (four keys, their gaps, its padding
			    and border), so one that takes focus or is scrolled to stops above the keypad, not
			    behind it: "For" was out of reach there (issue 110). No keypad with the keyboard up. */}
			<div
				className={cn(
					"grid gap-2",
					"max-lg:[&_:is(button,input)]:scroll-mb-[calc(4*var(--key)+27px+var(--safe-bottom))]",
					"max-lg:[[data-keyboard]_&_:is(button,input)]:scroll-mb-0",
				)}
			>
				<div className="grid justify-items-center gap-1">
					<output
						ref={display}
						aria-label="Amount"
						className={cn(
							"inline-flex items-start text-[2.75rem] leading-none font-semibold tracking-[-0.045em] tabular-nums",
							!amount && "text-subtle-foreground",
						)}
					>
						<span className="mt-[0.2em] me-0.5 text-[0.5em] tracking-normal text-subtle-foreground">
							$
						</span>
						{Number(whole || "0").toLocaleString("en-US")}
						{fraction === undefined ? null : `.${fraction}`}
					</output>
					<p className="min-h-[1.4em] text-[13px] text-subtle-foreground">
						{/* A phone taps a tile; a computer picks a row or types to find one (ADR-0031). */}
						{cents === 0 ? (
							"Type an amount"
						) : (
							<>
								<span className="lg:hidden">
									{filled ? "Check it, then tap a Bucket to add it" : "Tap a Bucket to add it"}
								</span>
								<span className="max-lg:hidden">
									{filled ? "Check it, then pick a Bucket" : "Pick a Bucket, or type to find one"}
								</span>
							</>
						)}
					</p>
				</div>
				{/* The note sits over the Buckets and steers them: "costco" puts Groceries first. */}
				<SnapAndSpeak onPhrase={fill} onSnap={snapped}>
					<Input
						aria-label="Note"
						placeholder="Where or what?"
						maxLength={80}
						autoComplete="off"
						enterKeyHint="done"
						value={note}
						onChange={(event) => setNote(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							// On a computer, Enter with an amount adds to the highlighted Bucket (ADR-0031);
							// on a phone it just closes the keyboard.
							if (cents > 0 && window.matchMedia("(min-width: 64rem)").matches) {
								event.preventDefault();
								choose(highlighted);
							} else event.currentTarget.blur();
						}}
					/>
				</SnapAndSpeak>
				{receipt ? (
					<p className="flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
						<ReceiptText className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
						<span>
							Receipt{receipt.draft.note ? ` from ${receipt.draft.note}` : ""}, dated{" "}
							{shortDay(receipt.date)}
							{datedToday
								? `. ${monthName(receiptMonth)} has no Plan, so it’s added today`
								: receiptMonth !== entry.month
									? `, so it’s added to ${monthName(receiptMonth)}`
									: ""}
							{receipt.buckets > 1 ? ". Split it across its Buckets from Transactions." : ""}
						</span>
					</p>
				) : null}
				{/* Six cells at a fixed height, so nothing below moves as they reorder. */}
				<ul
					ref={grid}
					aria-label="Add to"
					className="grid grid-cols-2 grid-rows-[repeat(3,3.125rem)] gap-2 lg:hidden"
					onPointerDownCapture={hold}
				>
					{shown.map(({ bucket, reason }) => (
						<li
							key={bucket.id}
							data-pick={bucket.id}
							className={cn("grid", reason === "suggested" && "col-span-2")}
						>
							<BucketPick
								bucket={bucket}
								ready={cents > 0}
								hint={reasonHint[reason]}
								onPick={() => add(bucket)}
							/>
						</li>
					))}
					{fitsAll ? null : (
						<li data-pick="more" className="grid">
							<RowButton
								variant="tile"
								aria-label={`More Buckets, ${ranked.length - shown.length} more`}
								onClick={() => setPage("more")}
								className="h-full grid-cols-[32px_minmax(0,1fr)]"
							>
								<Tile aria-hidden="true" className="row-span-2 size-8 rounded-[10px]">
									<Ellipsis className="size-4" strokeWidth={2} />
								</Tile>
								<span className="truncate text-[13px] leading-tight font-medium">
									{/* "More" on the narrowest phones, where "More Buckets" was cut short (issue 110). */}
									More<span className="max-[359px]:sr-only"> Buckets</span>
								</span>
								<span className="truncate text-xs text-subtle-foreground tabular-nums">
									{ranked.length - shown.length} more
								</span>
							</RowButton>
						</li>
					)}
				</ul>
				{/* Computers: Find a Bucket over six rows at a fixed height, so the sheet never scrolls.
				    Letters filter, ↑/↓ move, Enter adds; digits with the box empty type the amount. */}
				<div className="grid gap-2 max-lg:hidden">
					<div className="relative">
						<Search
							aria-hidden="true"
							strokeWidth={1.75}
							className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
						/>
						<Input
							ref={find}
							role="combobox"
							aria-label="Find a Bucket"
							aria-controls={listId}
							aria-expanded="true"
							aria-autocomplete="list"
							aria-activedescendant={highlighted ? optionId(highlighted.id) : undefined}
							placeholder="Find a Bucket"
							autoComplete="off"
							className="ps-9"
							value={query}
							onChange={(event) => filter(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (!query && (/^[\d.]$/.test(event.key) || event.key === "Backspace")) {
									event.preventDefault();
									press(event.key);
								} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
									event.preventDefault();
									move(event.key === "ArrowDown" ? 1 : -1);
								} else if (event.key === "Enter") {
									event.preventDefault();
									choose(highlighted);
								}
							}}
						/>
					</div>
					<div className="flex h-66 flex-col">
						<div
							id={listId}
							role="listbox"
							aria-label="Add to"
							className="min-h-0 overflow-y-auto overscroll-contain"
						>
							{options.map(({ bucket, hint }, at) => (
								<div
									key={bucket.id}
									id={optionId(bucket.id)}
									role="option"
									aria-selected={at === activeAt}
									tabIndex={-1}
									// The Find box keeps focus; a click adds, as Enter does.
									onMouseDown={(event) => event.preventDefault()}
									onMouseMove={() => setActive(at)}
									onClick={() => choose(bucket)}
									onKeyDown={() => undefined}
									className="flex h-11 cursor-pointer items-center gap-3 rounded-lg px-2 aria-selected:bg-muted"
								>
									<Tile
										bucket={asBucketColor(bucket.color)}
										aria-hidden="true"
										className="size-7 shrink-0 rounded-[9px] text-xs"
									>
										{monogram(bucket.name)}
									</Tile>
									<span className="min-w-0 flex-1 truncate text-sm font-medium">{bucket.name}</span>
									{/* "$800 left · Suggested", as the phone's tile reads. */}
									<span className="max-w-[60%] shrink-0 truncate text-xs text-subtle-foreground tabular-nums">
										{formatMoney(Math.max(0, bucket.left))} left
										{hint ? <span className="text-muted-foreground"> · {hint}</span> : null}
									</span>
								</div>
							))}
						</div>
						{unlisted > 0 ? (
							<p className="flex h-11 shrink-0 items-center gap-3 px-2 text-sm text-subtle-foreground">
								<Ellipsis className="mx-1.5 size-4" strokeWidth={2} aria-hidden="true" />
								{unlisted} more — type to find
							</p>
						) : null}
						{options.length === 0 ? (
							<p className="px-2 py-3 text-sm text-muted-foreground">
								No Bucket matches “{query.trim()}”.
							</p>
						) : null}
					</div>
					<Button
						type="button"
						aria-disabled={cents === 0}
						onClick={() => choose(highlighted)}
						className="aria-disabled:opacity-60"
					>
						<span className="truncate">
							{cents > 0 ? `Add ${formatMoney(cents)}` : "Add"} to {highlighted?.name ?? "a Bucket"}
						</span>
					</Button>
				</div>
				<ForLine members={members} value={forMemberIds} onChange={setForMemberIds} />
			</div>
			{/* Phones: the keypad stays at the bottom, in thumb reach. With the keyboard up for the
			    note, it steps aside: the keyboard has numbers too. */}
			<SheetFooter className="max-lg:pt-2 lg:hidden [[data-keyboard]_&]:hidden">
				<fieldset className="grid grid-cols-3 gap-0.5">
					<legend className="sr-only">Keypad</legend>
					{["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((key) => (
						<Key
							key={key}
							label={key === "." ? "Decimal point" : undefined}
							onPress={() => press(key)}
						>
							{key}
						</Key>
					))}
					<Key label="Delete" onPress={() => press("Backspace")}>
						<Delete className="size-5.5" strokeWidth={1.75} />
					</Key>
				</fieldset>
			</SheetFooter>
		</>
	);
}

/** Where a Bucket was in the order shown; one not shown goes after. */
function rank(order: string[], choice: { bucket: BucketState }) {
	const at = order.indexOf(choice.bucket.id);
	return at === -1 ? order.length : at;
}

/** Slides tiles from where they were to where they are when the order changes (FLIP). */
function useFlip(list: RefObject<HTMLUListElement | null>, orderKey: string) {
	const was = useRef(new Map<string, DOMRect>());
	useLayoutEffect(() => {
		if (!orderKey) return;
		const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-pick]") ?? [])];
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const now = new Map(
			items.map((item) => [item.dataset.pick ?? "", item.getBoundingClientRect()]),
		);
		for (const item of items) {
			const before = was.current.get(item.dataset.pick ?? "");
			const after = now.get(item.dataset.pick ?? "");
			if (still || !before || !after) continue;
			const dx = before.left - after.left;
			const dy = before.top - after.top;
			if (dx === 0 && dy === 0) continue;
			item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
				duration: 220,
				easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
			});
		}
		was.current = now;
	}, [list, orderKey]);
}

/** A Bucket to add the amount to, with what it has left. Colour says which Bucket, nothing more. */
function BucketPick({
	bucket,
	ready,
	hint,
	onPick,
}: {
	bucket: BucketState;
	ready: boolean;
	/** Why it's here: Suggested (a Receipt or a phrase), From your Rule, or Picked from More. */
	hint?: string;
	onPick: () => void;
}) {
	const color = asBucketColor(bucket.color);
	return (
		<RowButton
			variant="tile"
			bucket={color}
			aria-disabled={!ready}
			onClick={onPick}
			className={cn("h-full grid-cols-[32px_minmax(0,1fr)]", hint && "border-border-strong")}
		>
			<Tile bucket={color} aria-hidden="true" className="row-span-2 size-8 rounded-[10px]">
				{monogram(bucket.name)}
			</Tile>
			<span className="truncate text-[13px] leading-tight font-medium">{bucket.name}</span>
			<span className="truncate text-xs text-subtle-foreground tabular-nums">
				{formatMoney(Math.max(0, bucket.left))} left
				{hint ? <span className="text-muted-foreground"> · {hint}</span> : null}
			</span>
		</RowButton>
	);
}

/** Who it was For, on one line; the picker opens over the Buckets. */
function ForLine({
	members,
	value,
	onChange,
}: {
	members: MemberSummary[];
	value: string[];
	onChange: (value: string[]) => void;
}) {
	const [open, setOpen] = useState(false);
	// The picker stays inside the sheet, so it's part of the dialog.
	const [host, setHost] = useState<HTMLDivElement | null>(null);
	const names = value.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
	return (
		<div ref={setHost} className="flex h-8 items-center">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="-ms-2 gap-1 text-muted-foreground"
					>
						For:{" "}
						<span className="text-foreground">{names.length ? names.join(", ") : "Everyone"}</span>
						<ChevronDown strokeWidth={1.75} aria-hidden="true" />
					</Button>
				</PopoverTrigger>
				<PopoverContent
					container={host}
					side="top"
					align="start"
					className="w-[min(24rem,calc(100vw-32px))]"
				>
					<ForPicker
						members={members}
						value={value}
						onChange={(next) => {
							onChange(next);
							setOpen(false);
						}}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

/**
 * More Buckets: every Bucket the Parent may spend from, likely first, with search, in the same
 * sheet. Household Buckets, then their own Personal Allowance.
 */
function MoreBuckets({
	buckets,
	rules,
	onBack,
	onPick,
}: {
	buckets: BucketState[];
	rules: Parameters<typeof matchBuckets>[2];
	onBack: () => void;
	onPick: (bucket: BucketState) => void;
}) {
	const [query, setQuery] = useState("");
	const search = useRef<HTMLInputElement>(null);
	// The search is what this page is for, so the keyboard comes up with it.
	useEffect(() => search.current?.focus(), []);
	const matches = matchBuckets(query, buckets, rules);
	return (
		<div className="flex min-h-0 flex-col gap-3 max-lg:h-[min(34rem,70dvh)] lg:max-h-[min(36rem,75dvh)]">
			<div className="flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-lg"
					aria-label="Back to Quick Add"
					className="-ms-2"
					onClick={onBack}
				>
					<ChevronLeft strokeWidth={1.75} />
				</Button>
				<h3 className="text-sm font-semibold">More Buckets</h3>
			</div>
			<div className="relative">
				<Search
					aria-hidden="true"
					strokeWidth={1.75}
					className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
				/>
				<Input
					ref={search}
					type="search"
					aria-label="Find a Bucket"
					placeholder="Find a Bucket"
					autoComplete="off"
					enterKeyHint="search"
					className="ps-9"
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
					onKeyDown={(event) => {
						const first = matches[0];
						if (event.key === "Enter" && first) onPick(first.bucket);
					}}
				/>
			</div>
			{/* A long list scrolls inside itself, under the search. */}
			<div className="-mx-1 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto overscroll-contain px-1">
				{matches.length === 0 ? (
					<p className="text-sm text-muted-foreground">No Bucket matches “{query.trim()}”.</p>
				) : null}
				<MoreSection
					title="Household"
					matches={matches.filter((m) => m.bucket.owner === undefined)}
					onPick={onPick}
				/>
				<MoreSection
					title="My Personal Allowance"
					matches={matches.filter((m) => m.bucket.owner !== undefined)}
					onPick={onPick}
				/>
			</div>
		</div>
	);
}

function MoreSection({
	title,
	matches,
	onPick,
}: {
	title: string;
	matches: { bucket: BucketState; via: "name" | "rule"; pattern?: string }[];
	onPick: (bucket: BucketState) => void;
}) {
	const id = useId();
	if (matches.length === 0) return null;
	return (
		<section aria-labelledby={id} className="grid gap-1">
			<h4 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				{title}
			</h4>
			<ul className="grid">
				{matches.map((match) => {
					const color = asBucketColor(match.bucket.color);
					return (
						<li key={match.bucket.id}>
							<RowButton onClick={() => onPick(match.bucket)} className="min-h-12">
								<Tile bucket={color} aria-hidden="true" className="size-8 shrink-0 rounded-[10px]">
									{monogram(match.bucket.name)}
								</Tile>
								<span className="grid min-w-0 flex-1 text-start">
									<span className="truncate text-sm font-medium">{match.bucket.name}</span>
									{match.via === "rule" ? (
										<span className="truncate text-xs text-subtle-foreground">
											via your {match.pattern} Rule
										</span>
									) : null}
								</span>
								<span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
									{formatMoney(Math.max(0, match.bucket.left))} left
								</span>
							</RowButton>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function Key({
	label,
	onPress,
	children,
}: {
	label?: string;
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<RowButton variant="key" aria-label={label} onClick={onPress} className="h-(--key)">
			{children}
		</RowButton>
	);
}

function QuickAddPending() {
	return (
		<div role="status" aria-label="Loading" className="grid gap-4">
			<Skeleton className="h-11 w-32 justify-self-center" />
			<div className="grid grid-cols-2 gap-2">
				{[0, 1, 2, 3, 4, 5].map((pick) => (
					<Skeleton key={pick} className="h-12.5 rounded-xl" />
				))}
			</div>
		</div>
	);
}

/** How long the note must stay unchanged before it reorders the Buckets. */
const NOTE_SETTLE_MS = 150;

/** `value`, once it has stayed the same for `ms`. */
function useSettled<T>(value: T, ms: number): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), ms);
		return () => clearTimeout(timer);
	}, [value, ms]);
	return settled;
}
