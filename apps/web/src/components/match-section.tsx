import type { DayKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ulid } from "ulid";
import { formatMoney, shortDay } from "../format";
import { matchQuery, useMatchChange } from "../matches";
import type { MatchPeer } from "../server/matches";
import type { TransactionRow } from "../transactions";
import { TermHelp } from "./term-help";
import { useBringsSpendingIn, waitingForBank } from "./transaction-list";

/**
 * A Transaction's Match in its detail: a Quick Add's bank copy (with Unmatch), or, while it's
 * unmatched, what it might be Matched with. Shows nothing when there's neither.
 */
export function MatchSection({
	transaction,
	beforeChange = () => true,
	onDone,
	today,
}: {
	transaction: TransactionRow;
	/**
	 * Runs before a Match or unmatch is sent, so the editor saves what was typed with it; false
	 * when that can't be saved yet, and nothing is sent.
	 */
	beforeChange?: () => boolean;
	/** Called once a Match or unmatch is sent: the row may leave the list. */
	onDone: () => void;
	/** The Household's today: with it, a Quick Add still waiting for its bank copy says so. */
	today?: DayKey;
}) {
	const hydrated = useHydrated();
	const bringsIn = useBringsSpendingIn();
	const { data } = useQuery(matchQuery(transaction));
	const change = useMatchChange();
	if (!data || data.kind === "none") return null;
	const isQuickAdd = transaction.importedFrom === null;
	if (data.kind === "unmatched" && data.possible.length === 0) {
		if (!today || !waitingForBank(transaction, today, bringsIn)) return null;
		return (
			<section aria-labelledby="match-heading" className="grid gap-2">
				<h3 id="match-heading" className="text-xs font-medium text-subtle-foreground">
					Waiting for bank
				</h3>
				<p className="text-[13px] text-muted-foreground">
					When the bank's copy comes in, Noodle Matches it with this Quick Add so it counts once.{" "}
					<TermHelp term="match" />
				</p>
			</section>
		);
	}
	const label =
		transaction.merchantName || transaction.note || (isQuickAdd ? "Quick Add" : "Transaction");

	if (data.kind === "matched") {
		const { peer } = data;
		const differs = peer.amountCents !== transaction.amountCents;
		return (
			<section aria-labelledby="match-heading" className="grid gap-2">
				<h3 id="match-heading" className="text-xs font-medium text-subtle-foreground">
					{isQuickAdd ? "Bank copy" : "Quick Add"}
				</h3>
				<List>
					<PeerRow peer={peer} />
				</List>
				<p className="text-[13px] text-muted-foreground">
					{data.automatic ? "Matched automatically" : "Matched"}, so it counts once, as this Quick
					Add.
					{differs ? ` The bank shows ${formatMoney(peer.amountCents)}.` : ""}{" "}
					<TermHelp term="match" />
				</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					disabled={!hydrated}
					onClick={() => {
						if (!beforeChange()) return;
						change.mutate({ kind: "unmatch", matchId: data.matchId, label });
						onDone();
					}}
				>
					Unmatch
				</Button>
			</section>
		);
	}

	return (
		<section aria-labelledby="match-heading" className="grid gap-2">
			<h3 id="match-heading" className="text-xs font-medium text-subtle-foreground">
				Possible match
			</h3>
			<p className="text-[13px] text-muted-foreground">
				{isQuickAdd
					? "Is one of these the bank’s copy? Matching counts it once, as this Quick Add."
					: "Is this the bank’s copy of a Quick Add? Matching counts it once, as the Quick Add."}{" "}
				<TermHelp term="match" />
			</p>
			<List>
				{data.possible.map((peer) => (
					<PeerRow
						key={peer.id}
						peer={peer}
						action={
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={!hydrated}
								aria-label={`Match with ${peer.merchantName || peer.note || "Quick Add"}, ${formatMoney(peer.amountCents)}, ${shortDay(peer.date)}`}
								onClick={() => {
									if (!beforeChange()) return;
									change.mutate({
										kind: "match",
										matchId: ulid(),
										quickAddId: isQuickAdd ? transaction.id : peer.id,
										importedId: isQuickAdd ? peer.id : transaction.id,
										label,
									});
									onDone();
								}}
							>
								Match
							</Button>
						}
					/>
				))}
			</List>
		</section>
	);
}

/**
 * On a Review card: the Quick Adds this bank line might be the copy of (possibleMatches), each
 * with Match, so a copy whose amount differs (a tip) isn't filed as a second spend. Matching takes
 * it out of Review. Shows nothing when there's none.
 */
export function ReviewMatchOffer({ transaction }: { transaction: { id: string; date: string } }) {
	const hydrated = useHydrated();
	const { data } = useQuery(matchQuery(transaction));
	const change = useMatchChange();
	if (data?.kind !== "unmatched" || data.possible.length === 0) return null;
	const [only] = data.possible;
	const name = (peer: MatchPeer) => {
		const called = peer.merchantName || peer.note;
		return called ? `“${called}”` : "";
	};
	return (
		<section
			aria-labelledby="review-match-heading"
			className="grid gap-2 rounded-2xl bg-surface-2 p-3 text-sm"
		>
			<h3 id="review-match-heading" className="font-medium">
				{data.possible.length === 1 && only
					? `Is this your Quick Add ${name(only)} (${formatMoney(only.amountCents)}, ${shortDay(only.date)})?`
					: "Is this one of your Quick Adds?"}
			</h3>
			<p className="text-[13px] text-muted-foreground">
				Matching counts it once, as the Quick Add, and takes it out of Review.
			</p>
			<List>
				{data.possible.map((peer) => (
					<PeerRow
						key={peer.id}
						peer={peer}
						action={
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={!hydrated || change.isPending}
								aria-label={`Match with ${peer.merchantName || peer.note || "Quick Add"}, ${formatMoney(peer.amountCents)}, ${shortDay(peer.date)}`}
								onClick={() =>
									change.mutate({
										kind: "match",
										matchId: ulid(),
										quickAddId: peer.id,
										importedId: transaction.id,
										label: peer.merchantName || peer.note || "Quick Add",
									})
								}
							>
								Match
							</Button>
						}
					/>
				))}
			</List>
		</section>
	);
}

/** The other side of a Match: what it says, where and when, and its amount. */
function PeerRow({ peer, action }: { peer: MatchPeer; action?: React.ReactNode }) {
	return (
		<ListRow
			title={peer.merchantName || peer.note || (peer.account ? "Imported" : "Quick Add")}
			meta={[peer.account ?? "Quick Add", shortDay(peer.date)].join(" · ")}
			trailing={
				<div className="flex items-center gap-3">
					<span className="text-sm font-semibold tabular-nums">
						{formatMoney(peer.amountCents)}
					</span>
					{action}
				</div>
			}
		/>
	);
}
