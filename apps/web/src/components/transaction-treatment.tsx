import { Button } from "@noodle/ui/components/button";
import { Combobox } from "@noodle/ui/components/combobox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { Field } from "@noodle/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ArrowLeftRight, ChevronDown, CreditCard, ReceiptText, Sparkles } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { cardPaymentCardsQuery, useCardPaymentFiling } from "../card-payments";
import { formatMoney } from "../format";
import type { ReviewItem } from "../review";
import { nameOf, type TransactionRow } from "../transactions";
import { useMoneyChange } from "../transfers";
import { CardPaymentQuestion } from "./card-payment";

/** Page-local treatment switch. A payment is available even after a mistaken bucket filing. */
export function TransactionTreatment({
	transaction,
	onDone,
	children,
	defaultLabel = "Spending",
	onModeChange,
	review,
	renderHeader,
}: {
	transaction: TransactionRow;
	onDone: () => void;
	children: ReactNode;
	defaultLabel?: "Spending" | "Suggested";
	onModeChange?: (alternative: boolean) => void;
	review?: Pick<ReviewItem, "merchant" | "guess" | "for">;
	/** Review puts a compact type menu beside the amount in its header. */
	renderHeader?: (choices: ReactNode) => ReactNode;
}) {
	const hydrated = useHydrated();
	const [mode, setMode] = useState<"default" | "payment" | "transfer" | "between-us">("default");
	const payment = mode === "payment";
	function choose(next: typeof mode) {
		setMode(next);
		onModeChange?.(next !== "default");
	}
	const [cardId, setCardId] = useState("");
	const id = useId();
	const cards = useQuery({ ...cardPaymentCardsQuery(), enabled: payment });
	const mark = useMoneyChange();
	const file = useCardPaymentFiling();
	const busy = !hydrated || mark.isPending || file.isPending;
	const card = cards.data?.find((item) => item.id === cardId);
	const label = nameOf(transaction) || "Transaction";
	async function save() {
		if (!card || busy) return;
		try {
			if (card.commitment) {
				const result = await file.mutateAsync({
					transactionId: transaction.id,
					ruleId: ulid(),
					label,
					commitment: card.commitment,
					review,
				});
				if (result.ok && !result.stays) onDone();
			} else {
				const result = await mark.mutateAsync({
					kind: "mark",
					transferId: ulid(),
					transactionId: transaction.id,
					label,
					card: { id: card.id, name: card.name, ruleId: ulid() },
				});
				if (result.ok) onDone();
			}
		} catch {
			// The mutation explains the failure and leaves this choice available to retry.
		}
	}
	if (!transaction.importedFrom || transaction.splits.length > 0)
		return (
			<>
				{renderHeader?.(null)}
				{children}
			</>
		);
	return (
		<div
			// Its rows shrink with the card: a long button wraps rather than widening it.
			className="grid min-w-0 gap-3 *:min-w-0 compact:gap-1.5 squat:gap-1 sm:gap-4"
			data-payment-mode={payment || undefined}
		>
			{renderHeader ? (
				renderHeader(
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								disabled={busy}
								aria-label={`Transaction type: ${mode === "default" ? "Suggested" : mode === "payment" ? "Card payment" : mode === "transfer" ? "Transfer" : "Between us"}`}
								className="gap-1 px-2 text-xs"
							>
								<span>
									{mode === "default"
										? "Suggested"
										: mode === "payment"
											? "Card payment"
											: mode === "transfer"
												? "Transfer"
												: "Between us"}
								</span>
								<ChevronDown className="size-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" aria-label="Transaction type">
							<DropdownMenuItem onSelect={() => choose("default")}>
								<Sparkles />
								Suggested
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => choose("payment")}>
								<CreditCard />
								Credit card payment
							</DropdownMenuItem>
							{!transaction.bucketId && !transaction.commitmentId ? (
								<>
									<DropdownMenuItem onSelect={() => choose("transfer")}>
										<ArrowLeftRight />
										Transfer
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => choose("between-us")}>
										<ArrowLeftRight />
										Between us
									</DropdownMenuItem>
								</>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>,
				)
			) : (
				<fieldset
					aria-label="Transaction type"
					className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1 justify-self-start"
				>
					<Button
						type="button"
						size="sm"
						variant={mode === "default" ? "secondary" : "ghost"}
						aria-pressed={mode === "default"}
						disabled={busy}
						onClick={() => choose("default")}
					>
						{defaultLabel === "Suggested" ? <Sparkles /> : <ReceiptText />}
						{defaultLabel}
					</Button>
					<Button
						type="button"
						size="sm"
						variant={payment ? "secondary" : "ghost"}
						aria-pressed={payment}
						disabled={busy}
						onClick={() => choose("payment")}
					>
						<CreditCard />
						Credit card payment
					</Button>
					{(!transaction.bucketId && !transaction.commitmentId
						? (["transfer", "between-us"] as const)
						: []
					).map((kind) => (
						<Button
							key={kind}
							type="button"
							size="sm"
							variant={mode === kind ? "secondary" : "ghost"}
							aria-pressed={mode === kind}
							disabled={busy}
							onClick={() => choose(kind)}
						>
							<ArrowLeftRight />
							{kind === "transfer" ? "Transfer" : "Between us"}
						</Button>
					))}
				</fieldset>
			)}
			{/* Keep unsaved spending fields intact if the Parent switches back. */}
			<div hidden={mode !== "default"}>{children}</div>
			{mode === "transfer" || mode === "between-us" ? (
				<div className="grid gap-3 rounded-xl border border-border bg-surface-2 p-4">
					<p className="text-sm text-muted-foreground">
						{mode === "transfer"
							? "Money moving between accounts. It won’t count as spending in a bucket."
							: "Money sent to the other parent. It won’t count as household spending."}
					</p>
					<Button
						type="button"
						className="justify-self-start"
						disabled={busy}
						onClick={() =>
							void mark
								.mutateAsync({
									kind: "mark",
									transferId: ulid(),
									transactionId: transaction.id,
									label,
									...(mode === "between-us" ? { reason: "between-us" as const } : {}),
								})
								.then((result) => {
									if (result.ok) onDone();
								})
								.catch(() => undefined)
						}
					>
						{busy ? "Saving…" : mode === "transfer" ? "Mark as Transfer" : "It’s between us"}
					</Button>
				</div>
			) : null}
			{payment ? (
				<div className="grid max-w-xl gap-4">
					<p className="text-sm text-muted-foreground">
						Link the saved {formatMoney(transaction.amountCents)} transaction to the card it pays.
						Cards you keep manually are included.
					</p>
					{cards.isError ? (
						<div role="alert" className="text-sm">
							Couldn’t load your cards.{" "}
							<Button type="button" variant="ghost" size="sm" onClick={() => void cards.refetch()}>
								Try again
							</Button>
						</div>
					) : (
						<Field label="Payment to" htmlFor={id}>
							<Combobox
								id={id}
								value={cardId}
								onValueChange={setCardId}
								disabled={cards.isPending || busy}
								placeholder={cards.isPending ? "Loading cards…" : "Choose a credit card"}
								searchPlaceholder="Search your cards…"
								choices={[
									...(cards.data ?? []).map((item) => ({ value: item.id, label: item.name })),
									{ value: "other", label: "A card that isn’t in Noodle" },
								]}
							/>
						</Field>
					)}
					{cardId === "other" ? (
						<CardPaymentQuestion
							transaction={transaction}
							label={label}
							onDone={onDone}
							onCancel={() => setCardId("")}
							initialStep="spending"
							filing={{ review }}
						/>
					) : (
						<>
							{card ? (
								<p className="rounded-xl bg-card p-3 text-sm text-muted-foreground">
									{card.commitment
										? `This payment will be filed in ${card.commitment.name}, which pays down ${card.name}.`
										: `This becomes a transfer to ${card.name}, so it won’t count as spending in a bucket.`}{" "}
									Payments with the same bank wording will be remembered too.
								</p>
							) : null}
							<div className="flex gap-2">
								<Button type="button" disabled={!card || busy} onClick={() => void save()}>
									{busy ? "Saving…" : "Link payment"}
								</Button>
								<Button
									type="button"
									variant="ghost"
									disabled={busy}
									onClick={() => choose("default")}
								>
									Back to {defaultLabel.toLowerCase()}
								</Button>
							</div>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
