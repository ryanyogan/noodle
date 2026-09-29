import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ulid } from "ulid";
import { formatMoney, shortDay } from "../format";
import { matchQuery, useMatchChange } from "../matches";
import type { MatchPeer } from "../server/matches";
import type { TransactionRow } from "../transactions";

/**
 * A Transaction's Match in its detail: a Quick Add's bank copy (with Unmatch), or, while it's
 * unmatched, what it might be Matched with. Shows nothing when there's neither.
 */
export function MatchSection({
	transaction,
	onDone,
}: {
	transaction: TransactionRow;
	/** Called once a Match or unmatch is sent: the row may leave the list. */
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	const { data } = useQuery(matchQuery(transaction));
	const change = useMatchChange();
	if (!data || data.kind === "none") return null;
	if (data.kind === "unmatched" && data.possible.length === 0) return null;
	const isQuickAdd = transaction.importedFrom === null;
	const label = transaction.note || (isQuickAdd ? "Quick Add" : "Transaction");

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
					{differs ? ` The bank shows ${formatMoney(peer.amountCents)}.` : ""}
				</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					disabled={!hydrated}
					onClick={() => {
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
					: "Is this the bank’s copy of a Quick Add? Matching counts it once, as the Quick Add."}
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
								aria-label={`Match with ${peer.note || "Quick Add"}, ${formatMoney(peer.amountCents)}, ${shortDay(peer.date)}`}
								onClick={() => {
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

/** The other side of a Match: what it says, where and when, and its amount. */
function PeerRow({ peer, action }: { peer: MatchPeer; action?: React.ReactNode }) {
	return (
		<ListRow
			title={peer.note || (peer.account ? "Imported" : "Quick Add")}
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
