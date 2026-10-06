import type { PlanMove } from "@noodle/db";
import {
	type BucketState,
	type CoverSource,
	coverSources,
	type MonthKey,
	type MonthState,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { Link, useHydrated } from "@tanstack/react-router";
import { ChevronRight, Wallet } from "lucide-react";
import { useId, useState } from "react";
import type { BucketCover } from "../bucket-covers";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import { PLAN_BUCKETS_HASH } from "../plan-pages";

/** What a Cover's source is called: a Bucket's name, or Free to Spend. */
export const sourceName = (bucket: Pick<BucketState, "name"> | null | undefined) =>
	bucket ? bucket.name : "Free to Spend";

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
				<SheetContent layout="wide">
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
	// With an amount typed, the places that have that much left come first; the rest fold away.
	const enough = (source: CoverSource) => !valid || cents === null || source.left >= cents;
	const canCover = sources.filter(enough);
	const cannot = sources.filter((source) => !enough(source));
	const pick = (source: CoverSource) => {
		if (valid && cents !== null && source.left >= cents) onCover(source, cents);
	};
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
					<SourceList
						labelledBy={`${amountId}-from`}
						sources={canCover}
						ready={(source) => valid && source.left >= (cents ?? 0)}
						onPick={pick}
					/>
					{cannot.length > 0 ? (
						// Places without enough left can't be picked: folded away so the list is what can.
						<Collapsible className="group grid gap-2">
							<CollapsibleTrigger className="flex min-h-8 items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground hover:text-foreground">
								<ChevronRight
									aria-hidden="true"
									className="size-4 transition-transform group-data-[state=open]:rotate-90"
								/>
								{cannot.length} without {cents === null ? "enough" : formatMoney(cents)} left
							</CollapsibleTrigger>
							<CollapsibleContent>
								<SourceList
									labelledBy={`${amountId}-from`}
									sources={cannot}
									ready={() => false}
									onPick={pick}
								/>
							</CollapsibleContent>
						</Collapsible>
					) : null}
				</div>
			) : (
				<div className="grid justify-items-start gap-3 rounded-xl bg-surface-2 p-3 text-sm text-muted-foreground">
					Nothing else has money left this month. Raising {bucket.name}’s allowance in the Plan
					would bring it back to zero.
					<Button variant="outline" size="sm" asChild>
						<Link to="/plan/$month" params={{ month: state.month }} hash={PLAN_BUCKETS_HASH}>
							Edit Plan
						</Link>
					</Button>
				</div>
			)}
		</>
	);
}

/** Places to Cover from, each picked with one tap. */
function SourceList({
	labelledBy,
	sources,
	ready,
	onPick,
}: {
	labelledBy: string;
	sources: CoverSource[];
	ready: (source: CoverSource) => boolean;
	onPick: (source: CoverSource) => void;
}) {
	return (
		<ul aria-labelledby={labelledBy} className="grid gap-2 lg:grid-cols-2">
			{sources.map((source) => (
				<li key={source.bucket?.id ?? "free-to-spend"} className="grid">
					<SourcePick source={source} ready={ready(source)} onPick={() => onPick(source)} />
				</li>
			))}
		</ul>
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
		<RowButton
			variant="tile"
			aria-disabled={!ready}
			onClick={onPick}
			// From lg two tiles share a row: what's left goes under the name, which was cut
			// ("Free to Sp…") beside it (issue 73).
			className="grid-cols-[32px_minmax(0,1fr)_auto] aria-disabled:cursor-not-allowed lg:gap-y-0"
		>
			<Tile
				bucket={color}
				aria-hidden="true"
				className="size-8 rounded-[10px] lg:row-span-2 lg:self-center"
			>
				{bucket ? monogram(bucket.name) : <Wallet />}
			</Tile>
			<span className="truncate text-sm font-medium lg:col-span-2">{sourceName(bucket)}</span>
			<span className="text-[13px] text-muted-foreground tabular-nums lg:col-span-2 lg:col-start-2">
				{formatMoney(source.left)} left
			</span>
		</RowButton>
	);
}

/**
 * A month's Covers that involve a Bucket, on its own page (#87): money that came into it and
 * money that went out of it to cover another, each with its Undo. Nothing when there are none.
 */
export function BucketCovers({
	month,
	covers,
	buckets,
	canUndo,
	onUndo,
}: {
	month: MonthKey;
	covers: BucketCover[];
	/** The month's Buckets, for the names on both sides. */
	buckets: BucketState[];
	/** Whether this Parent may still undo it. */
	canUndo: (move: PlanMove) => boolean;
	onUndo: (move: PlanMove, names: { fromName: string; toName: string }) => void;
}) {
	const hydrated = useHydrated();
	if (covers.length === 0) return null;
	const nameOf = (id: string) => buckets.find((b) => b.id === id)?.name ?? "another Bucket";
	const heading = `Covers in ${monthName(month)}`;
	return (
		<Section aria-labelledby="bucket-covers">
			<SectionHeader id="bucket-covers" title={heading} />
			<List aria-label={heading}>
				{covers.map(({ move, direction }) => {
					const fromName =
						move.fromBucketId === null
							? move.windfall
								? "Extra income"
								: sourceName(null)
							: nameOf(move.fromBucketId);
					const toName = nameOf(move.toBucketId);
					return (
						<ListRow
							key={move.id}
							title={
								direction === "into"
									? `Covered ${formatMoney(move.amount)} from ${fromName}`
									: `${formatMoney(move.amount)} went to cover ${toName}`
							}
							trailing={
								canUndo(move) ? (
									<Button
										variant="ghost"
										size="sm"
										type="button"
										// A full-size tap area on a phone (#74).
										className="-me-2.5 max-lg:min-h-11"
										disabled={!hydrated}
										aria-label={
											direction === "into"
												? `Undo Cover from ${fromName}`
												: `Undo Cover of ${toName}`
										}
										onClick={() => onUndo(move, { fromName, toName })}
									>
										Undo
									</Button>
								) : undefined
							}
						/>
					);
				})}
			</List>
		</Section>
	);
}
