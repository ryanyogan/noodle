import {
	type BucketState,
	canAssign,
	dayKeyAt,
	likelyBucketOrder,
	monthKeyAt,
	monthOfDay,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { Delete, ReceiptText } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, monthName, shortDay } from "../format";
import { bucketUsesQuery, membersQuery, monthQuery, useMonthState } from "../queries";
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
				// Focus the sheet, not the note field, so the phone keyboard stays down.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.focus();
				}}
			>
				<SheetHeader title="Quick Add" />
				<Suspense fallback={<QuickAddPending />}>
					<QuickAddForm
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
	onAdd,
}: {
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
			month: monthKeyAt(now, timeZone),
			transactionId: ulid(),
		};
	});
	const queryClient = useQueryClient();
	const uses = useQuery(bucketUsesQuery()).data ?? [];
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
	// The Buckets of the month it's dated in: a Receipt's, unless that month has no Plan to add it
	// to (the server refuses a Bucket that isn't in it), and then today's, and the Parent is told.
	const receiptMonth = receipt ? monthOfDay(receipt.date) : entry.month;
	const inReceiptMonth = useMonthState(receiptMonth).buckets.filter((b) => canAssign(b, parentId));
	const inThisMonth = useMonthState(entry.month).buckets.filter((b) => canAssign(b, parentId));
	const datedToday = receipt !== null && inReceiptMonth.length === 0;
	const buckets = likelyBucketOrder(datedToday ? inThisMonth : inReceiptMonth, uses, entry.today);
	const offered = suggested
		? [
				...buckets.filter((bucket) => bucket.id === suggested),
				...buckets.filter((bucket) => bucket.id !== suggested),
			]
		: buckets;

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
			}
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
					<Link to="/transactions/$month" params={{ month: monthOfDay(transaction.date) }}>
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

	const [whole = "", fraction] = amount.split(".");
	return (
		<>
			<div className="grid justify-items-center gap-1.5 pt-2">
				<output
					ref={display}
					aria-label="Amount"
					className={cn(
						"inline-flex items-start text-[3.25rem] leading-none font-semibold tracking-[-0.045em] tabular-nums",
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
					{cents === 0
						? "Type an amount"
						: filled
							? "Check it, then tap a Bucket to add it"
							: "Tap a Bucket to add it"}
				</p>
			</div>
			<SnapAndSpeak onPhrase={fill} onSnap={snapped} />
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
			<div className="grid gap-2">
				<p className="text-xs font-medium text-muted-foreground" id="quick-add-buckets">
					Add to
				</p>
				<ul aria-labelledby="quick-add-buckets" className="grid grid-cols-2 gap-2">
					{offered.map((bucket) => (
						// The suggested one takes the whole row, so "Suggested" fits on a phone.
						<li key={bucket.id} className={cn("grid", bucket.id === suggested && "col-span-2")}>
							<BucketPick
								bucket={bucket}
								ready={cents > 0}
								suggested={bucket.id === suggested}
								onPick={() => add(bucket)}
							/>
						</li>
					))}
				</ul>
			</div>
			<ForPicker members={members} value={forMemberIds} onChange={setForMemberIds} />
			<Input
				aria-label="Note"
				placeholder="Add a note (optional)"
				maxLength={80}
				autoComplete="off"
				enterKeyHint="done"
				value={note}
				onChange={(event) => setNote(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
			/>
			{/* Phones: the keypad stays at the bottom, in thumb reach, while the Buckets scroll. */}
			<SheetFooter className="lg:hidden">
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

/** A Bucket to add the amount to, with what it has left. Colour says which Bucket, nothing more. */
function BucketPick({
	bucket,
	ready,
	suggested,
	onPick,
}: {
	bucket: BucketState;
	ready: boolean;
	/** What a snapped Receipt or a phrase said it's for: offered first, and marked. */
	suggested: boolean;
	onPick: () => void;
}) {
	const color = asBucketColor(bucket.color);
	return (
		<button
			type="button"
			aria-disabled={!ready}
			onClick={onPick}
			style={{ "--tile": `var(--bucket-${color})` } as CSSProperties}
			className={cn(
				"grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2.5 rounded-xl border bg-card px-2.5 py-2 text-start",
				"transition-[border-color,background-color,opacity,transform] duration-(--duration-fast) ease-standard",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				ready
					? "hover:border-[color-mix(in_oklab,var(--tile)_45%,var(--border))] hover:bg-[color-mix(in_oklab,var(--tile)_5%,var(--card))] active:scale-[0.98]"
					: "opacity-45",
				suggested && "border-border-strong",
			)}
		>
			<Tile bucket={color} aria-hidden="true" className="row-span-2 size-8 rounded-[10px]">
				{monogram(bucket.name)}
			</Tile>
			<span className="truncate text-[13px] font-medium">{bucket.name}</span>
			<span className="truncate text-xs text-subtle-foreground tabular-nums">
				{formatMoney(Math.max(0, bucket.left))} left
				{suggested ? <span className="text-muted-foreground"> · Suggested</span> : null}
			</span>
		</button>
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
		<button
			type="button"
			aria-label={label}
			onClick={onPress}
			className={cn(
				"grid h-13 place-items-center rounded-xl text-2xl font-medium tabular-nums select-none",
				"transition-[background-color,transform] duration-(--duration-fast) ease-standard",
				"hover:bg-surface-2 active:scale-[0.96] active:bg-surface-3",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
			)}
		>
			{children}
		</button>
	);
}

function QuickAddPending() {
	return (
		<div role="status" aria-label="Loading" className="grid gap-4">
			<Skeleton className="h-13 w-32 justify-self-center" />
			<div className="grid grid-cols-2 gap-2">
				{[0, 1, 2, 3].map((pick) => (
					<Skeleton key={pick} className="h-13 rounded-xl" />
				))}
			</div>
		</div>
	);
}
