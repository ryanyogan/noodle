import { canAssign, type MonthKey, monthKeyAt, type PlanBucket } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check, CheckCheck, Lock, Pencil, SkipForward, Sparkles, WandSparkles } from "lucide-react";
import { type PointerEvent, Suspense, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../../../buckets";
import { ReviewMatchOffer } from "../../../components/match-section";
import { TransactionEditor } from "../../../components/transaction-editor";
import { dayName, formatMoney } from "../../../format";
import { forLabel, type MemberSummary } from "../../../members";
import { useReducedMotion } from "../../../motion";
import { membersQuery, monthQuery, reviewQuery } from "../../../queries";
import {
	type ReviewDecision,
	type ReviewItem,
	useReviewDecision,
	useSaveRule,
} from "../../../review";
import { monthOfTransaction, type TransactionChange } from "../../../transactions";

export const Route = createFileRoute("/_authed/_household/review/")({
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	// The first cards' months too: a card shows its guess's Bucket, and changing it edits it
	// against its own month's Plan.
	loader: async ({ context }) => {
		const [queue] = await Promise.all([
			context.queryClient.ensureQueryData(reviewQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
		]);
		const months = new Set<MonthKey>([context.current]);
		for (const item of queue.items.slice(0, 3)) months.add(monthOfTransaction(item));
		await Promise.all(
			[...months].map((month) => context.queryClient.ensureQueryData(monthQuery(month))),
		);
	},
	component: ReviewPage,
});

/** How far a card is dragged before letting go decides it. */
const SWIPE_DISTANCE = 96;

/** A Rule a Parent may state after deciding a card: this merchant always in this Bucket. */
type RuleOffer = {
	merchant: string;
	bucket: Pick<PlanBucket, "id" | "name">;
	forMemberIds: string[];
	/** Into the Parent's own Personal Allowance: a Rule only they see. */
	private: boolean;
};

/** The stack in order: as the server sent it, with skipped cards moved to the back. */
function inOrder(items: ReviewItem[], skipped: string[]) {
	const later = new Set(skipped);
	return [
		...items.filter((item) => !later.has(item.id)),
		...skipped.flatMap((id) => items.filter((item) => item.id === id)),
	];
}

/**
 * Review: imported Transactions categorization wasn't sure of, one card at a time. Confirming
 * files a card in its guess; changing opens the Transaction editor. Either offers a Rule, so the
 * merchant is filed on its own next time.
 */
function ReviewPage() {
	const { current, parentId } = Route.useRouteContext();
	const queue = useSuspenseQuery(reviewQuery()).data;
	const members = useSuspenseQuery(membersQuery()).data;
	const today = useSuspenseQuery(monthQuery(current)).data.asOf;
	const [skipped, setSkipped] = useState<string[]>([]);
	const [changing, setChanging] = useState<ReviewItem | null>(null);
	const [offer, setOffer] = useState<RuleOffer | null>(null);
	const decide = useReviewDecision();
	const saveRule = useSaveRule();
	const reduced = useReducedMotion();
	const hydrated = useHydrated();
	const cards = inOrder(queue.items, skipped);
	const top = cards[0] ?? null;
	// The top card's own month, for its guess's colour.
	const topPlan = useQuery({
		...monthQuery(top ? monthOfTransaction(top) : current),
		enabled: top !== null,
	}).data?.plan;

	function confirm(item: ReviewItem) {
		if (!item.guess) return setChanging(item);
		const bucket = { id: item.guess.bucketId, name: item.guess.name };
		decide.mutate({
			item,
			next: {
				amountCents: item.amountCents,
				note: item.note,
				assignment: { bucketId: bucket.id },
				forMemberIds: item.for,
			},
			placeName: bucket.name,
		});
		// A guess is never a Personal Allowance.
		setOffer({ merchant: item.merchant, bucket, forMemberIds: item.for, private: false });
	}

	function skip(item: ReviewItem) {
		setSkipped((ids) => [...ids.filter((id) => id !== item.id), item.id]);
	}

	function changed(item: ReviewItem, next: TransactionChange["next"], buckets: PlanBucket[]) {
		setChanging(null);
		const decision: ReviewDecision = { item, next, placeName: null };
		const assigned = next && "assignment" in next ? next.assignment : null;
		const bucket =
			assigned && "bucketId" in assigned
				? buckets.find((b) => b.id === assigned.bucketId)
				: undefined;
		if (next && "assignment" in next) {
			decision.placeName = bucket?.name ?? "its Commitment";
		}
		decide.mutate(decision);
		setOffer(
			bucket && next && "assignment" in next
				? {
						merchant: item.merchant,
						bucket,
						forMemberIds: next.forMemberIds,
						private: bucket.owner === parentId,
					}
				: null,
		);
	}

	// → or Enter confirms, ← changes, ↓ skips; not while typing or while the editor is open.
	useEffect(() => {
		if (!top || changing) return;
		function onKey(event: KeyboardEvent) {
			if (!top || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, select, textarea, [role=dialog], [contenteditable=true]")) {
				return;
			}
			// A focused button or link answers keys itself: Enter on Skip or the Rules link mustn't
			// also confirm the card, nor an arrow move it on.
			// The sidebar's links don't count: arriving from one, the keys work at once.
			if (target?.closest("main") && target.closest("button, a, summary, [role=button]")) return;
			const act =
				event.key === "ArrowRight" || event.key === "Enter"
					? confirm
					: event.key === "ArrowLeft"
						? setChanging
						: event.key === "ArrowDown"
							? skip
							: null;
			if (!act) return;
			event.preventDefault();
			act(top);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<>
			<PageHeader
				className="max-w-xl"
				eyebrow="Transactions"
				title={
					<span className="flex items-center gap-2">
						Review
						{queue.total > 0 ? (
							<Badge variant="count" aria-label={`${queue.total} to review`}>
								{queue.total}
							</Badge>
						) : null}
					</span>
				}
				actions={
					<Button variant="outline" size="sm" asChild>
						<Link to="/review/rules">
							<WandSparkles />
							Rules
						</Link>
					</Button>
				}
			/>
			<div className="grid max-w-xl gap-5">
				{offer ? (
					<RuleOfferCard
						offer={offer}
						members={members}
						onAccept={() => {
							saveRule.mutate({
								ruleId: ulid(),
								pattern: offer.merchant,
								bucketId: offer.bucket.id,
								bucketName: offer.bucket.name,
								forMemberIds: offer.forMemberIds,
							});
							setOffer(null);
						}}
						onDismiss={() => setOffer(null)}
					/>
				) : null}
				{top ? (
					<>
						<ReviewMatchOffer key={top.id} transaction={top} />
						<div className="relative">
							{/* The cards waiting behind this one, as edges. */}
							{cards.length > 2 ? (
								<div
									aria-hidden="true"
									className="absolute inset-x-6 -bottom-4 h-12 rounded-2xl bg-card/60 ring-1 ring-border"
								/>
							) : null}
							{cards.length > 1 ? (
								<div
									aria-hidden="true"
									className="absolute inset-x-3 -bottom-2 h-12 rounded-2xl bg-card ring-1 ring-border"
								/>
							) : null}
							<SwipeCard
								// A fresh card, undragged, for each Transaction on top.
								key={top.id}
								item={top}
								today={today}
								members={members}
								buckets={topPlan?.buckets ?? []}
								swipe={hydrated && !reduced}
								onConfirm={() => confirm(top)}
								onChange={() => setChanging(top)}
							/>
						</div>
						<div className="mt-2 grid grid-cols-3 gap-2">
							<Button variant="outline" onClick={() => setChanging(top)} disabled={!hydrated}>
								<Pencil />
								Change
							</Button>
							<Button variant="ghost" onClick={() => skip(top)} disabled={!hydrated}>
								<SkipForward />
								Skip
							</Button>
							<Button onClick={() => confirm(top)} disabled={!hydrated}>
								<Check />
								{top.guess ? "Confirm" : "Choose"}
							</Button>
						</div>
						<p className="text-center text-xs text-subtle-foreground">
							<span className="hidden lg:inline">
								<Key>→</Key> or <Key>Enter</Key> to confirm, <Key>←</Key> to change, <Key>↓</Key> to
								skip
							</span>
							{reduced ? null : (
								<span className="lg:hidden">Swipe right to confirm, left to change</span>
							)}
						</p>
					</>
				) : (
					<Card className="p-0">
						<EmptyState
							icon={<CheckCheck />}
							title="All caught up"
							description="Anything Noodle isn’t sure about waits here for you to confirm."
							action={
								<Button variant="outline" size="sm" asChild>
									<Link to="/transactions">See Transactions</Link>
								</Button>
							}
						/>
					</Card>
				)}
			</div>
			{changing ? (
				<Suspense fallback={null}>
					<ChangeSheet
						item={changing}
						today={today}
						members={members}
						parentId={parentId}
						onChange={(next, buckets) => changed(changing, next, buckets)}
						onClose={() => setChanging(null)}
					/>
				</Suspense>
			) : null}
		</>
	);
}

function Key({ children }: { children: string }) {
	return (
		<span aria-hidden="true">
			<kbd className="rounded-sm border border-current/40 px-1 font-sans leading-4">{children}</kbd>
		</span>
	);
}

/**
 * The card on top: what the Transaction was, and categorization's guess. It can be dragged:
 * far enough right confirms, left changes; short of that it springs back. Only buttons and keys
 * when the Parent asked for less motion.
 */
function SwipeCard({
	item,
	today,
	members,
	buckets,
	swipe,
	onConfirm,
	onChange,
}: {
	item: ReviewItem;
	today: string;
	members: MemberSummary[];
	buckets: PlanBucket[];
	swipe: boolean;
	onConfirm: () => void;
	onChange: () => void;
}) {
	const [dx, setDx] = useState(0);
	const [dragging, setDragging] = useState(false);
	const drag = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null);
	const guessed = buckets.find((b) => b.id === item.guess?.bucketId);
	const headingId = `review-${item.id}`;

	function onPointerDown(event: PointerEvent<HTMLElement>) {
		if (!swipe || event.button !== 0) return;
		drag.current = { x: event.clientX, y: event.clientY, sideways: null };
		event.currentTarget.setPointerCapture(event.pointerId);
	}
	function onPointerMove(event: PointerEvent<HTMLElement>) {
		const start = drag.current;
		if (!start) return;
		const x = event.clientX - start.x;
		const y = event.clientY - start.y;
		// Decided by the first few pixels: sideways drags the card, anything else is a scroll.
		if (start.sideways === null && Math.hypot(x, y) > 8) {
			start.sideways = Math.abs(x) > Math.abs(y);
			setDragging(start.sideways);
		}
		if (start.sideways) setDx(x);
	}
	function onPointerUp() {
		if (!drag.current) return;
		drag.current = null;
		setDragging(false);
		if (dx > SWIPE_DISTANCE && item.guess) {
			// Off to the right, then decided.
			setDx(window.innerWidth);
			setTimeout(onConfirm, 160);
			return;
		}
		setDx(0);
		if (dx > SWIPE_DISTANCE || dx < -SWIPE_DISTANCE) onChange();
	}
	function onPointerCancel() {
		drag.current = null;
		setDragging(false);
		setDx(0);
	}

	const toward = dx > 24 ? "confirm" : dx < -24 ? "change" : null;
	return (
		<article
			aria-labelledby={headingId}
			data-testid="review-card"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			style={dx === 0 ? undefined : { transform: `translateX(${dx}px) rotate(${dx / 30}deg)` }}
			className={cn(
				"relative grid gap-5 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border select-none",
				swipe && "touch-pan-y cursor-grab",
				dragging && "cursor-grabbing",
				!dragging && "transition-transform duration-(--duration-fast) ease-standard",
			)}
		>
			{toward ? (
				<span
					aria-hidden="true"
					className={cn(
						"absolute top-4 rounded-md px-2 py-0.5 text-xs font-semibold ring-1",
						toward === "confirm"
							? "start-4 bg-surface-2 text-foreground ring-border"
							: "end-4 bg-surface-2 text-muted-foreground ring-border",
					)}
				>
					{toward === "confirm" ? (item.guess ? "Confirm" : "Choose") : "Change"}
				</span>
			) : null}
			<div className="grid gap-1 text-center">
				<p className="text-xs text-muted-foreground">
					{dayName(item.date, today)}
					{item.importedFrom ? ` · ${item.importedFrom}` : ""}
				</p>
				<h2 id={headingId} className="truncate text-lg font-semibold">
					{item.note ?? item.merchant}
				</h2>
				<p className="text-4xl font-semibold tracking-tight tabular-nums">
					{formatMoney(item.amountCents)}
				</p>
				{item.for.length > 0 ? (
					<p className="text-sm text-muted-foreground">For {forLabel(members, item.for)}</p>
				) : null}
			</div>
			<div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
				{item.guess ? (
					<>
						<Tile aria-hidden="true" bucket={guessed ? asBucketColor(guessed.color) : undefined}>
							{monogram(item.guess.name)}
						</Tile>
						<div className="grid min-w-0 flex-1">
							<span className="text-xs text-muted-foreground">Noodle’s guess</span>
							<span className="truncate text-sm font-medium">{item.guess.name}</span>
						</div>
						{item.guess.confidence !== null ? (
							<span className="text-sm text-muted-foreground tabular-nums">
								{Math.round(item.guess.confidence * 100)}% sure
							</span>
						) : null}
					</>
				) : (
					<>
						<Tile aria-hidden="true">
							<Sparkles />
						</Tile>
						<div className="grid min-w-0 flex-1">
							<span className="text-xs text-muted-foreground">Noodle’s guess</span>
							<span className="text-sm font-medium">No guess</span>
						</div>
					</>
				)}
			</div>
		</article>
	);
}

/** The Transaction editor for a card, against its own month's Plan. */
function ChangeSheet({
	item,
	today,
	members,
	parentId,
	onChange,
	onClose,
}: {
	item: ReviewItem;
	today: string;
	members: MemberSummary[];
	parentId: string;
	onChange: (next: TransactionChange["next"], buckets: PlanBucket[]) => void;
	onClose: () => void;
}) {
	const data = useSuspenseQuery(monthQuery(monthOfTransaction(item))).data;
	// The other Parent's Personal Allowance isn't this Parent's to assign to.
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	return (
		<TransactionEditor
			// Starts on the guess, so changing it is one pick.
			transaction={{ ...item, bucketId: item.guess?.bucketId ?? null }}
			today={today}
			plan={plan}
			members={members}
			parentId={parentId}
			onChange={(next) => onChange(next, plan.buckets)}
			onClose={onClose}
		/>
	);
}

/** "Always file <merchant> in <Bucket>?", after a card is decided. */
function RuleOfferCard({
	offer,
	members,
	onAccept,
	onDismiss,
}: {
	offer: RuleOffer;
	members: MemberSummary[];
	onAccept: () => void;
	onDismiss: () => void;
}) {
	return (
		<section
			aria-label="Make a Rule"
			className="grid gap-3 rounded-xl bg-card p-4 shadow-card ring-1 ring-border sm:flex sm:items-center"
		>
			<div className="grid flex-1 gap-0.5">
				<p className="text-sm font-medium">
					Always file “{offer.merchant}” in {offer.bucket.name}
					{offer.forMemberIds.length > 0 ? `, For ${forLabel(members, offer.forMemberIds)}` : ""}?
				</p>
				<p className="flex items-center gap-1 text-xs text-muted-foreground">
					{offer.private ? (
						<>
							<Lock className="size-3" aria-hidden="true" />
							Only you will see this Rule.
						</>
					) : (
						"Its next statement lines, and any still waiting, go there on their own."
					)}
				</p>
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onDismiss}>
					Not now
				</Button>
				<Button variant="outline" size="sm" onClick={onAccept}>
					Always file
				</Button>
			</div>
		</section>
	);
}
