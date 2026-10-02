import {
	type Assignment,
	canAssign,
	type MonthKey,
	monthKeyAt,
	type Plan,
	type PlanBucket,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Combobox } from "@noodle/ui/components/combobox";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Kbd } from "@noodle/ui/components/kbd";
import type { Choices } from "@noodle/ui/components/select";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated, useNavigate } from "@tanstack/react-router";
import { Check, CheckCheck, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../../../buckets";
import { ReviewMatchOffer } from "../../../components/match-section";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { TransactionEditor } from "../../../components/transaction-editor";
import { dayName, formatMoney, monthName } from "../../../format";
import { forLabel, type MemberSummary } from "../../../members";
import { membersQuery, monthQuery, reviewQuery } from "../../../queries";
import {
	type ReviewDecision,
	type ReviewItem,
	useConfirmAll,
	useLookAgain,
	useReviewDecision,
	useSaveRule,
} from "../../../review";
import { monthOfTransaction, type TransactionChange } from "../../../transactions";

export const Route = createFileRoute("/_authed/_household/review/")({
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	// Every card's month too: a card offers its own month's Buckets.
	loader: async ({ context }) => {
		const [queue] = await Promise.all([
			context.queryClient.ensureQueryData(reviewQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
		]);
		const months = new Set<MonthKey>([context.current]);
		for (const item of queue.items) months.add(monthOfTransaction(item));
		await Promise.all(
			[...months].map((month) => context.queryClient.ensureQueryData(monthQuery(month))),
		);
	},
	pendingComponent: SectionPending,
	component: ReviewPage,
});

/** Newest first: the newest month's cards, newest day first. */
const newestFirst = (a: ReviewItem, b: ReviewItem) =>
	b.date.localeCompare(a.date) || b.id.localeCompare(a.id);

/** The cards by month, newest month first. */
function byMonth(items: ReviewItem[]) {
	const months = new Map<MonthKey, ReviewItem[]>();
	for (const item of [...items].sort(newestFirst)) {
		const month = monthOfTransaction(item);
		months.set(month, [...(months.get(month) ?? []), item]);
	}
	return [...months];
}

/** Confirming a card: filed in its suggestion, as it is otherwise. */
function confirmed(item: ReviewItem): ReviewDecision | null {
	if (!item.guess) return null;
	return {
		item,
		next: {
			amountCents: item.amountCents,
			note: item.note,
			assignment: { bucketId: item.guess.bucketId },
			forMemberIds: item.for,
		},
		placeName: item.guess.name,
	};
}

/** What a card's month offers: the Buckets this Parent can file in, and its Commitments. */
function placesIn(plan: Plan, parentId: string) {
	const buckets = plan.buckets.filter((b) => canAssign(b, parentId));
	return { buckets, commitments: plan.commitments };
}

/**
 * Review: what categorization wasn't sure where to file, newest first by month. Each card shows
 * Noodle's suggestion and why; Confirm files it there, and picking another files it there instead.
 * Either then offers a Rule, so the merchant is filed on its own next time.
 */
function ReviewPage() {
	const { current, parentId } = Route.useRouteContext();
	const queue = useSuspenseQuery(reviewQuery()).data;
	const members = useSuspenseQuery(membersQuery()).data;
	const today = useSuspenseQuery(monthQuery(current)).data.asOf;
	const [cursor, setCursor] = useState<string | null>(null);
	const [changing, setChanging] = useState<ReviewItem | null>(null);
	const navigate = useNavigate();
	// From lg the Transaction opens at its own address, beside its month's list (#67); on a phone,
	// in a sheet here.
	const onEdit = (item: ReviewItem) => {
		if (window.matchMedia("(min-width: 1024px)").matches) {
			void navigate({
				to: "/transactions/$month/$transactionId",
				params: { month: monthOfTransaction(item), transactionId: item.id },
			});
		} else setChanging(item);
	};
	const decide = useReviewDecision();
	const confirmAll = useConfirmAll();
	const saveRule = useSaveRule();
	const lookAgain = useLookAgain();
	const hydrated = useHydrated();
	const queryClient = useQueryClient();
	const months = byMonth(queue.items);
	const cards = months.flatMap(([, items]) => items);
	const top = cards.find((item) => item.id === cursor) ?? cards[0] ?? null;
	const guessed = cards.filter((item) => item.guess);

	/** "Always file <merchant> in <Bucket>?", after a card is filed in a Bucket. */
	function offerRule(
		item: ReviewItem,
		bucket: Pick<PlanBucket, "id" | "name" | "owner">,
		forMemberIds: string[],
	) {
		const only = bucket.owner === parentId ? " Only you will see this Rule." : "";
		const forWhom = forMemberIds.length > 0 ? `, For ${forLabel(members, forMemberIds)}` : "";
		toast(`Always file “${item.merchant}” in ${bucket.name}${forWhom}?${only}`, {
			tone: "success",
			action: {
				label: "Always file",
				onClick: () =>
					saveRule.mutate({
						ruleId: ulid(),
						pattern: item.merchant,
						bucketId: bucket.id,
						bucketName: bucket.name,
						forMemberIds,
					}),
			},
		});
	}

	/** Moves the keyboard's card on from `item`, which is leaving. */
	function moveOn(item: ReviewItem) {
		const at = cards.findIndex((card) => card.id === item.id);
		const next = cards[at + 1] ?? cards[at - 1];
		setCursor(next?.id ?? null);
	}

	function confirm(item: ReviewItem) {
		const decision = confirmed(item);
		if (!decision || !item.guess) return openPicker(item);
		moveOn(item);
		decide.mutate(decision);
		const { bucketId, name } = item.guess;
		const plan = queryClient.getQueryData(monthQuery(monthOfTransaction(item)).queryKey)?.plan;
		const owner = plan?.buckets.find((b) => b.id === bucketId)?.owner;
		offerRule(item, { id: bucketId, name, owner }, item.for);
	}

	/** Files a card where the Parent picked: a Bucket or a Commitment. */
	function file(item: ReviewItem, value: string, plan: Plan) {
		const [kind, id] = value.split(":") as ["bucket" | "commitment", string];
		const assignment: Assignment = kind === "bucket" ? { bucketId: id } : { commitmentId: id };
		const bucket = kind === "bucket" ? plan.buckets.find((b) => b.id === id) : undefined;
		const name = bucket?.name ?? plan.commitments.find((c) => c.id === id)?.name ?? null;
		moveOn(item);
		decide.mutate({
			item,
			next: { amountCents: item.amountCents, note: item.note, assignment, forMemberIds: item.for },
			placeName: name ?? "its Commitment",
		});
		if (bucket) offerRule(item, bucket, item.for);
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
		moveOn(item);
		decide.mutate(decision);
		if (bucket && next && "assignment" in next) offerRule(item, bucket, next.forMemberIds);
	}

	function confirmEach(items: ReviewItem[]) {
		const decisions = items.flatMap((item) => confirmed(item) ?? []);
		if (decisions.length > 0) confirmAll.mutate(decisions);
	}

	function skip(item: ReviewItem) {
		const at = cards.findIndex((card) => card.id === item.id);
		setCursor((cards[at + 1] ?? cards[0])?.id ?? null);
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
			// A focused button or link answers keys itself: Enter on a card's button or the Rules
			// link mustn't also confirm the card, nor an arrow move it on.
			// The sidebar's links don't count: arriving from one, the keys work at once.
			if (target?.closest("main") && target.closest("button, a, summary, [role=button]")) return;
			const act =
				event.key === "ArrowRight" || event.key === "Enter"
					? confirm
					: event.key === "ArrowLeft"
						? openPicker
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
			<div className="grid max-w-xl gap-5">
				{top ? (
					<>
						<div className="grid gap-3">
							<p className="flex items-start gap-1 text-sm text-muted-foreground">
								<span>
									Noodle wasn’t sure where to file these. Confirm its suggestion or pick another.
								</span>
								<TermHelp term="review" className="mt-0.5" />
							</p>
							<div className="flex flex-wrap items-center gap-2 empty:hidden">
								{guessed.length > 1 ? (
									<Button
										variant="outline"
										size="sm"
										disabled={!hydrated || confirmAll.isPending}
										onClick={() => confirmEach(guessed)}
									>
										<CheckCheck />
										Confirm all {guessed.length} with a suggestion
									</Button>
								) : null}
								{queue.total > 0 ? (
									<Button
										variant="outline"
										size="sm"
										disabled={!hydrated || lookAgain.isPending}
										onClick={() => lookAgain.mutate()}
									>
										<RefreshCw />
										Look again
									</Button>
								) : null}
							</div>
						</div>
						{months.map(([month, items]) => (
							<section key={month} aria-labelledby={`review-month-${month}`} className="grid gap-3">
								<h2
									id={`review-month-${month}`}
									className="text-sm font-semibold text-muted-foreground"
								>
									{monthName(month)}
									{month.slice(0, 4) === current.slice(0, 4) ? "" : ` ${month.slice(0, 4)}`}
								</h2>
								{items.map((item) => {
									const same = guessed.filter((other) => other.merchant === item.merchant);
									return (
										<div key={item.id} className="grid gap-3">
											{item.id === top.id ? <ReviewMatchOffer transaction={item} /> : null}
											<ReviewCard
												item={item}
												today={today}
												members={members}
												parentId={parentId}
												current={item.id === top.id}
												hydrated={hydrated}
												sameMerchant={item.guess && same.length > 1 ? same : []}
												onFocus={() => setCursor(item.id)}
												onConfirm={() => confirm(item)}
												onPick={(value, plan) => file(item, value, plan)}
												onEdit={() => onEdit(item)}
												onConfirmAll={(items) => confirmEach(items)}
											/>
										</div>
									);
								})}
							</section>
						))}
						<p className="hidden text-center text-xs text-muted-foreground lg:block">
							<Key name="Right arrow">→</Key> or <Key>Enter</Key> to confirm,{" "}
							<Key name="Left arrow">←</Key> to change, <Key name="Down arrow">↓</Key> to skip
						</p>
					</>
				) : (
					<Card className="p-0">
						<EmptyState
							icon={<CheckCheck />}
							title="Nothing to review"
							description={`${
								queue.filedOnItsOwn > 0
									? `Noodle filed ${queue.filedOnItsOwn} on its own this month.`
									: "Noodle filed everything on its own."
							} Anything it isn’t sure about waits here for you.`}
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

/** Opens a card's picker, as ← does. */
function openPicker(item: ReviewItem) {
	const picker = document.getElementById(pickerId(item));
	picker?.focus();
	picker?.click();
}

const pickerId = (item: ReviewItem) => `review-pick-${item.id}`;

/** A key in the hint, with words for a screen reader where it's a symbol. */
function Key({ children, name }: { children: string; name?: string }) {
	return (
		<Kbd>
			{name ? (
				<>
					<span aria-hidden="true">{children}</span>
					<span className="sr-only">{name}</span>
				</>
			) : (
				children
			)}
		</Kbd>
	);
}

/** Why a suggestion, in plain words (ADR-0018). */
function suggestionWhy(guess: NonNullable<ReviewItem["guess"]>) {
	switch (guess.method) {
		case "rule":
			return guess.reason
				? `Your Rule: ${guess.reason} → ${guess.name}`
				: `Your Rule files this in ${guess.name}`;
		case "similar":
			return guess.reason
				? `Like ${guess.reason}, which you filed in ${guess.name}`
				: `Like something you filed in ${guess.name}`;
		case "model":
			return guess.reason ? `Suggested: ${guess.reason}` : "Suggested by Noodle";
		default:
			return "Noodle’s suggestion";
	}
}

/**
 * A card: what the Transaction was, Noodle's suggestion and why, and what to do with it. Confirm
 * files it in the suggestion; the picker files it wherever the Parent picks, from its own month's
 * Plan. A month with nothing to file in says so, with a way to set it up.
 */
function ReviewCard({
	item,
	today,
	members,
	parentId,
	current,
	hydrated,
	sameMerchant,
	onFocus,
	onConfirm,
	onPick,
	onEdit,
	onConfirmAll,
}: {
	item: ReviewItem;
	today: string;
	members: MemberSummary[];
	parentId: string;
	current: boolean;
	hydrated: boolean;
	sameMerchant: ReviewItem[];
	onFocus: () => void;
	onConfirm: () => void;
	onPick: (value: string, plan: Plan) => void;
	onEdit: () => void;
	onConfirmAll: (items: ReviewItem[]) => void;
}) {
	const month = monthOfTransaction(item);
	const plan = useQuery(monthQuery(month)).data?.plan;
	const places = plan ? placesIn(plan, parentId) : null;
	const bucket = plan?.buckets.find((b) => b.id === item.guess?.bucketId);
	const headingId = `review-${item.id}`;
	const empty = places !== null && places.buckets.length === 0 && places.commitments.length === 0;
	const choices: Choices = places
		? [
				{
					label: "Buckets",
					choices: places.buckets.map((b) => ({ value: `bucket:${b.id}`, label: b.name })),
				},
				...(places.commitments.length > 0
					? [
							{
								label: "Commitments",
								choices: places.commitments.map((c) => ({
									value: `commitment:${c.id}`,
									label: c.name,
								})),
							},
						]
					: []),
			]
		: [];
	const name = monthName(month);
	return (
		<article
			aria-labelledby={headingId}
			data-testid="review-card"
			data-current={current || undefined}
			onFocusCapture={onFocus}
			className={cn(
				"grid gap-4 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border sm:p-5",
				current && "ring-2 ring-ring",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="grid min-w-0 gap-0.5">
					<p className="text-xs text-muted-foreground">
						{dayName(item.date, today)}
						{item.importedFrom ? ` · ${item.importedFrom}` : ""}
					</p>
					<h3 id={headingId} className="truncate text-base font-semibold">
						{item.note ?? item.merchant}
					</h3>
					{item.for.length > 0 ? (
						<p className="text-sm text-muted-foreground">For {forLabel(members, item.for)}</p>
					) : null}
				</div>
				<div className="grid shrink-0 justify-items-end gap-1">
					<p className="text-xl font-semibold tracking-tight tabular-nums">
						{formatMoney(item.amountCents)}
					</p>
					<Badge>{item.guess ? "We weren’t sure" : "New merchant"}</Badge>
				</div>
			</div>
			<div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
				{item.guess ? (
					<>
						<Tile aria-hidden="true" bucket={bucket ? asBucketColor(bucket.color) : undefined}>
							{monogram(item.guess.name)}
						</Tile>
						<div className="grid min-w-0 flex-1">
							<span className="truncate text-sm font-medium">{item.guess.name}</span>
							<span className="text-xs text-muted-foreground">{suggestionWhy(item.guess)}</span>
						</div>
						{item.guess.confidence !== null ? (
							<span className="text-xs text-muted-foreground tabular-nums">
								{Math.round(item.guess.confidence * 100)}% sure
							</span>
						) : null}
					</>
				) : (
					<>
						<Tile aria-hidden="true">
							<Sparkles />
						</Tile>
						<p className="text-sm font-medium">
							{empty ? "No suggestion" : "No suggestion — pick where it goes"}
						</p>
					</>
				)}
			</div>
			{empty ? (
				<div className="grid gap-2 text-sm sm:flex sm:items-center sm:justify-between">
					<p>
						{plan?.baseline === null
							? `${name} has no Plan yet, so there’s nowhere to file this.`
							: `${name}’s Plan has no Buckets yet, so there’s nowhere to file this.`}
					</p>
					<Button variant="outline" size="sm" asChild>
						<Link to="/plan/$month/buckets" params={{ month }}>
							Set up {name}’s Plan
						</Link>
					</Button>
				</div>
			) : (
				<div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:items-center">
					<Combobox
						id={pickerId(item)}
						className="col-span-2 sm:flex-1"
						aria-label={`Where ${item.note ?? item.merchant} goes`}
						disabled={!hydrated || !places}
						placeholder={item.guess ? "Pick another…" : "Pick where it goes"}
						searchPlaceholder="Find a Bucket"
						choices={choices}
						onValueChange={(value) => plan && onPick(value, plan)}
					/>
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Edit ${item.note ?? item.merchant}`}
						disabled={!hydrated}
						onClick={onEdit}
					>
						<Pencil />
					</Button>
					{item.guess ? (
						<Button disabled={!hydrated} onClick={onConfirm}>
							<Check />
							Confirm
						</Button>
					) : null}
				</div>
			)}
			{sameMerchant.length > 1 ? (
				<Button
					variant="link"
					className="justify-self-start px-0"
					disabled={!hydrated}
					onClick={() => onConfirmAll(sameMerchant)}
				>
					Confirm all {sameMerchant.length} from “{item.merchant}”
				</Button>
			) : null}
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
