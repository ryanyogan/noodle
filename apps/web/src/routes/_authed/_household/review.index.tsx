import {
	type Assignment,
	canAssign,
	type DayKey,
	displayMerchant,
	type MonthKey,
	merchantKey,
	monthKeyAt,
	type PayingCommitment,
	type PaymentAccount,
	type PaymentCase,
	type Plan,
	type PlanBucket,
	paymentCase,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Kbd } from "@noodle/ui/components/kbd";
import { MasterDetail, SectionGrid } from "@noodle/ui/components/layout";
import type { ChoiceGroup } from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { useQueries, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated, useNavigate } from "@tanstack/react-router";
import {
	Archive,
	ArrowLeftRight,
	Check,
	CheckCheck,
	Layers,
	List,
	ListPlus,
	Pencil,
	RefreshCw,
	SkipForward,
	Sparkles,
	Split as SplitIcon,
	Undo2,
	Wallet,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	Suspense,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { ulid } from "ulid";
import { z } from "zod";
import { asBucketColor, monogram } from "../../../buckets";
import { BucketPicker, NewBucketStep } from "../../../components/bucket-picker";
import { DetailHeader, DetailPending } from "../../../components/master-detail";
import { ReviewMatchOffer } from "../../../components/match-section";
import { RuleForm } from "../../../components/rule-form";
import { SectionPending } from "../../../components/section-layout";
import { Suggested } from "../../../components/suggested";
import { SwipeCard } from "../../../components/swipe-card";
import { TermHelp } from "../../../components/term-help";
import { TransactionBody, TransactionEditor } from "../../../components/transaction-editor";
import { dayName, formatMoney, monthName } from "../../../format";
import { forLabel, type MemberSummary } from "../../../members";
import { useReducedMotion } from "../../../motion";
import {
	followedCardsQuery,
	goalsQuery,
	membersQuery,
	monthQuery,
	reviewQuery,
	suggestionsQuery,
} from "../../../queries";
import { merchantName } from "../../../reports";
import {
	type ReviewDecision,
	type ReviewItem,
	useConfirmAll,
	useFileWithoutBucket,
	useLookAgain,
	useReturnToReview,
	useReviewDecision,
	useSaveRule,
} from "../../../review";
import {
	canUndo as hasUndo,
	stackOrder,
	stackProgress,
	stackReducer,
	startStack,
} from "../../../review-stack";
import { ChangedElsewhere } from "../../../transaction-versions";
import { monthOfTransaction, type TransactionChange } from "../../../transactions";
import { useMoneyChange } from "../../../transfers";

export const Route = createFileRoute("/_authed/_household/review/")({
	// Sort (one card at a time) unless the list is asked for (#68).
	validateSearch: z.object({ view: z.enum(["list"]).optional().catch(undefined) }),
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	// Every card's month too: a card offers its own month's Buckets.
	loader: async ({ context }) => {
		const [queue] = await Promise.all([
			context.queryClient.ensureQueryData(reviewQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(suggestionsQuery()),
			// A payment to a card or loan is told from spending by the Household's cards and loans.
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(followedCardsQuery()),
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
 *
 * Two views over the same cards and the same decisions (#68): Sort, one card at a time on a stack
 * that can be swiped, with Skip and Undo; and the list, for scanning and batch work.
 */
function ReviewPage() {
	const { current, parentId } = Route.useRouteContext();
	const queue = useSuspenseQuery(reviewQuery()).data;
	const members = useSuspenseQuery(membersQuery()).data;
	const today = useSuspenseQuery(monthQuery(current)).data.asOf;
	const [cursor, setCursor] = useState<string | null>(null);
	const [changing, setChanging] = useState<ReviewItem | null>(null);
	/** A Bucket being made from a card's picker, to file that card in (#90). */
	const [creating, setCreating] = useState<{ item: ReviewItem; name: string; plan: Plan } | null>(
		null,
	);
	const [stack, dispatch] = useReducer(stackReducer<ReviewItem>, startStack<ReviewItem>());
	const sorting = Route.useSearch().view !== "list";
	const reduced = useReducedMotion();
	const navigate = useNavigate();
	// From lg the list's card opens beside the list, and Sort's at the Transaction's own address
	// beside its month's list (#67); on a phone, in a sheet here.
	const [editing, setEditing] = useState<ReviewItem | null>(null);
	const onEdit = (item: ReviewItem) => {
		if (window.matchMedia("(min-width: 1024px)").matches) {
			if (!sorting) return setEditing(item);
			void navigate({
				to: "/transactions/$month/$transactionId",
				params: { month: monthOfTransaction(item), transactionId: item.id },
			});
		} else setChanging(item);
	};
	// A toast's Undo goes through the stack's history too, so the two never disagree.
	const decide = useReviewDecision({ onUndo: putBack });
	const confirmAll = useConfirmAll({ onUndo: putBack });
	const fileWithout = useFileWithoutBucket({ onUndo: putBack });
	const returnCard = useReturnToReview();
	const saveRule = useSaveRule();
	const lookAgain = useLookAgain();
	const hydrated = useHydrated();
	const queryClient = useQueryClient();
	// Money out that reads as a payment to a card or loan has one tree (ADR-0050, paymentCase),
	// decided here each time Review is read: a Commitment that pays the card or loan down, a
	// Transfer for a card Noodle follows, or the spending itself for a card it doesn't. Never a
	// Bucket as its suggestion: a guess it was given before is dropped, so Confirm and "Confirm
	// all" can't file it by habit.
	const accounts = useQuery(goalsQuery()).data?.accounts;
	const followed = useQuery(followedCardsQuery()).data;
	const cardMonths = useMemo(
		() => [...new Set(queue.items.map((item) => monthOfTransaction(item)))],
		[queue.items],
	);
	/** When each of those months' Plans was last read: a Commitment's "Pays down" may have changed. */
	const plansRead = useQueries({ queries: cardMonths.map((month) => monthQuery(month)) })
		.map((plan) => plan.dataUpdatedAt)
		.join(" ");
	// biome-ignore lint/correctness/useExhaustiveDependencies: plansRead says a Plan was read again
	const { items, payments } = useMemo(() => {
		const follows = new Set(followed ?? []);
		const cardsAndLoans: PaymentAccount[] = (accounts ?? []).flatMap((account) =>
			account.kind === "credit-card" || account.kind === "loan"
				? [
						{
							id: account.id,
							name: account.name,
							kind: account.kind,
							followed:
								account.kind === "credit-card" &&
								(account.bankConnectionId !== null || follows.has(account.id)),
						},
					]
				: [],
		);
		const payments = new Map<string, PaymentCase>();
		const items = queue.items.map((item) => {
			const plan = queryClient.getQueryData(monthQuery(monthOfTransaction(item)).queryKey)?.plan;
			const paying: PayingCommitment[] = (plan?.commitments ?? []).flatMap((commitment) =>
				commitment.accountId
					? [
							{
								id: commitment.id,
								name: commitment.name,
								accountId: commitment.accountId,
								amountCents: commitment.amount,
								carriedBalance: commitment.carriedBalance ?? false,
							},
						]
					: [],
			);
			const payment = cardPaymentOf(item, cardsAndLoans, paying);
			if (!payment) return item;
			payments.set(item.id, payment);
			return item.guess ? { ...item, guess: null } : item;
		});
		return { items, payments };
	}, [queue.items, accounts, followed, plansRead, queryClient]);
	const paymentOf = (item: ReviewItem) => payments.get(item.id) ?? null;
	/** A Bucket picked for a payment to a card Noodle follows: asked about before it's filed. */
	const [caution, setCaution] = useState<{
		item: ReviewItem;
		value: string;
		plan: Plan;
		place: string;
	} | null>(null);
	const money = useMoneyChange();
	/** The Transfers marked from cards here, by Transaction: what their Undo unmarks. */
	const marked = useRef(new Map<string, string>());
	const months = byMonth(items);
	const cards = months.flatMap(([, items]) => items);
	const top = cards.find((item) => item.id === cursor) ?? cards[0] ?? null;
	const guessed = cards.filter((item) => item.guess);
	const order = stackOrder(cards, stack);
	/** From a month before this one: it can be filed without a Bucket (ADR-0037). */
	const earlier = (item: ReviewItem) => monthOfTransaction(item) < current;
	const fromEarlier = cards.filter(earlier);
	/** Where Sort is: every card waiting counts, not only the ones loaded. */
	const progress = stackProgress(stack, queue.total);
	/** The card the keys act on: the stack's top, or the list's outlined card. */
	const active = sorting ? (order[0] ?? null) : top;
	// Undo doesn't wait for a save: Review's writes are sent one at a time, in order (#84).
	const canUndo = hasUndo(stack);
	/** A write is still on its way (each waits for the one before, so the last covers the rest). */
	const saving =
		decide.isPending ||
		confirmAll.isPending ||
		fileWithout.isPending ||
		returnCard.isPending ||
		saveRule.isPending;
	/** A failed save: its cards are back in Review, and back on top of the stack. */
	const failed = (items: ReviewItem[]) => ({
		onError: (error: unknown) => {
			dispatch({ type: "failed", items });
			if (!sorting) return;
			// Said beside the card rather than in a toast over its buttons; it's on top to try again.
			run.current = 0;
			setStreak(null);
			focusNext.current = true;
			// Another screen changed it first (ADR-0041): nothing failed to save, and the one message
			// about it is already said, so what Sort said of the decision is only taken back.
			if (error instanceof ChangedElsewhere) return say("");
			const [first] = items;
			say(
				items.length === 1 && first
					? `Couldn’t file ${labelOf(first)}, so it’s back in Review, on top.`
					: `Couldn’t file all ${items.length}, so they’re back in Review, on top.`,
			);
		},
	});
	/** What Sort last did, said beside the card and to a screen reader. */
	const [said, say] = useState("");
	/**
	 * Cards of a batch that another screen changed first, so they were left as they are (ADR-0041):
	 * not done here and not this visit's to undo. The batch's own message says how many.
	 */
	function leftOut(items: ReviewItem[]) {
		if (items.length === 0) return;
		dispatch({ type: "returned", items });
		if (!sorting) return;
		run.current = 0;
		setStreak(null);
		say("");
	}
	/** Suggestions confirmed one after another in Sort, for a small "5 in a row!". */
	const run = useRef(0);
	const [streak, setStreak] = useState<number | null>(null);
	/** The cheer shows for a moment; a screen reader hears it once, with the decision. */
	const [cheering, setCheering] = useState(false);
	useEffect(() => {
		if (streak === null) return;
		setCheering(true);
		const timer = setTimeout(() => setCheering(false), 2500);
		return () => clearTimeout(timer);
	}, [streak]);
	/** "Always file …?", offered beside the card in Sort rather than in a toast over it. */
	const [offer, setOffer] = useState<RuleOffer | null>(null);
	const { data: ruleIdeas } = useQuery(suggestionsQuery());
	/** The card flying off the top, drawn over the next one for a moment. */
	const [leaving, setLeaving] = useState<{ item: ReviewItem; way: Way } | null>(null);
	const [wobbling, setWobbling] = useState(false);
	const [splitting, setSplitting] = useState(false);
	const [ruling, setRuling] = useState<ReviewItem | null>(null);
	/** After a decision in Sort, focus goes to the next card (or the finish). */
	const focusNext = useRef(false);
	const topId = sorting ? (order[0]?.id ?? null) : null;
	useEffect(() => {
		if (!focusNext.current) return;
		focusNext.current = false;
		const frame = requestAnimationFrame(() =>
			document.getElementById(topId ? "review-top" : "review-finish")?.focus(),
		);
		return () => cancelAnimationFrame(frame);
	}, [topId]);

	const planOf = (item: ReviewItem) =>
		queryClient.getQueryData(monthQuery(monthOfTransaction(item)).queryKey)?.plan;
	/** A card from a month with nothing to file in: filed without a Bucket, or skipped. */
	function stuck(item: ReviewItem) {
		const plan = planOf(item);
		if (!plan) return false;
		const places = placesIn(plan, parentId);
		return places.buckets.length === 0 && places.commitments.length === 0;
	}
	/** A card that can't go that way shakes its head (with motion) and says why. */
	function shake() {
		if (!reduced) setWobbling(true);
	}
	function nope(item: ReviewItem) {
		const name = monthName(monthOfTransaction(item));
		say(
			planOf(item)?.baseline === null
				? `${name} has no Plan yet. File ${labelOf(item)} without a Bucket, or skip it.`
				: `${name}’s Plan has no Buckets yet. File ${labelOf(item)} without a Bucket, or skip it.`,
		);
		shake();
	}

	/** Puts decided cards back in Review, the first on top: the stack's Undo and a toast's. */
	function putBack(items: ReviewItem[]) {
		for (const item of items) {
			// A card marked as a card payment was never filed: its Undo unmarks the Transfer.
			const transferId = marked.current.get(item.id);
			marked.current.delete(item.id);
			if (transferId) money.mutate({ kind: "unmark", transferId, label: labelOf(item) });
			else returnCard.mutate(item);
		}
		dispatch({ type: "returned", items });
		setOffer(null);
		run.current = 0;
		setStreak(null);
		setLeaving(null);
		const first = items[0];
		if (!first || !sorting) return;
		focusNext.current = true;
		say(`${labelOf(first)} is back on top.`);
	}

	function undo() {
		const last = stack.history.at(-1);
		if (!last || !canUndo) return;
		putBack(last);
	}

	/** Records a decision; in Sort the card flies off, focus moves on and it's said. */
	function decided(items: ReviewItem[], what: string, way: Way = "right", suggested = false) {
		dispatch({ type: "decided", items });
		setCaution(null);
		if (!sorting) return;
		const ids = new Set(items.map((item) => item.id));
		// Of everything waiting, not only the cards loaded.
		const left = Math.max(
			order.filter((item) => !ids.has(item.id)).length,
			queue.total - order.filter((item) => ids.has(item.id)).length,
		);
		setOffer(null);
		// 3 in a row, then every 5th.
		run.current = suggested ? run.current + 1 : 0;
		const inARow = run.current;
		setStreak(inARow === 3 || (inARow > 0 && inARow % 5 === 0) ? inARow : null);
		focusNext.current = true;
		say(`${what} ${left > 0 ? `${left} left.` : "All sorted."}`);
		const first = items[0];
		if (!reduced && first && items.length === 1 && first.id === order[0]?.id) {
			setLeaving({ item: first, way });
		}
		// A small buzz at the end of the stack, on a phone that can.
		if (left === 0 && !reduced && window.matchMedia("(pointer: coarse)").matches) {
			navigator.vibrate?.(30);
		}
	}

	/** "Always file <merchant> in <Bucket>?", after a card is filed in a Bucket or a Commitment. */
	function offerRule(item: ReviewItem, bucket: RuleTarget, forMemberIds: string[]) {
		// One offer, not two: once background AI suggests this very Rule (ADR-0027), its card below
		// the stack is the offer, and stays until it's added or put away.
		const key = merchantKey(item.merchant ?? "");
		const suggested = (ruleIdeas ?? []).some(
			(idea) =>
				idea.kind === "rule" &&
				idea.payload.merchant === key &&
				idea.payload.bucketId === bucket.id,
		);
		if (suggested) return;
		if (sorting) return setOffer({ item, bucket, forMemberIds });
		toast(ruleQuestion({ item, bucket, forMemberIds }), {
			tone: "success",
			action: { label: "Always file", onClick: () => takeRule({ item, bucket, forMemberIds }) },
		});
	}

	function ruleQuestion({ item, bucket, forMemberIds }: RuleOffer) {
		const only = bucket.owner === parentId ? " Only you will see this Rule." : "";
		const forWhom = forMemberIds.length > 0 ? `, For ${forLabel(members, forMemberIds)}` : "";
		return `Always file “${merchantName(item.merchant)}” in ${bucket.name}${forWhom}?${only}`;
	}

	function takeRule({ item, bucket, forMemberIds }: RuleOffer) {
		setOffer(null);
		saveRule.mutate({
			ruleId: ulid(),
			pattern: item.merchant,
			// A Commitment Rule files there instead of a Bucket (ADR-0030).
			bucketId: bucket.commitment ? null : bucket.id,
			commitmentId: bucket.commitment ? bucket.id : null,
			bucketName: bucket.name,
			forMemberIds,
		});
	}

	/** Moves the keyboard's card on from `item`, which is leaving. */
	function moveOn(item: ReviewItem) {
		const at = cards.findIndex((card) => card.id === item.id);
		const next = cards[at + 1] ?? cards[at - 1];
		setCursor(next?.id ?? null);
	}

	/** "It's a card payment": marks it as a Transfer, which counts nowhere and leaves Review. */
	function markPayment(item: ReviewItem) {
		const transferId = ulid();
		const back = () => {
			marked.current.delete(item.id);
			dispatch({ type: "returned", items: [item] });
		};
		marked.current.set(item.id, transferId);
		moveOn(item);
		decided([item], `${labelOf(item)} is a card payment: not counted as spending.`, "right");
		money.mutate(
			{ kind: "mark", transferId, transactionId: item.id, label: labelOf(item) },
			{ onSuccess: (result) => (result.ok ? undefined : back()), onError: back },
		);
	}

	function confirm(item: ReviewItem) {
		const payment = paymentOf(item);
		// A payment to a card or loan a Commitment pays down: filed there, like any suggestion.
		const itsPlan = planOf(item);
		if (payment?.kind === "commitment" && itsPlan) {
			return file(item, `commitment:${payment.commitmentId}`, itsPlan, "suggested");
		}
		// A Transfer goes in no Bucket, so it's never stuck for want of one.
		if (payment?.kind === "followed") return markPayment(item);
		if (stuck(item)) return nope(item);
		const decision = confirmed(item);
		if (!decision || !item.guess) {
			// Nothing to confirm: a shake, and the picker.
			shake();
			return openPicker(item);
		}
		moveOn(item);
		decided([item], `Filed ${labelOf(item)} in ${item.guess.name}.`, "right", true);
		decide.mutate({ ...decision, quiet: sorting }, failed([item]));
		const { bucketId, name } = item.guess;
		const plan = queryClient.getQueryData(monthQuery(monthOfTransaction(item)).queryKey)?.plan;
		const owner = plan?.buckets.find((b) => b.id === bucketId)?.owner;
		offerRule(item, { id: bucketId, name, owner }, item.for);
	}

	/**
	 * Files a card where the Parent picked: a Bucket or a Commitment. "suggested" is Confirm on a
	 * payment's own Commitment; "anyway" is after the caution about a card Noodle follows.
	 */
	function file(item: ReviewItem, value: string, plan: Plan, how?: "suggested" | "anyway") {
		const [kind, id] = value.split(":") as ["bucket" | "commitment", string];
		const assignment: Assignment = kind === "bucket" ? { bucketId: id } : { commitmentId: id };
		const bucket = kind === "bucket" ? plan.buckets.find((b) => b.id === id) : undefined;
		const name = bucket?.name ?? plan.commitments.find((c) => c.id === id)?.name ?? null;
		// What was bought on a card Noodle follows is already in the Buckets: the payment in a
		// Bucket too counts it twice, so that's asked first, on the card.
		const followedCard = paymentOf(item)?.kind === "followed";
		if (followedCard && bucket && how !== "anyway") {
			return setCaution({ item, value, plan, place: bucket.name });
		}
		moveOn(item);
		// In a Commitment it isn't stopped, but said once.
		const payment = followedCard;
		const warned = how === "anyway";
		const filed = `Filed ${labelOf(item)} in ${name ?? "its Commitment"}.`;
		decided(
			[item],
			payment && !warned ? `${filed} ${PAYMENT_FILED}` : filed,
			how === "suggested" ? "right" : "left",
			how === "suggested",
		);
		decide.mutate(
			{
				quiet: sorting || payment,
				item,
				next: {
					amountCents: item.amountCents,
					note: item.note,
					assignment,
					forMemberIds: item.for,
				},
				placeName: name ?? "its Commitment",
			},
			failed([item]),
		);
		if (payment) {
			// No "Always file …?" for a card payment. In Sort it's said beside the card, by its Undo.
			if (!sorting) {
				toast(warned ? filed : `${filed} ${PAYMENT_FILED}`, {
					tone: "success",
					undo: () => putBack([item]),
				});
			}
			return;
		}
		if (bucket) offerRule(item, bucket, item.for);
		else if (name) offerRule(item, { id, name, owner: undefined, commitment: true }, item.for);
	}

	function changed(item: ReviewItem, next: TransactionChange["next"], buckets: PlanBucket[]) {
		setChanging(null);
		setEditing(null);
		setSplitting(false);
		const decision: ReviewDecision = { item, next, placeName: null, quiet: sorting };
		const assigned = next && "assignment" in next ? next.assignment : null;
		const bucket =
			assigned && "bucketId" in assigned
				? buckets.find((b) => b.id === assigned.bucketId)
				: undefined;
		if (next && "assignment" in next) {
			decision.placeName = bucket?.name ?? "its Commitment";
		}
		moveOn(item);
		decided(
			[item],
			!next
				? `Deleted ${labelOf(item)}.`
				: decision.placeName
					? `Filed ${labelOf(item)} in ${decision.placeName}.`
					: `Split ${labelOf(item)}.`,
		);
		decide.mutate(decision, failed([item]));
		if (bucket && next && "assignment" in next) offerRule(item, bucket, next.forMemberIds);
	}

	function confirmEach(items: ReviewItem[]) {
		const decisions = items.flatMap((item) => {
			const decision = confirmed(item);
			return decision ? [{ ...decision, quiet: sorting }] : [];
		});
		if (decisions.length === 0) return;
		const taken = decisions.map((decision) => decision.item);
		decided(taken, `Filed ${taken.length} where Noodle suggested.`);
		confirmAll.mutate(decisions, {
			...failed(taken),
			onSuccess: ({ skipped }) => leftOut(skipped.map((decision) => decision.item)),
		});
	}

	/** Files cards without a Bucket: out of Review, still unassigned (ADR-0037). */
	function fileAsTheyAre(items: ReviewItem[]) {
		const [first] = items;
		if (!first) return;
		if (items.length === 1) moveOn(first);
		else setCursor(null);
		decided(
			items,
			items.length === 1
				? `Filed ${labelOf(first)} without a Bucket.`
				: `Filed ${items.length} without a Bucket.`,
		);
		fileWithout.mutate(
			{ items, quiet: sorting },
			{
				...failed(items),
				onSuccess: ({ versions }) => leftOut(items.filter((item) => !(item.id in versions))),
			},
		);
	}

	function skip(item: ReviewItem) {
		if (sorting) {
			if (order.length < 2) return;
			dispatch({ type: "skipped", id: item.id });
			setOffer(null);
			run.current = 0;
			setStreak(null);
			focusNext.current = true;
			say(`Skipped ${labelOf(item)}. It’s at the back.`);
			if (!reduced) setLeaving({ item, way: "down" });
			return;
		}
		const at = cards.findIndex((card) => card.id === item.id);
		setCursor((cards[at + 1] ?? cards[0])?.id ?? null);
	}

	/** ←, or a swipe left: the picker, unless there's nowhere to file it. */
	function pickAnother(item: ReviewItem) {
		if (stuck(item)) return nope(item);
		openPicker(item);
	}

	/** The caution a card shows while a Bucket picked for it waits on the Parent's answer. */
	const cautionFor = (item: ReviewItem): PaymentCaution | null =>
		caution?.item.id === item.id
			? {
					place: caution.place,
					onTransfer: () => markPayment(item),
					onAnyway: () => file(item, caution.value, caution.plan, "anyway"),
				}
			: null;

	/** Splits the card, in the editor's Splits. */
	function splitCard(item: ReviewItem) {
		if (stuck(item)) return nope(item);
		setSplitting(true);
		setChanging(item);
	}

	/** The Parent's own Personal Allowance in the card's month, if they have one. */
	const allowanceOf = (item: ReviewItem) =>
		planOf(item)?.buckets.find((bucket) => bucket.owner === parentId);

	/** Files the card in the Parent's own Personal Allowance: only they will see it. */
	function markAllowance(item: ReviewItem) {
		if (stuck(item)) return nope(item);
		const plan = planOf(item);
		const allowance = allowanceOf(item);
		if (!plan || !allowance) {
			say(`You don’t have a Personal Allowance in ${monthName(monthOfTransaction(item))}.`);
			return shake();
		}
		file(item, `bucket:${allowance.id}`, plan);
	}

	function makeRule(item: ReviewItem) {
		if (stuck(item)) return nope(item);
		setRuling(item);
	}

	// → or Enter confirms, ← changes, ↓ skips, Z (or ⌘Z) undoes in Sort, and S splits, P files in
	// the Parent's Personal Allowance, R makes a Rule; not while typing or a sheet is open.
	useEffect(() => {
		if (changing || ruling) return;
		function onKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const typing = target?.closest(
				"input, select, textarea, [role=dialog], [contenteditable=true]",
			);
			if (sorting && !typing && event.key.toLowerCase() === "z" && !event.altKey) {
				if (event.shiftKey || (event.metaKey && event.ctrlKey)) return;
				event.preventDefault();
				return undo();
			}
			const letter = event.key.toLowerCase();
			const card = sorting && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
			const byLetter =
				letter === "s"
					? splitCard
					: letter === "p"
						? markAllowance
						: letter === "r"
							? makeRule
							: null;
			if (card && byLetter && order[0]) {
				event.preventDefault();
				return byLetter(order[0]);
			}
			if (!active || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			if (typing) return;
			// A focused button or link answers keys itself: Enter on a card's button or the Rules
			// link mustn't also confirm the card, nor an arrow move it on.
			// The sidebar's links don't count: arriving from one, the keys work at once.
			if (target?.closest("main") && target.closest("button, a, summary, [role=button]")) return;
			const act =
				event.key === "ArrowRight" || event.key === "Enter"
					? confirm
					: event.key === "ArrowLeft"
						? pickAnother
						: event.key === "ArrowDown"
							? skip
							: null;
			if (!act) return;
			event.preventDefault();
			act(active);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	// What Sort last did and the Rule it offers, under the card or the finish: a slot of its own
	// height, so filling it never moves the card or its buttons.
	const sortNote = (
		<div data-slot="review-note" className="grid h-28 content-start gap-2 sm:h-24">
			<div className="flex min-h-5 items-start justify-center gap-2">
				<p
					role="status"
					data-testid="review-said"
					className="line-clamp-2 min-w-0 text-center text-sm text-muted-foreground"
				>
					{said}
					{streak !== null ? <span className="sr-only"> {streak} in a row!</span> : null}
				</p>
				{streak !== null && cheering ? (
					<span
						aria-hidden="true"
						data-testid="review-streak"
						className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-primary-foreground motion-safe:animate-card-in"
					>
						{streak} in a row!
					</span>
				) : null}
			</div>
			{!said && !offer && hydrated && !reduced ? (
				<p className="text-center text-xs text-muted-foreground lg:hidden">
					Swipe right to confirm, left to pick another
				</p>
			) : null}
			{offer ? (
				<div
					data-testid="review-rule-offer"
					className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-[13px]"
				>
					<span className="line-clamp-2 min-w-0">{ruleQuestion(offer)}</span>
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						disabled={!hydrated}
						onClick={() => takeRule(offer)}
					>
						Always file
					</Button>
				</div>
			) : null}
		</div>
	);

	const confirmAllButton =
		guessed.length > 1 ? (
			<Button
				variant="outline"
				size="sm"
				// On a phone in the list it has the second row; the count and the tools keep the first.
				className={cn(!sorting ? "max-sm:order-last" : "max-[359px]:px-2")}
				disabled={!hydrated || confirmAll.isPending}
				onClick={() => confirmEach(guessed)}
			>
				<CheckCheck />
				{/* On a phone in Sort, "All 3" (just "3" on the narrowest), so the row above the card stays one row. */}
				<span className={cn(sorting && "max-sm:sr-only")}>Confirm all </span>
				{sorting ? (
					<span aria-hidden="true" className="max-[359px]:hidden sm:hidden">
						All{" "}
					</span>
				) : null}
				{guessed.length}
				<span className={cn(sorting && "max-sm:sr-only")}> with a suggestion</span>
			</Button>
		) : null;
	const fileEarlierButton =
		fromEarlier.length > 1 ? (
			<Button
				variant="outline"
				size="wrap"
				// Its long name wraps inside the button on a narrow phone, never off the page.
				className={cn(!sorting && "max-sm:order-last")}
				disabled={!hydrated || fileWithout.isPending}
				onClick={() => fileAsTheyAre(fromEarlier)}
			>
				<Archive />
				File all {fromEarlier.length} from before {monthName(current)} without a Bucket
			</Button>
		) : null;
	const lookAgainButton =
		queue.total > 0 ? (
			<Button
				variant="outline"
				size={sorting ? "icon" : "sm"}
				aria-label={sorting ? "Look again" : undefined}
				title={sorting ? "Look again" : undefined}
				className={cn(!sorting && "max-sm:ms-auto")}
				disabled={!hydrated || lookAgain.isPending}
				onClick={() => lookAgain.mutate()}
			>
				<RefreshCw />
				{sorting ? null : <span className="max-sm:sr-only">Look again</span>}
			</Button>
		) : null;
	const viewToggle = (
		<ToggleGroup
			type="single"
			variant="segmented"
			size="sm"
			aria-label="Show"
			className={sorting ? "shrink-0" : "shrink-0 sm:ml-auto sm:flex sm:w-auto"}
			value={sorting ? "sort" : "list"}
			disabled={!hydrated}
			onValueChange={(value) => {
				if (!value) return;
				setEditing(null);
				void navigate({
					to: "/review",
					search: value === "list" ? { view: "list" } : {},
					replace: true,
				});
			}}
		>
			<ToggleGroupItem value="sort" className="min-w-0">
				<Layers aria-hidden="true" />
				<span className="max-sm:sr-only">One by one</span>
			</ToggleGroupItem>
			<ToggleGroupItem value="list" className="min-w-0">
				<List aria-hidden="true" />
				<span className="max-sm:sr-only">List</span>
			</ToggleGroupItem>
		</ToggleGroup>
	);
	const editingItem = editing ? (cards.find((card) => card.id === editing.id) ?? null) : null;

	return (
		<>
			<div
				className={cn(
					"grid gap-5 *:min-w-0",
					!(top && !sorting) && "max-w-xl",
					// On a phone the stack is cut at the screen's edges: a card dragged or flying off
					// sideways must never make the page wider than the screen, or iOS Safari lets the page
					// slide sideways with it.
					top && sorting && "max-sm:-mx-(--gutter) max-sm:overflow-x-clip max-sm:px-(--gutter)",
				)}
			>
				{top && sorting && order[0] ? (
					// The narrowest phones are short too: less air, so Skip and Undo stay above the bottom bar.
					<div
						data-testid="review-stack"
						data-saving={saving}
						className="grid gap-3 *:min-w-0 max-[359px]:gap-1.5"
					>
						{/* One row above the card: how far along, what Review is, and the rest of its tools. */}
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1 max-[359px]:gap-x-1">
							<h2 className="text-sm font-normal text-muted-foreground tabular-nums">
								{progress.at} of {progress.of}
							</h2>
							<TermHelp term="review" />
							<div className="ms-auto flex items-center gap-2 max-[359px]:gap-1">
								{confirmAllButton}
								{lookAgainButton}
								{viewToggle}
							</div>
						</div>
						<ReviewMatchOffer key={order[0].id} transaction={order[0]} />
						<div className="relative pb-5 max-[359px]:pb-2">
							{/* The cards waiting behind this one, as edges. */}
							{order.length > 2 ? (
								<div
									aria-hidden="true"
									className="absolute inset-x-6 top-6 bottom-0 rounded-2xl bg-card/70 shadow-card ring-1 ring-border"
								/>
							) : null}
							{order.length > 1 ? (
								<div
									aria-hidden="true"
									className="absolute inset-x-3 top-3 bottom-2.5 max-[359px]:bottom-1 rounded-2xl bg-card shadow-card ring-1 ring-border"
								/>
							) : null}
							<SwipeCard
								// A fresh card, undragged, for each Transaction on top.
								key={order[0].id}
								enabled={hydrated && !reduced}
								rightLabel={rightLabelOf(order[0], paymentOf(order[0]))}
								leftLabel="Pick another"
								onRight={() => confirm(order[0] as ReviewItem)}
								onLeft={() => pickAnother(order[0] as ReviewItem)}
							>
								<div
									className={cn("rounded-2xl", wobbling && "motion-safe:animate-wobble")}
									onAnimationEnd={(event) => {
										if (event.animationName === "wobble") setWobbling(false);
									}}
								>
									{/* Focus rests here after each decision; its name says what the card is. */}
									<section
										id="review-top"
										tabIndex={-1}
										aria-label={cardName(order[0], paymentOf(order[0]))}
										className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:animate-card-in"
									>
										<ReviewCard
											item={order[0]}
											today={today}
											members={members}
											parentId={parentId}
											current
											hydrated={hydrated}
											sameMerchant={[]}
											onFocus={() => {}}
											payment={paymentOf(order[0])}
											thisMonth={current}
											caution={cautionFor(order[0])}
											onPayment={() => markPayment(order[0] as ReviewItem)}
											onConfirm={() => confirm(order[0] as ReviewItem)}
											onPick={(value, plan) => file(order[0] as ReviewItem, value, plan)}
											onCreate={
												earlier(order[0])
													? undefined
													: (name, plan) =>
															setCreating({ item: order[0] as ReviewItem, name, plan })
											}
											onEdit={() => onEdit(order[0] as ReviewItem)}
											onConfirmAll={(items) => confirmEach(items)}
											onFileWithout={
												earlier(order[0]) || stuck(order[0])
													? () => fileAsTheyAre([order[0] as ReviewItem])
													: undefined
											}
											actions={
												stuck(order[0]) ? null : (
													<CardActions
														hydrated={hydrated}
														allowance={allowanceOf(order[0]) !== undefined}
														onSplit={() => splitCard(order[0] as ReviewItem)}
														onAllowance={() => markAllowance(order[0] as ReviewItem)}
														onRule={() => makeRule(order[0] as ReviewItem)}
													/>
												)
											}
										/>
									</section>
								</div>
							</SwipeCard>
							{leaving ? (
								<div
									key={`${leaving.item.id}-${leaving.way}`}
									aria-hidden="true"
									inert
									className={cn(
										"pointer-events-none absolute inset-x-0 top-0 z-10",
										leaving.way === "right" && "animate-fly-right",
										leaving.way === "left" && "animate-fly-left",
										leaving.way === "down" && "animate-fly-down",
									)}
									onAnimationEnd={() => setLeaving(null)}
								>
									<ReviewCard
										item={leaving.item}
										payment={paymentOf(leaving.item)}
										thisMonth={current}
										today={today}
										members={members}
										parentId={parentId}
										current
										ghost
										hydrated={hydrated}
										sameMerchant={[]}
										onFocus={() => {}}
										onConfirm={() => {}}
										onPick={() => {}}
										onEdit={() => {}}
										onConfirmAll={() => {}}
									/>
								</div>
							) : null}
						</div>
						<div className="grid grid-cols-2 gap-2">
							<Button
								variant="outline"
								disabled={!hydrated || order.length < 2}
								aria-keyshortcuts="ArrowDown"
								onClick={() => skip(order[0] as ReviewItem)}
							>
								<SkipForward />
								Skip
							</Button>
							<Button
								variant="outline"
								aria-keyshortcuts="Z"
								disabled={!hydrated || !canUndo}
								onClick={undo}
							>
								<Undo2 />
								Undo
							</Button>
						</div>
						{fileEarlierButton && earlier(order[0]) ? (
							<div className="grid">{fileEarlierButton}</div>
						) : null}
						{sortNote}
						<p className="hidden text-center text-xs text-muted-foreground lg:block">
							<Key name="Right arrow">→</Key> or <Key>Enter</Key> to confirm,{" "}
							<Key name="Left arrow">←</Key> to pick another, <Key name="Down arrow">↓</Key> to
							skip, <Key>Z</Key> to undo, <Key>S</Key> to split, <Key>P</Key> for your Personal
							Allowance, <Key>R</Key> to make a Rule
						</p>
					</div>
				) : top ? (
					<MasterDetail
						className="max-w-xl lg:max-w-none"
						listLabel="Cards to review"
						detailLabel={editingItem ? "Transaction" : "About Review"}
						// Until a card is opened the cards have the page's width, side by side (#73).
						listOnly
						list={
							<div className="grid min-w-0 content-start gap-5">
								<div className="grid gap-3">
									<p className="flex items-start gap-1 text-sm text-muted-foreground">
										<span>
											Noodle wasn’t sure where to file these. Confirm its suggestion or pick
											another.
											<span className="max-sm:hidden">
												{" "}
												A card’s pencil opens it beside the list, to split it, change its note or
												say who it was For.
											</span>
										</span>
										<TermHelp term="review" className="mt-0.5" />
									</p>
									<div className="flex flex-wrap items-center gap-2">
										<p data-testid="review-waiting" className="text-sm font-medium tabular-nums">
											{queue.total} to review
										</p>
										{confirmAllButton}
										{fileEarlierButton}
										{lookAgainButton}
										{viewToggle}
									</div>
								</div>
								{months.map(([month, items]) => (
									<section
										key={month}
										aria-labelledby={`review-month-${month}`}
										className="grid min-w-0 gap-3 *:min-w-0"
									>
										<h2
											id={`review-month-${month}`}
											className="text-sm font-semibold text-muted-foreground"
										>
											{monthName(month)}
											{month.slice(0, 4) === current.slice(0, 4) ? "" : ` ${month.slice(0, 4)}`}
										</h2>
										<ReviewCards wide={!editingItem}>
											{items.map((item) => {
												const same = guessed.filter((other) => other.merchant === item.merchant);
												return (
													<div key={item.id} className="grid min-w-0 gap-3 *:min-w-0">
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
															payment={paymentOf(item)}
															thisMonth={current}
															caution={cautionFor(item)}
															onPayment={() => markPayment(item)}
															onConfirm={() => confirm(item)}
															onPick={(value, plan) => file(item, value, plan)}
															onCreate={
																earlier(item)
																	? undefined
																	: (name, plan) => setCreating({ item, name, plan })
															}
															onEdit={() => onEdit(item)}
															onConfirmAll={(items) => confirmEach(items)}
															onFileWithout={
																earlier(item) || stuck(item)
																	? () => fileAsTheyAre([item])
																	: undefined
															}
														/>
													</div>
												);
											})}
										</ReviewCards>
									</section>
								))}
								<p className="hidden text-center text-xs text-muted-foreground lg:block">
									<Key name="Right arrow">→</Key> or <Key>Enter</Key> to confirm,{" "}
									<Key name="Left arrow">←</Key> to change, <Key name="Down arrow">↓</Key> to skip
								</p>
							</div>
						}
						detail={
							editingItem ? (
								<Suspense fallback={<DetailPending />}>
									<ChangePane
										key={editingItem.id}
										item={editingItem}
										today={today}
										members={members}
										parentId={parentId}
										onChange={(next, buckets) => changed(editingItem, next, buckets)}
										onClose={() => setEditing(null)}
									/>
								</Suspense>
							) : undefined
						}
					/>
				) : (
					<div id="review-finish" tabIndex={-1} className="relative rounded-2xl outline-none">
						{stack.done > 0 && !reduced ? <Burst /> : null}
						<Card className="p-0">
							<EmptyState
								icon={<CheckCheck />}
								title={stack.done > 0 ? "All sorted" : "Nothing to review"}
								description={`${stack.done > 0 ? `Nothing to review now. You did ${stack.done}. ` : ""}${
									queue.filedOnItsOwn > 0
										? `Noodle filed ${queue.filedOnItsOwn} on its own this month.`
										: "Noodle filed everything on its own."
								} Anything it isn’t sure about waits here for you.`}
								action={
									<div className="flex flex-wrap justify-center gap-2">
										{stack.history.length > 0 ? (
											<Button variant="outline" size="sm" disabled={!canUndo} onClick={undo}>
												<Undo2 />
												Undo
											</Button>
										) : null}
										<Button variant="outline" size="sm" asChild>
											<Link to="/transactions">See Transactions</Link>
										</Button>
									</div>
								}
							/>
						</Card>
						{sorting ? <div className="mt-3 grid gap-3">{sortNote}</div> : null}
					</div>
				)}
				{/* Rules background AI would add, from what this Parent keeps filing by hand: quiet, below. */}
				<Suggested kinds={["rule"]} className="max-w-xl" />
			</div>
			{creating ? (
				<Suspense fallback={null}>
					<NewBucketStep
						month={monthOfTransaction(creating.item)}
						name={creating.name}
						what={labelOf(creating.item)}
						amountCents={creating.item.amountCents}
						buckets={creating.plan.buckets}
						taken={[...creating.plan.buckets, ...creating.plan.commitments].map((p) => p.name)}
						onCancel={() => setCreating(null)}
						onCreated={(bucket) => {
							// The Bucket is in the Plan: now the usual filing, with its Undo and its Rule offer.
							setCreating(null);
							file(creating.item, `bucket:${bucket.id}`, {
								...creating.plan,
								buckets: [...creating.plan.buckets, bucket],
							});
						}}
					/>
				</Suspense>
			) : null}
			{changing ? (
				<Suspense fallback={null}>
					<ChangeSheet
						splitting={splitting}
						item={changing}
						today={today}
						members={members}
						parentId={parentId}
						onChange={(next, buckets) => changed(changing, next, buckets)}
						onClose={() => {
							setChanging(null);
							setSplitting(false);
						}}
					/>
				</Suspense>
			) : null}
			<Sheet open={ruling !== null} onOpenChange={(open) => (open ? undefined : setRuling(null))}>
				<SheetContent>
					<SheetHeader
						title="Make a Rule"
						description="New statement lines whose merchant contains these words are filed on their own."
					/>
					{ruling ? (
						<RuleForm
							key={ruling.id}
							rule={null}
							buckets={(planOf(ruling)?.buckets ?? []).filter((b) => canAssign(b, parentId))}
							commitments={planOf(ruling)?.commitments}
							members={members}
							start={{
								pattern: ruling.merchant,
								bucketId: ruling.guess?.bucketId,
								for: ruling.for,
							}}
							onDone={() => setRuling(null)}
						/>
					) : null}
				</SheetContent>
			</Sheet>
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

type Way = "right" | "left" | "down";
/** Where an offered Rule files: a Bucket, or a Commitment (shared, so no owner). */
type RuleTarget = Pick<PlanBucket, "id" | "name" | "owner"> & { commitment?: true };
type RuleOffer = {
	item: ReviewItem;
	bucket: RuleTarget;
	forMemberIds: string[];
};

/** A card's merchant: its clean name, else its statement line as shown (displayMerchant). */
const labelOf = (item: ReviewItem) =>
	item.merchantName ?? displayMerchant(item.note ?? item.merchant);

/** The top card's name for a screen reader: what, how much, and the suggestion. */
const cardName = (item: ReviewItem, payment: PaymentCase | null = null) =>
	`${labelOf(item)}, ${formatMoney(item.amountCents)}, ${
		payment?.kind === "commitment"
			? `suggested ${payment.commitment}, a payment to ${payment.account}`
			: payment?.kind === "followed"
				? "looks like a card payment"
				: payment
					? "looks like a payment to a card Noodle doesn’t follow"
					: item.guess
						? `suggested ${item.guess.name}`
						: "no suggestion"
	}`;

/** What a swipe right on the top card does. */
const rightLabelOf = (item: ReviewItem, payment: PaymentCase | null) =>
	payment?.kind === "commitment"
		? `${payment.commitment} ✓`
		: payment?.kind === "followed"
			? "Card payment ✓"
			: item.guess
				? `${item.guess.name} ✓`
				: "Pick where it goes";

/**
 * Which case of the payment tree a card in Review is (paymentCase), by the bank's own wording (its
 * note). Its name is read only when there is no wording, since a Parent may have renamed it. The
 * Account it left is never the one paid: a card doesn't pay itself.
 */
function cardPaymentOf(
	item: ReviewItem,
	cardsAndLoans: PaymentAccount[],
	paying: PayingCommitment[],
): PaymentCase | null {
	const text = item.note || (item.merchantName ?? item.merchant);
	return paymentCase(
		{ text, amountCents: item.amountCents, from: item.importedFrom },
		cardsAndLoans,
		paying,
	);
}

/** A Bucket was picked for a payment to a card Noodle follows: what the card asks first. */
type PaymentCaution = { place: string; onTransfer: () => void; onAnyway: () => void };

/** Said once when a likely card payment is filed in a Bucket or a Commitment anyway. */
const PAYMENT_FILED = "Card payments usually aren’t spending.";
/**
 * Why, as the second line of a payment card's panel, naming the card when the line does: a card
 * payment goes in no Bucket, or a payment to a card Noodle can't see into is planned like a bill.
 */
const paymentWhy = (payment: Exclude<PaymentCase, { kind: "commitment" }>) =>
	payment.kind === "followed"
		? `What you bought on ${payment.card ?? "the card"} is already in your Buckets, so the payment itself isn’t spending.`
		: `Noodle can’t see what was bought on ${payment.card ?? "this card"}, so the payment is the spending.`;

/** The top card's other actions: split it, file it in the Parent's own Personal Allowance, or make a Rule. */
function CardActions({
	hydrated,
	allowance,
	onSplit,
	onAllowance,
	onRule,
}: {
	hydrated: boolean;
	allowance: boolean;
	onSplit: () => void;
	onAllowance: () => void;
	onRule: () => void;
}) {
	return (
		// One row on a phone (#74): the shorter words are shown, the whole name is still read out.
		<div className="-mx-2 flex flex-wrap gap-1 border-t border-border pt-2 max-[359px]:-mb-2 max-[359px]:pt-1 max-[359px]:[&>button]:px-2">
			<Button
				variant="ghost"
				size="sm"
				aria-keyshortcuts="S"
				disabled={!hydrated}
				onClick={onSplit}
			>
				<SplitIcon />
				Split
			</Button>
			{allowance ? (
				<Button
					variant="ghost"
					size="sm"
					aria-keyshortcuts="P"
					disabled={!hydrated}
					onClick={onAllowance}
				>
					<Wallet />
					<span>
						<span className="max-sm:sr-only">Personal </span>Allowance
					</span>
				</Button>
			) : null}
			<Button variant="ghost" size="sm" aria-keyshortcuts="R" disabled={!hydrated} onClick={onRule}>
				<ListPlus />
				<span>
					<span className="max-sm:sr-only">Make a </span>Rule
				</span>
			</Button>
		</div>
	);
}

/** A small burst at the end of the stack; only drawn with motion. */
function Burst() {
	return (
		<div aria-hidden="true" className="pointer-events-none absolute top-12 left-1/2 z-10">
			{Array.from({ length: 10 }, (_, at) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed ring of dots
					key={at}
					style={{ "--burst-angle": `${at * 36}deg` } as CSSProperties}
					className="absolute -ml-1 size-2 animate-burst rounded-full bg-primary even:bg-ring"
				/>
			))}
		</div>
	);
}

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
	onCreate,
	onEdit,
	onConfirmAll,
	onFileWithout,
	payment = null,
	thisMonth,
	caution = null,
	onPayment,
	ghost = false,
	actions,
}: {
	item: ReviewItem;
	/**
	 * It reads as a payment to a card or loan: its Commitment, a Transfer, or (a card Noodle
	 * doesn't follow) a Commitment to make, is offered first, and a Bucket second.
	 */
	payment?: PaymentCase | null;
	/** The Household's month now: where a Commitment for it would be added. */
	thisMonth: MonthKey;
	caution?: PaymentCaution | null;
	/** Marks it as a Transfer. */
	onPayment?: () => void;
	today: DayKey;
	members: MemberSummary[];
	parentId: string;
	current: boolean;
	hydrated: boolean;
	sameMerchant: ReviewItem[];
	onFocus: () => void;
	onConfirm: () => void;
	onPick: (value: string, plan: Plan) => void;
	/** Makes a Bucket by the name typed in the picker, and files it there. Not for an earlier month. */
	onCreate?: (name: string, plan: Plan) => void;
	onEdit: () => void;
	onConfirmAll: (items: ReviewItem[]) => void;
	/** Files it without a Bucket: offered for an earlier month, or one with nothing to file in. */
	onFileWithout?: () => void;
	/** A copy flying off the stack: not a card to find or act on. */
	ghost?: boolean;
	/** More it can do, under it (Sort's top card). */
	actions?: ReactNode;
}) {
	const month = monthOfTransaction(item);
	const plan = useQuery(monthQuery(month)).data?.plan;
	const places = plan ? placesIn(plan, parentId) : null;
	const bucket = plan?.buckets.find((b) => b.id === item.guess?.bucketId);
	const headingId = `review-${item.id}`;
	const empty = places !== null && places.buckets.length === 0 && places.commitments.length === 0;
	const choices: ChoiceGroup[] = places
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
			data-testid={ghost ? undefined : "review-card"}
			data-current={current || undefined}
			data-payment={payment?.kind}
			onFocusCapture={onFocus}
			className={cn(
				// Its rows shrink with it: a row that can't (a long button beside the picker) wraps instead.
				"grid min-w-0 gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border *:min-w-0 max-[359px]:gap-1.5 max-[359px]:p-3 sm:gap-4 sm:p-5",
				current && "ring-2 ring-ring",
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="grid min-w-0 gap-0.5">
					{/* On a phone a long Account name goes to a second line rather than being cut mid-word;
					    the narrowest have no height to spare for it. */}
					<p className="text-xs text-muted-foreground max-[359px]:truncate min-[360px]:max-sm:line-clamp-2 sm:truncate">
						{dayName(item.date, today)}
						{item.importedFrom ? ` · ${item.importedFrom}` : ""}
					</p>
					<h3
						id={headingId}
						className={cn(
							"text-base font-semibold max-sm:wrap-anywhere sm:truncate",
							// A payment card has more on it: on the shortest phones its name keeps to one line.
							// Each width has one rule of its own, so neither depends on which is written last.
							payment
								? "max-[359px]:line-clamp-1 min-[360px]:max-sm:line-clamp-2"
								: "max-sm:line-clamp-2",
						)}
					>
						{labelOf(item)}
					</h3>
					{item.for.length > 0 ? (
						<p className="text-sm text-muted-foreground">For {forLabel(members, item.for)}</p>
					) : null}
				</div>
				<div className="grid shrink-0 justify-items-end gap-1">
					<p className="text-xl font-semibold tracking-tight tabular-nums">
						{formatMoney(item.amountCents)}
					</p>
					<Badge>
						{payment?.kind === "commitment"
							? "Payment"
							: payment?.kind === "followed"
								? "Not spending?"
								: payment
									? "Card payment"
									: item.guess
										? "We weren’t sure"
										: "New merchant"}
					</Badge>
				</div>
			</div>
			<div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 max-[359px]:py-1.5">
				{payment?.kind === "commitment" ? (
					<>
						{/* The narrowest phones are the shortest: the words get the tile's width there. */}
						<div className="shrink-0 max-[359px]:hidden">
							<Tile aria-hidden="true">{monogram(payment.commitment)}</Tile>
						</div>
						<div className="grid min-w-0 flex-1">
							<span className="text-sm font-medium wrap-anywhere">
								Payment to {payment.account}
							</span>
							<span className="text-xs text-muted-foreground wrap-anywhere">
								Files in {payment.commitment}
								<span className="max-[359px]:sr-only"> · pays down what’s owed</span>
							</span>
						</div>
					</>
				) : payment ? (
					<>
						{/* The narrowest phones are the shortest: there the why says it alone, in the tile's
						    width as well, and the title is only read out. */}
						<div className="shrink-0 max-[359px]:hidden">
							<Tile aria-hidden="true">
								{payment.kind === "followed" ? <ArrowLeftRight /> : <Wallet />}
							</Tile>
						</div>
						<div className="grid min-w-0 flex-1">
							<span className="text-sm font-medium wrap-anywhere max-[359px]:sr-only">
								{payment.kind === "followed"
									? "Card payment — not spending"
									: "Payment to a card Noodle doesn’t follow"}
							</span>
							<span
								className="text-xs text-muted-foreground wrap-anywhere"
								data-testid="review-payment-why"
							>
								{paymentWhy(payment)}
								{payment.kind === "not-followed" ? (
									// On the narrowest phones this choice is here, not on a row of its own.
									<>
										{" "}
										<Link
											to="/accounts"
											className="-my-1 inline-block py-1 font-medium whitespace-nowrap text-foreground underline underline-offset-2 min-[360px]:hidden"
										>
											Connect the card
										</Link>
									</>
								) : null}
							</span>
						</div>
						<TermHelp term="card-payment" />
					</>
				) : item.guess ? (
					<>
						<Tile aria-hidden="true" bucket={bucket ? asBucketColor(bucket.color) : undefined}>
							{monogram(item.guess.name)}
						</Tile>
						<div className="grid min-w-0 flex-1">
							<span className="truncate text-sm font-medium">{item.guess.name}</span>
							<span className="text-xs text-muted-foreground wrap-anywhere">
								{suggestionWhy(item.guess)}
							</span>
						</div>
						{item.guess.confidence !== null ? (
							<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
								{Math.round(item.guess.confidence * 100)}% sure
							</span>
						) : null}
					</>
				) : (
					<>
						<Tile aria-hidden="true">
							<Sparkles />
						</Tile>
						<p className="min-w-0 text-sm font-medium">
							{empty ? "No suggestion" : "No suggestion — pick where it goes"}
						</p>
					</>
				)}
			</div>
			{caution ? (
				// A Bucket was picked for a payment to a card Noodle follows: asked before it's filed.
				<div data-testid="review-payment-caution" className="grid gap-2">
					<p className="text-sm wrap-anywhere">
						<span className="font-medium">File a card payment in {caution.place}?</span> What was
						bought on the card is already counted, so this counts it twice.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button className="max-sm:flex-1" disabled={!hydrated} onClick={caution.onTransfer}>
							<ArrowLeftRight />
							Mark as Transfer
						</Button>
						<Button
							variant="outline"
							className="max-sm:flex-1"
							disabled={!hydrated}
							onClick={caution.onAnyway}
						>
							File anyway
						</Button>
					</div>
				</div>
			) : empty && !payment ? (
				<div className="grid gap-2 text-sm sm:flex sm:items-center sm:justify-between">
					<p>
						{plan?.baseline === null
							? `${name} has no Plan yet, so there’s no Bucket to file this in. Filing it without one changes nothing in ${name}.`
							: `${name}’s Plan has no Buckets yet, so there’s no Bucket to file this in.`}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						<Button variant="ghost" size="sm" asChild>
							<Link to="/plan/$month/buckets" params={{ month }}>
								Set up {name}’s Plan
							</Link>
						</Button>
						{onFileWithout ? (
							<Button size="sm" disabled={!hydrated} onClick={onFileWithout}>
								<Archive />
								File without a Bucket
							</Button>
						) : null}
					</div>
				</div>
			) : (
				<div
					className={cn(
						"flex items-center gap-2 max-[359px]:flex-wrap",
						// "It’s a card payment" is long: on any phone it has the first row with Edit, and the
						// picker the whole row under them, so the card is never wider than the screen.
						payment && "max-sm:flex-wrap",
					)}
				>
					<BucketPicker
						id={pickerId(item)}
						// On the narrowest phones, with a suggestion, the picker has the row under Confirm and Edit.
						className={cn(
							"min-w-0 flex-1",
							item.guess && "max-[359px]:order-last max-[359px]:basis-full",
							payment && "max-sm:order-last",
							// On the narrowest phones "It’s a card payment" shares the picker's row. Each
							// width has one rule of its own, so neither depends on which is written last.
							payment?.kind === "not-followed"
								? "max-[359px]:basis-[30%] min-[360px]:max-sm:basis-full"
								: payment && "max-sm:basis-full",
						)}
						aria-label={`Where ${labelOf(item)} goes`}
						disabled={!hydrated || !places}
						placeholder={
							payment?.kind === "commitment"
								? "Pick another…"
								: payment
									? "Or pick a Bucket…"
									: item.guess
										? "Pick another…"
										: "Pick where it goes"
						}
						searchPlaceholder="Find a Bucket"
						choices={choices}
						onValueChange={(value) => plan && onPick(value, plan)}
						onCreate={onCreate && plan ? (name) => onCreate(name, plan) : undefined}
					/>
					<Button
						variant="ghost"
						size="icon"
						aria-label={`Edit ${labelOf(item)}`}
						disabled={!hydrated}
						onClick={onEdit}
					>
						<Pencil />
					</Button>
					{payment?.kind === "followed" ? (
						<Button
							className="max-sm:order-first max-sm:min-w-0 max-sm:flex-1"
							disabled={!hydrated}
							onClick={onPayment}
						>
							<Check />
							It’s a card payment
						</Button>
					) : null}
					{payment?.kind === "commitment" ? (
						// Like every payment card on a phone: Confirm and Edit, then the picker under them.
						<Button
							className="max-sm:order-first max-sm:min-w-0 max-sm:flex-1"
							disabled={!hydrated}
							onClick={onConfirm}
						>
							<Check />
							Confirm
						</Button>
					) : null}
					{payment?.kind === "not-followed" ? (
						// The payment is the spending, so it's planned like a bill: the Commitment's form
						// opens with this line's name and amount, and the card to pay down ready.
						<Button
							className="max-sm:order-first max-sm:min-w-0 max-sm:grow max-sm:shrink max-[359px]:basis-[70%] min-[360px]:max-sm:basis-0"
							asChild
						>
							<Link
								to="/plan/$month/commitments"
								params={{ month: thisMonth }}
								search={{
									name: labelOf(item).slice(0, 40),
									amount: item.amountCents,
									paysDown: payment.accountId ?? "add",
								}}
							>
								Make it a Commitment
							</Link>
						</Button>
					) : null}
					{payment?.kind === "not-followed" ? (
						// The narrowest phones are the shortest too: there the card's last choice sits beside
						// the picker, so Skip and Undo stay above the bottom bar. Wider, it has its own row.
						<Button
							variant="outline"
							className="order-last shrink-0 px-2 text-xs min-[360px]:hidden"
							disabled={!hydrated}
							onClick={onPayment}
						>
							It’s a card payment
						</Button>
					) : null}
					{item.guess ? (
						<Button
							// On a phone Confirm comes first. On the narrowest it shares its row with Edit and
							// the picker goes under them, so no button is left on a row alone.
							className="max-sm:order-first max-[359px]:flex-1"
							disabled={!hydrated}
							onClick={onConfirm}
						>
							<Check />
							Confirm
						</Button>
					) : null}
				</div>
			)}
			{payment?.kind === "not-followed" && !caution ? (
				// Its other two ways out: see into the card, or say the payment isn't spending after all.
				// The narrowest phones have no height for this row: there "Connect the card" ends the why
				// above and "It’s a card payment" sits beside the picker.
				<div className="flex flex-wrap gap-2 max-[359px]:hidden">
					<Button variant="outline" className="max-sm:flex-auto" asChild>
						<Link to="/accounts">Connect the card</Link>
					</Button>
					<Button
						variant="outline"
						className="max-sm:flex-auto"
						disabled={!hydrated}
						onClick={onPayment}
					>
						It’s a card payment
					</Button>
				</div>
			) : null}
			{onFileWithout && (!empty || payment) ? (
				<Button
					variant="link"
					// Wraps on a narrow phone rather than running off the card.
					size="wrap"
					className="justify-self-start px-0"
					disabled={!hydrated}
					onClick={onFileWithout}
				>
					{name} is over: file without a Bucket
				</Button>
			) : null}
			{sameMerchant.length > 1 ? (
				<Button
					variant="link"
					// Wraps on a narrow phone rather than running off the card.
					size="wrap"
					className="justify-self-start px-0"
					disabled={!hydrated}
					onClick={() => onConfirmAll(sameMerchant)}
				>
					Confirm all {sameMerchant.length} from “{item.merchant}”
				</Button>
			) : null}
			{actions}
		</article>
	);
}

/** The list's card's Transaction editor beside the list, from lg, against its own month's Plan. */
function ChangePane({
	item,
	today,
	members,
	parentId,
	onChange,
	onClose,
}: {
	item: ReviewItem;
	today: DayKey;
	members: MemberSummary[];
	parentId: string;
	onChange: (next: TransactionChange["next"], buckets: PlanBucket[]) => void;
	onClose: () => void;
}) {
	const data = useSuspenseQuery(monthQuery(monthOfTransaction(item))).data;
	// The other Parent's Personal Allowance isn't this Parent's to assign to.
	const plan = { ...data.plan, buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)) };
	return (
		<Card className="p-(--card-pad)">
			<TransactionBody
				inline
				transaction={{ ...item, bucketId: item.guess?.bucketId ?? null }}
				today={today}
				plan={plan}
				members={members}
				parentId={parentId}
				heading={(title) => (
					<DetailHeader
						eyebrow={dayName(item.date, today)}
						title={title}
						leading={
							<Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
								<X className="size-5" />
							</Button>
						}
					/>
				)}
				onClose={onClose}
				onChange={(next) => onChange(next, plan.buckets)}
			/>
		</Card>
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
	splitting,
}: {
	item: ReviewItem;
	today: DayKey;
	members: MemberSummary[];
	parentId: string;
	onChange: (next: TransactionChange["next"], buckets: PlanBucket[]) => void;
	onClose: () => void;
	splitting: boolean;
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
			splitting={splitting}
		/>
	);
}

/**
 * A month's cards in the list view: side by side across the page (two columns, three from 1680)
 * until one is opened, then one column beside it.
 */
function ReviewCards({ wide, children }: { wide: boolean; children: ReactNode }) {
	return wide ? (
		<SectionGrid columns={3} className="gap-3">
			{children}
		</SectionGrid>
	) : (
		<div className="grid gap-3">{children}</div>
	);
}
