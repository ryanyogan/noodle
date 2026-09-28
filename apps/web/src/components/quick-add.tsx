import {
	type BucketState,
	dayKeyAt,
	likelyBucketOrder,
	monthKeyAt,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { Delete } from "lucide-react";
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
import { formatMoney } from "../format";
import { bucketUsesQuery, useMonthState } from "../queries";
import { type QuickAddVariables, useQuickAdd } from "../quick-add";

/** The search param that opens Quick Add over whatever screen is showing. */
export const quickAddSearch = { sheet: "quick-add" } as const;

/**
 * True while Quick Add is open on a history entry the app pushed, so closing it goes Back to
 * the page underneath. Arriving on a URL that already opens it (or reloading) leaves it false,
 * and closing then removes the param in place.
 */
let openedInApp = false;

/** Call when pushing the entry that opens Quick Add. */
export function markQuickAddOpened() {
	openedInApp = true;
}

/**
 * Quick Add, over any screen in the app frame: open while the URL says `?sheet=quick-add`, so
 * the iPhone back gesture closes it and the screen underneath stays mounted. Also opens with Q.
 */
export function QuickAdd({ timeZone }: { timeZone: string }) {
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
			void navigate({ to: ".", search: ({ sheet: _, ...rest }) => rest, replace: true });
		}
	}, [navigate, router]);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (open || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key !== "q" && event.key !== "Q") return;
			if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable]"))
				return;
			event.preventDefault();
			markQuickAddOpened();
			void navigate({ to: ".", search: (prev) => ({ ...prev, ...quickAddSearch }) });
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
	onAdd,
}: {
	timeZone: string;
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
	const state = useMonthState(entry.month);
	const uses = useQuery(bucketUsesQuery()).data ?? [];
	const buckets = likelyBucketOrder(state.buckets, uses, entry.today);
	const [amount, setAmount] = useState("");
	// Read by key presses, which can arrive faster than re-renders.
	const typedSoFar = useRef("");
	const [note, setNote] = useState("");
	const display = useRef<HTMLOutputElement>(null);
	const added = useRef(false);
	const cents = parseDollars(amount) ?? 0;

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
		onAdd({
			transactionId: entry.transactionId,
			bucketId: bucket.id,
			bucketName: bucket.name,
			amountCents: cents,
			note: note.trim(),
			date: entry.today,
		});
	}

	if (buckets.length === 0) {
		return (
			<div className="grid justify-items-center gap-3 py-6 text-center">
				<p className="text-sm text-muted-foreground">
					Quick Add files spending into a Bucket. Add one to your Plan first.
				</p>
				<Button variant="outline" asChild>
					<Link to="/month/$month/plan" params={{ month: entry.month }}>
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
					{cents > 0 ? "Tap a Bucket to add it" : "Type an amount"}
				</p>
			</div>
			<div className="grid gap-2">
				<p className="text-xs font-medium text-muted-foreground" id="quick-add-buckets">
					Add to
				</p>
				<ul aria-labelledby="quick-add-buckets" className="grid grid-cols-2 gap-2">
					{buckets.map((bucket) => (
						<li key={bucket.id} className="grid">
							<BucketPick bucket={bucket} ready={cents > 0} onPick={() => add(bucket)} />
						</li>
					))}
				</ul>
			</div>
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
			<fieldset className="grid grid-cols-3 gap-0.5 lg:hidden">
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
		</>
	);
}

/** A Bucket to add the amount to, with what it has left. Colour says which Bucket, nothing more. */
function BucketPick({
	bucket,
	ready,
	onPick,
}: {
	bucket: BucketState;
	ready: boolean;
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
			)}
		>
			<Tile bucket={color} aria-hidden="true" className="row-span-2 size-8 rounded-[10px]">
				{monogram(bucket.name)}
			</Tile>
			<span className="truncate text-[13px] font-medium">{bucket.name}</span>
			<span className="text-xs text-subtle-foreground tabular-nums">
				{formatMoney(Math.max(0, bucket.left))} left
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
