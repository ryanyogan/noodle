/**
 * The app's side of the outbox (outbox.ts, ADR-0056): which changes are written down until the
 * server answers, and how one left by an earlier page is sent again.
 *
 * They are the writes that wait their turn (`reviewWrites`) and say which version of the
 * Transaction they were made on, or touch only what still waits in Review: a Transaction's edit,
 * split, rename or delete, a Review card's decision or several at once, an Undo back into Review,
 * and filing without a Bucket. Each is sent again by the very function its screen uses, in the
 * same queue, with the version written down for it (ADR-0041): a repeat of one that did land is
 * answered "saved", and one made on something that has since changed is left alone and said the
 * usual way.
 *
 * A Rule stated from a card is one of them too, though it names no version: the server takes
 * each `ruleId` once (rules.ts `stateRule`), so a repeat of one that landed changes nothing, and
 * one that never landed is made only where the merchant has had no Rule made since.
 */
import { toast } from "@noodle/ui/components/toast";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { MoneyInRefused, sendMoneyInEdit, sendMoneyInKind } from "./money-in";
import { MAX_TRIES, openOutbox, type Resend, type Store, type Waiting, type Who } from "./outbox";
import { monthChangeKey } from "./plan-changes";
import {
	RuleMadeSince,
	sendDecision,
	sendDecisions,
	sendFileWithoutBucket,
	sendReturnToReview,
	sendRuleAgain,
} from "./review";
import { reviewWrites } from "./review-stack";
import { ChangedElsewhere, carryVersions, leftAsTheyAre } from "./transaction-versions";
import {
	MonthEnded,
	refetchAfterChange,
	saveTransactionChange,
	sayChangedElsewhere,
} from "./transactions";

/** By the `meta.outbox` its mutation says: how each kind is sent. */
const senders: Record<string, (variables: never) => Promise<unknown>> = {
	change: saveTransactionChange,
	decision: sendDecision,
	decisions: sendDecisions,
	"file-without-bucket": sendFileWithoutBucket,
	"return-to-review": sendReturnToReview,
	// An edit of a money-in line (whose pay, note, amount, date): made on a version too (issue 133).
	"money-in-edit": sendMoneyInEdit,
	// A change of a money-in line's kind, made on a version as well. Sent again without the Rule
	// it may have stated ("…and money like it from now on"): a Rule names no version (see above).
	"money-in-kind": (change: Parameters<typeof sendMoneyInKind>[0]) =>
		sendMoneyInKind({ ...change, always: false }),
	// A Rule stated from a Review card: taken once by the ID the card made for it (issue 129).
	rule: sendRuleAgain,
};

/** The server's answer "left alone": dropped and said, never tried again. */
export const leftAlone = (error: unknown) =>
	error instanceof ChangedElsewhere ||
	error instanceof RuleMadeSince ||
	error instanceof MoneyInRefused ||
	error instanceof MonthEnded;

/** Said once when something written down was too old to send (outbox.ts, `MAX_AGE_MS`). */
export const tooOldToSave = (count: number) =>
	count === 1
		? "A change you made over a week ago was never saved, so it has been left out."
		: `${count} changes you made over a week ago were never saved, so they have been left out.`;

/** Said once when what an earlier page left has been saved. */
export const SAVED_LATER = "Saved what was still waiting when you left.";

/** The options one left waiting is sent again with; null for a kind this build doesn't know. */
export function resendWith(queryClient: QueryClient) {
	return (waiting: Waiting): Resend | null => {
		const send = senders[waiting.kind] as ((variables: unknown) => Promise<unknown>) | undefined;
		if (!send) return null;
		return {
			mutationKey: monthChangeKey,
			scope: reviewWrites,
			mutationFn: (variables) => send(variables),
			onSuccess: (answer) => {
				// Several cards at once: what another screen had changed was left alone and is counted.
				const skipped = (answer as { skipped?: unknown[] } | undefined)?.skipped?.length ?? 0;
				if (skipped > 0) return void toast(leftAsTheyAre(skipped));
				toast(SAVED_LATER, { tone: "success", id: "saved-later" });
			},
			onError: (error) => {
				// Changed on another screen since: left as it is there, never written over (ADR-0041).
				if (error instanceof ChangedElsewhere) return sayChangedElsewhere();
				// A Rule that never landed, and the merchant has a newer one: that one stays.
				if (error instanceof RuleMadeSince) return void toast(error.message);
				toast(
					waiting.tries + 1 < MAX_TRIES
						? "Couldn’t save a change you made earlier. Noodle will try again when you next open it."
						: "Couldn’t save a change you made earlier, so it has been left out.",
					{ tone: "error", id: "saved-later" },
				);
			},
			onSettled: () => refetchAfterChange(queryClient),
		};
	};
}

function deviceStore(): Store | null {
	try {
		return window.localStorage;
	} catch {
		// Private browsing with storage blocked: changes are sent as ever, only not written down.
		return null;
	}
}

/** A navigation that never happened (a download, a cancelled load) is forgotten after this long. */
const FORGET_MS = 10_000;
let leaving = false;
let watching = false;

/** Notes when the page is going: a request that fails from then on was cut off, not answered. */
function watchLeaving() {
	if (watching) return;
	watching = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const leave = () => {
		leaving = true;
		clearTimeout(timer);
		timer = setTimeout(() => {
			leaving = false;
		}, FORGET_MS);
	};
	window.addEventListener("beforeunload", leave);
	window.addEventListener("pagehide", leave);
	window.addEventListener("pageshow", () => {
		leaving = false;
	});
}

/**
 * Writes this Parent's waiting changes down until they are answered, and sends what an earlier
 * page left. Once, in the app's layout; it lasts as long as the page.
 */
export function useWaitingWrites({ householdId, parentId }: Who) {
	const queryClient = useQueryClient();
	useEffect(() => {
		watchLeaving();
		openOutbox({
			queryClient,
			who: { householdId, parentId },
			store: deviceStore(),
			resend: resendWith(queryClient),
			refused: leftAlone,
			leaving: () => leaving,
			carry: carryVersions,
			expired: (count) => toast(tooOldToSave(count), { tone: "error", id: "saved-too-old" }),
		});
	}, [queryClient, householdId, parentId]);
}
