import type { ReviewItem, RuleRow } from "@noodle/db";
import { merchantKey, ruleFor } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import {
	type InfiniteData,
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { snapshotsKey } from "./household-changes";
import { monthChangeKey } from "./plan-changes";
import { monthQuery, reviewQuery, rulesQuery } from "./queries";
import { reviewWrites } from "./review-stack";
import {
	applyRule,
	deleteRule,
	editRule,
	fileWithoutBucket,
	lookAgainAtReview,
	returnToReview,
	saveRule,
} from "./server/review";
import type { TransactionsPage } from "./server/transactions";
import {
	applyTransactionChange,
	monthOfTransaction,
	refetchAfterChange,
	saveTransactionChange,
	type TransactionChange,
	type TransactionEdit,
	transactionLabel,
	transactionsKey,
} from "./transactions";

export type { ReviewItem, RuleRow };

// Review's writes (ADR-0006). Deciding a card is an ordinary Transaction change: it leaves the
// stack and lands in its month at once, with an Undo that puts it back. A Rule stated from a
// card can file the rest of the stack's cards for that merchant too. These writes are sent one
// at a time, in the order they were made (`reviewWrites`), so a decision and an Undo never cross.

/** Review's cards in the order the server sends them: oldest first. */
const byDate = (a: ReviewItem, b: ReviewItem) =>
	a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** Takes cards out of the cached stack. Returns what puts it back. */
async function takeCards(queryClient: QueryClient, leaving: (item: ReviewItem) => boolean) {
	const { queryKey } = reviewQuery();
	await queryClient.cancelQueries({ queryKey });
	const previous = queryClient.getQueryData(queryKey);
	if (previous) {
		const items = previous.items.filter((item) => !leaving(item));
		queryClient.setQueryData(queryKey, {
			...previous,
			items,
			total: Math.max(0, previous.total - (previous.items.length - items.length)),
		});
	}
	return () => {
		if (previous) queryClient.setQueryData(queryKey, previous);
	};
}

/** A card's decision: its Transaction, and what it now is (null: deleted). */
export type ReviewDecision = {
	item: ReviewItem;
	next: TransactionEdit | null;
	/** Where it went, for the message: a Bucket's name; null when it was split. */
	placeName: string | null;
	/** Said beside the card rather than in a toast (Review's Sort). */
	quiet?: boolean;
};

const changeOf = ({ item, next }: ReviewDecision): TransactionChange => ({
	transaction: item,
	label: transactionLabel(item),
	next,
});

/**
 * Confirms or changes a card: it leaves the stack and its Transaction's change lands in its
 * month and lists before the server answers, with an Undo in the toast. A failure puts it all
 * back and offers a retry.
 */
export function useReviewDecision({
	onUndo,
}: {
	/** A toast's Undo, through the caller's own history (Review's stack), so the two agree. */
	onUndo?: (items: ReviewItem[]) => void;
} = {}) {
	const queryClient = useQueryClient();
	const returnCard = useReturnToReview();
	const decide = useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		mutationFn: (decision: ReviewDecision) => saveTransactionChange(changeOf(decision)),
		onMutate: async (decision) => {
			const putBack = await takeCards(queryClient, (item) => item.id === decision.item.id);
			const rollback = await applyTransactionChange(queryClient, changeOf(decision));
			return {
				rollback: () => {
					putBack();
					rollback();
				},
			};
		},
		onError: (_error, decision, context) => {
			context?.rollback();
			// Sort says so beside the card, which is back on top to try again.
			if (decision.quiet) return;
			toast(`Couldn’t file ${transactionLabel(decision.item)}, so it’s back in Review.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => decide.mutate(decision) },
			});
		},
		onSuccess: (_data, decision) => {
			const label = transactionLabel(decision.item);
			// Sort says so beside the card, with its own Undo; a toast would sit over the next one.
			if (decision.quiet) return;
			if (!decision.next) return toast(`${label} deleted`);
			toast(decision.placeName ? `${label} filed in ${decision.placeName}` : `${label} split`, {
				tone: "success",
				action: {
					label: "Undo",
					onClick: () => (onUndo ? onUndo([decision.item]) : returnCard.mutate(decision.item)),
				},
			});
		},
		onSettled: () => refetchAfterChange(queryClient),
	});
	return decide;
}

/**
 * Confirms several cards at once, each in its suggestion: they leave the stack and land in their
 * months at once, with one Undo that puts them all back. A failure puts back what wasn't saved.
 */
export function useConfirmAll({
	onUndo,
}: {
	/** The toast's Undo, through the caller's own history, as useReviewDecision's. */
	onUndo?: (items: ReviewItem[]) => void;
} = {}) {
	const queryClient = useQueryClient();
	const returnCard = useReturnToReview();
	const confirmAll = useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		mutationFn: async (decisions: ReviewDecision[]) => {
			// One at a time: each is an ordinary Transaction change.
			for (const decision of decisions) await saveTransactionChange(changeOf(decision));
		},
		onMutate: async (decisions) => {
			const ids = new Set(decisions.map((d) => d.item.id));
			const putBack = await takeCards(queryClient, (item) => ids.has(item.id));
			const rollbacks: (() => void)[] = [];
			for (const decision of decisions) {
				rollbacks.push(await applyTransactionChange(queryClient, changeOf(decision)));
			}
			return {
				rollback: () => {
					putBack();
					for (const rollback of rollbacks.reverse()) rollback();
				},
			};
		},
		onError: (_error, decisions, context) => {
			context?.rollback();
			if (decisions.every((decision) => decision.quiet)) return;
			toast(`Couldn’t file all ${decisions.length}, so what wasn’t filed is back in Review.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => confirmAll.mutate(decisions) },
			});
		},
		onSuccess: (_data, decisions) => {
			// Sort says so beside the stack, whose Undo is right there.
			if (decisions.every((decision) => decision.quiet)) return;
			toast(`Filed ${decisions.length} where Noodle suggested`, {
				tone: "success",
				action: {
					label: "Undo",
					onClick: () => {
						if (onUndo) return onUndo(decisions.map((decision) => decision.item));
						for (const decision of decisions) returnCard.mutate(decision.item);
					},
				},
			});
		},
		onSettled: () => refetchAfterChange(queryClient),
	});
	return confirmAll;
}

/**
 * Files cards without a Bucket (ADR-0037): they leave Review at once and stay unassigned, so no
 * month's figures change. One Undo puts them all back. A failure puts them back and offers a retry.
 */
export function useFileWithoutBucket({
	onUndo,
}: {
	/** The toast's Undo, through the caller's own history, as useReviewDecision's. */
	onUndo?: (items: ReviewItem[]) => void;
} = {}) {
	const queryClient = useQueryClient();
	const returnCard = useReturnToReview();
	const file = useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		mutationFn: ({ items }: { items: ReviewItem[]; quiet?: boolean }) =>
			fileWithoutBucket({ data: { transactionIds: items.map((item) => item.id) } }),
		onMutate: async ({ items }) => {
			const ids = new Set(items.map((item) => item.id));
			return { putBack: await takeCards(queryClient, (item) => ids.has(item.id)) };
		},
		onError: (_error, variables, context) => {
			context?.putBack();
			if (variables.quiet) return;
			const [first] = variables.items;
			toast(
				variables.items.length === 1 && first
					? `Couldn’t file ${transactionLabel(first)}, so it’s back in Review.`
					: `Couldn’t file all ${variables.items.length}, so they’re back in Review.`,
				{ tone: "error", action: { label: "Retry", onClick: () => file.mutate(variables) } },
			);
		},
		onSuccess: (_data, { items, quiet }) => {
			if (quiet) return;
			const [first] = items;
			toast(
				items.length === 1 && first
					? `${transactionLabel(first)} filed without a Bucket`
					: `Filed ${items.length} without a Bucket`,
				{
					tone: "success",
					action: {
						label: "Undo",
						onClick: () => {
							if (onUndo) return onUndo(items);
							for (const item of items) returnCard.mutate(item);
						},
					},
				},
			);
		},
		onSettled: () => refetchAfterChange(queryClient),
	});
	return file;
}

/** A list's pages with a Transaction back as Review has it: unassigned, unsplit. */
function withRowReturned(
	data: InfiniteData<TransactionsPage>,
	item: ReviewItem,
): InfiniteData<TransactionsPage> {
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			transactions: page.transactions.map((row) =>
				row.id === item.id
					? {
							...row,
							amountCents: item.amountCents,
							note: item.note,
							bucketId: null,
							commitmentId: null,
							for: item.for,
							splits: [],
							autoFiled: null,
						}
					: row,
			),
		})),
	};
}

/**
 * Undoes a card's decision: the card goes back into the stack where it was and its Transaction
 * leaves whatever it was filed in, unassigned again. It can't unteach its merchant to
 * categorization, which learned it from the decision.
 */
export function useReturnToReview() {
	const queryClient = useQueryClient();
	const returnCard = useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		mutationFn: (item: ReviewItem) =>
			returnToReview({
				data: {
					transactionId: item.id,
					month: monthOfTransaction(item),
					merchant: item.merchant,
					guess: item.guess
						? {
								bucketId: item.guess.bucketId,
								confidence: item.guess.confidence,
								method: item.guess.method,
								reason: item.guess.reason,
							}
						: null,
					forMemberIds: item.for,
				},
			}),
		onMutate: async (item) => {
			const { queryKey } = reviewQuery();
			const monthKey = monthQuery(monthOfTransaction(item)).queryKey;
			await Promise.all([
				queryClient.cancelQueries({ queryKey }),
				queryClient.cancelQueries({ queryKey: monthKey }),
			]);
			const previous = queryClient.getQueryData(queryKey);
			if (previous && !previous.items.some((card) => card.id === item.id)) {
				queryClient.setQueryData(queryKey, {
					...previous,
					items: [...previous.items, item].sort(byDate),
					total: previous.total + 1,
				});
			}
			// Unassigned, it adds nothing to its month.
			const previousMonth = queryClient.getQueryData(monthKey);
			if (previousMonth) {
				queryClient.setQueryData(monthKey, {
					...previousMonth,
					spending: previousMonth.spending.filter((spend) => spend.id !== item.id),
					charges: previousMonth.charges.filter((charge) => charge.id !== item.id),
				});
			}
			const previousLists = queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
				queryKey: transactionsKey(monthOfTransaction(item)),
			});
			for (const [key, list] of previousLists) {
				if (list) queryClient.setQueryData(key, withRowReturned(list, item));
			}
			return {
				rollback: () => {
					if (previous) queryClient.setQueryData(queryKey, previous);
					if (previousMonth) queryClient.setQueryData(monthKey, previousMonth);
					for (const [key, list] of previousLists) queryClient.setQueryData(key, list);
				},
			};
		},
		onError: (_error, item, context) => {
			context?.rollback();
			toast(`Couldn’t put ${transactionLabel(item)} back in Review.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => returnCard.mutate(item) },
			});
		},
		onSettled: () => refetchAfterChange(queryClient),
	});
	return returnCard;
}

export type RuleInput = {
	ruleId: string;
	pattern: string;
	/** What it files into: a Bucket, or with this null, `commitmentId` (ADR-0030). */
	bucketId: string | null;
	commitmentId?: string | null;
	forMemberIds: string[];
};

/** What applying a Rule did: how many it filed, and whether a snapshot was taken first. */
export type RuleApplied = { filed: number; snapshot: boolean };

/**
 * Said after a Rule filed more than one Transaction: Noodle took a snapshot first (ADR-0035), and
 * where to put things back from.
 */
export const SNAPSHOT_FIRST =
	"Noodle took a snapshot first, so you can put things back from Snapshots in Household settings.";

/** What's said once a Rule from Rules was applied to what's still unassigned. */
export const ruleAppliedMessage = (
	{ filed, snapshot }: RuleApplied,
	rule: { pattern: string; bucketName: string },
) =>
	filed === 0
		? `Nothing unassigned matches ${rule.pattern}`
		: snapshot
			? `Filed ${filed} in ${rule.bucketName}. ${SNAPSHOT_FIRST}`
			: `Filed ${filed} in ${rule.bucketName}`;

/** What's said once a Rule was saved, and applied to what's still unassigned. */
export const ruleSavedMessage = (
	{ filed, snapshot }: RuleApplied,
	rule: { pattern: string; bucketName: string },
) =>
	filed === 0
		? `Rule saved: ${rule.pattern} goes in ${rule.bucketName}`
		: snapshot
			? `Rule saved. Filed ${filed} more in ${rule.bucketName}. ${SNAPSHOT_FIRST}`
			: `Rule saved. Filed ${filed} more in ${rule.bucketName}.`;

/**
 * How the toast after an apply shows. With the snapshot sentence it is some 25 words, far more
 * than a plain toast's 2.4 seconds allow, so it stays ten seconds: long enough to read, without
 * sitting over Sort's Skip and Undo on a small phone until it's dismissed. A second apply replaces
 * it rather than stacking over the page. Without the sentence, a plain toast as before.
 */
export const ruleToastOptions = ({ snapshot }: RuleApplied) =>
	snapshot ? { tone: "success" as const, duration: 10_000, id: "rule-snapshot" } : undefined;

/**
 * After an apply that took a snapshot, this Parent's snapshot history refetches, as it does after
 * taking one by hand. The other Parent's does through the Household's live updates ("snapshots").
 */
export function refetchSnapshotsAfterApply(queryClient: QueryClient, applied: RuleApplied) {
	if (applied.snapshot) void queryClient.invalidateQueries({ queryKey: snapshotsKey });
}

/**
 * "Always file <merchant> in <Bucket>": states a Rule and files the rest of the stack's cards it
 * matches, which leave the stack at once.
 */
export function useSaveRule() {
	const queryClient = useQueryClient();
	const save = useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		mutationFn: (rule: RuleInput & { bucketName: string }) =>
			saveRule({
				data: {
					ruleId: rule.ruleId,
					pattern: rule.pattern,
					bucketId: rule.bucketId,
					commitmentId: rule.commitmentId ?? null,
					forMemberIds: rule.forMemberIds,
					apply: true,
				},
			}),
		onMutate: async (rule) => {
			const matches = [{ pattern: merchantKey(rule.pattern), bucketId: rule.bucketId }];
			return { putBack: await takeCards(queryClient, (item) => !!ruleFor(matches, item.merchant)) };
		},
		onError: (_error, rule, context) => {
			context?.putBack();
			toast(`Couldn’t save the Rule for ${rule.pattern}.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => save.mutate(rule) },
			});
		},
		onSuccess: (applied, rule) => {
			toast(ruleSavedMessage(applied, rule), ruleToastOptions(applied));
			refetchSnapshotsAfterApply(queryClient, applied);
		},
		onSettled: () =>
			Promise.all([
				refetchAfterChange(queryClient),
				queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
			]),
	});
	return save;
}

/** Changes a Rule's pattern, Bucket, and For, in the Rules list at once. */
export function useEditRule() {
	const queryClient = useQueryClient();
	const { queryKey } = rulesQuery();
	const edit = useMutation({
		mutationFn: (rule: RuleInput & { bucketName: string }) =>
			editRule({
				data: {
					ruleId: rule.ruleId,
					pattern: rule.pattern,
					bucketId: rule.bucketId,
					commitmentId: rule.commitmentId ?? null,
					forMemberIds: rule.forMemberIds,
				},
			}),
		onMutate: async (rule) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) {
				queryClient.setQueryData(
					queryKey,
					previous.map((row) =>
						row.id === rule.ruleId
							? {
									...row,
									pattern: merchantKey(rule.pattern),
									bucketId: rule.bucketId,
									commitmentId: rule.commitmentId ?? null,
									bucketName: rule.bucketName,
									for: rule.forMemberIds,
								}
							: row,
					),
				);
			}
			return { previous };
		},
		onError: (error, rule, context) => {
			if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
			toast(
				error.message.startsWith("There’s already")
					? error.message
					: `Couldn’t save the Rule for ${rule.pattern}, so it’s been undone.`,
				{ tone: "error", action: { label: "Retry", onClick: () => edit.mutate(rule) } },
			);
		},
		onSuccess: () => toast("Rule saved"),
		onSettled: () => queryClient.invalidateQueries({ queryKey }),
	});
	return edit;
}

/** Deletes a Rule, from the list at once. What it filed stays where it is. */
export function useDeleteRule() {
	const queryClient = useQueryClient();
	const { queryKey } = rulesQuery();
	const remove = useMutation({
		mutationFn: (rule: RuleRow) => deleteRule({ data: { ruleId: rule.id } }),
		onMutate: async (rule) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) {
				queryClient.setQueryData(
					queryKey,
					previous.filter((row) => row.id !== rule.id),
				);
			}
			return { previous };
		},
		onError: (_error, rule, context) => {
			if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
			toast(`Couldn’t delete the Rule for ${rule.pattern}, so it’s back.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => remove.mutate(rule) },
			});
		},
		onSuccess: (_data, rule) => toast(`Rule for ${rule.pattern} deleted`),
		onSettled: () => queryClient.invalidateQueries({ queryKey }),
	});
	return remove;
}

/** "Look again": categorizes what waits in Review once more, against the Plan as it is now. */
export function useLookAgain() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: () => lookAgainAtReview(),
		onError: () => toast("Couldn’t look again. Try again in a moment.", { tone: "error" }),
		onSuccess: ({ looked, filed, guessed }) =>
			toast(
				looked === 0
					? "Nothing of yours to look at again"
					: filed + guessed === 0
						? "Looked again: still no suggestions"
						: [
								filed > 0 ? `Filed ${filed}` : null,
								guessed > 0 ? `${guessed} with a suggestion` : null,
							]
								.filter(Boolean)
								.join(", "),
			),
		onSettled: () => refetchAfterChange(queryClient),
	});
}

/**
 * Files everything still unassigned that a Rule matches, wherever it is. Not in `reviewWrites`:
 * the server only ever files a Transaction that is still unassigned when it writes, so an apply
 * that crosses a decision can't take it back.
 */
export function useApplyRule() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: (rule: RuleRow) => applyRule({ data: { ruleId: rule.id } }),
		onError: (_error, rule) =>
			toast(`Couldn’t file what matches ${rule.pattern}. Try again in a moment.`, {
				tone: "error",
			}),
		onSuccess: (applied, rule) => {
			toast(ruleAppliedMessage(applied, rule), ruleToastOptions(applied));
			refetchSnapshotsAfterApply(queryClient, applied);
		},
		onSettled: () =>
			Promise.all([
				refetchAfterChange(queryClient),
				queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
			]),
	});
}
