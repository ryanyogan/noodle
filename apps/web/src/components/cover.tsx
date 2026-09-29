import type { PlanMove } from "@noodle/db";
import {
	type BucketState,
	type CoverSource,
	coverSources,
	type MonthState,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { Link, useHydrated } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { type CSSProperties, useId, useState } from "react";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, formatMoneyInput } from "../format";

/** What a Cover's source is called: a Bucket's name, or Free to Spend. */
export const sourceName = (bucket: Pick<BucketState, "name"> | null | undefined) =>
	bucket ? bucket.name : "Free to Spend";

/**
 * Overspent Buckets, said calmly, each with a way to Cover it: overspending happens, and moving
 * money from somewhere with some left is the fix.
 */
export function ALittleOver({
	buckets,
	onCover,
}: {
	buckets: BucketState[];
	onCover: (bucket: BucketState) => void;
}) {
	const hydrated = useHydrated();
	return (
		<Section aria-labelledby="a-little-over">
			<SectionHeader id="a-little-over" title="A little over" count={buckets.length} />
			<List>
				{buckets.map((bucket) => (
					<ListRow
						key={bucket.id}
						leading={<Tile bucket={asBucketColor(bucket.color)}>{monogram(bucket.name)}</Tile>}
						title={bucket.name}
						meta={`${formatMoney(-bucket.left)} over its ${formatMoney(bucket.available)}`}
						trailing={
							<Button
								variant="outline"
								size="sm"
								type="button"
								disabled={!hydrated}
								aria-label={`Cover ${bucket.name}`}
								onClick={() => onCover(bucket)}
							>
								Cover
							</Button>
						}
					/>
				))}
			</List>
		</Section>
	);
}

/**
 * Covers an overspent Bucket: the amount it's over, unless the Parent changes it, from one of
 * the places with money left. Places with less than the amount can't be picked.
 */
export function CoverSheet({
	state,
	bucket,
	onOpenChange,
	onCover,
}: {
	state: MonthState;
	/** The Bucket to Cover; the sheet is closed while null. */
	bucket: BucketState | null;
	onOpenChange: (open: boolean) => void;
	onCover: (source: CoverSource, amountCents: number) => void;
}) {
	return (
		<Sheet open={bucket !== null} onOpenChange={onOpenChange}>
			{bucket ? (
				<SheetContent>
					<SheetHeader
						title={`Cover ${bucket.name}`}
						description={`${bucket.name} is ${formatMoney(-bucket.left)} over. Move money from somewhere with some left to bring it back to zero.`}
					/>
					{/* Keyed so reopening for another Bucket starts from its own amount. */}
					<CoverForm key={bucket.id} state={state} bucket={bucket} onCover={onCover} />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function CoverForm({
	state,
	bucket,
	onCover,
}: {
	state: MonthState;
	bucket: BucketState;
	onCover: (source: CoverSource, amountCents: number) => void;
}) {
	const amountId = useId();
	const overBy = Math.max(0, -bucket.left);
	const [amount, setAmount] = useState(() => formatMoneyInput(overBy));
	const cents = parseDollars(amount);
	const valid = cents !== null && cents > 0 && cents <= overBy;
	const sources = coverSources(state, bucket.id);
	return (
		<>
			<div className="grid gap-2">
				<label htmlFor={amountId} className="text-sm font-medium">
					Amount
				</label>
				<div className="relative">
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground text-sm"
					>
						$
					</span>
					<Input
						id={amountId}
						inputMode="decimal"
						autoComplete="off"
						enterKeyHint="done"
						className="pl-6 tabular-nums"
						value={amount}
						aria-invalid={!valid || undefined}
						aria-describedby={`${amountId}-hint`}
						onChange={(event) => setAmount(event.currentTarget.value)}
					/>
				</div>
				<p id={`${amountId}-hint`} className="text-xs text-subtle-foreground">
					{valid
						? cents === overBy
							? `Brings ${bucket.name} back to zero`
							: `Leaves ${bucket.name} ${formatMoney(overBy - cents)} over`
						: `Up to ${formatMoney(overBy)}, what ${bucket.name} is over`}
				</p>
			</div>
			{sources.length > 0 ? (
				<div className="grid gap-2">
					<p className="text-xs font-medium text-muted-foreground" id={`${amountId}-from`}>
						Cover from
					</p>
					<ul aria-labelledby={`${amountId}-from`} className="grid gap-2">
						{sources.map((source) => (
							<li key={source.bucket?.id ?? "free-to-spend"} className="grid">
								<SourcePick
									source={source}
									ready={valid && source.left >= (cents ?? 0)}
									onPick={() => {
										if (valid && cents !== null && source.left >= cents) onCover(source, cents);
									}}
								/>
							</li>
						))}
					</ul>
				</div>
			) : (
				<div className="grid justify-items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm text-muted-foreground">
					Nothing else has money left this month. Raising {bucket.name}’s allowance in the Plan
					would bring it back to zero.
					<Button variant="outline" size="sm" asChild>
						<Link to="/plan/$month/buckets" params={{ month: state.month }}>
							Edit Plan
						</Link>
					</Button>
				</div>
			)}
		</>
	);
}

/** A place to Cover from, with what it has left. Colour says which Bucket, nothing more. */
function SourcePick({
	source,
	ready,
	onPick,
}: {
	source: CoverSource;
	ready: boolean;
	onPick: () => void;
}) {
	const { bucket } = source;
	const color = bucket ? asBucketColor(bucket.color) : undefined;
	return (
		<button
			type="button"
			aria-disabled={!ready}
			onClick={onPick}
			style={color ? ({ "--tile": `var(--bucket-${color})` } as CSSProperties) : undefined}
			className={cn(
				"grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-xl border bg-card px-2.5 py-2 text-start",
				"transition-[border-color,background-color,opacity,transform] duration-(--duration-fast) ease-standard",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				ready
					? "hover:border-border-strong hover:bg-surface-2 active:scale-[0.98]"
					: "cursor-not-allowed opacity-45",
			)}
		>
			<Tile bucket={color} aria-hidden="true" className="size-8 rounded-[10px]">
				{bucket ? monogram(bucket.name) : <Wallet />}
			</Tile>
			<span className="truncate text-sm font-medium">{sourceName(bucket)}</span>
			<span className="text-[13px] text-muted-foreground tabular-nums">
				{formatMoney(source.left)} left
			</span>
		</button>
	);
}

/** This month's Covers into a Bucket, each of which can be undone. */
export function CoversInto({
	moves,
	buckets,
	onUndo,
}: {
	moves: PlanMove[];
	buckets: BucketState[];
	/** Absent when the Covers can no longer be undone. */
	onUndo?: (move: PlanMove, fromName: string) => void;
}) {
	const hydrated = useHydrated();
	return (
		<ul className="grid gap-1">
			{moves.map((move) => {
				const from =
					move.fromBucketId === null
						? sourceName(null)
						: (buckets.find((b) => b.id === move.fromBucketId)?.name ?? "another Bucket");
				return (
					<li
						key={move.id}
						className="flex min-h-7.5 items-center justify-between gap-2 text-[13px] text-muted-foreground"
					>
						<span>
							Covered {formatMoney(move.amount)} from {from}
						</span>
						{onUndo ? (
							<Button
								variant="ghost"
								size="sm"
								type="button"
								className="-me-2.5"
								disabled={!hydrated}
								aria-label={`Undo Cover from ${from}`}
								onClick={() => onUndo(move, from)}
							>
								Undo
							</Button>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}
