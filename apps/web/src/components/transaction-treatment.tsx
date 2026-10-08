import { looksLikeCardPayment, looksPersonToPerson, parentNamedIn } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Combobox } from "@noodle/ui/components/combobox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { Field } from "@noodle/ui/components/field";
import { RowButton } from "@noodle/ui/components/row-button";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	ChevronDown,
	CreditCard,
	ReceiptText,
	Sparkles,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import {
	cardPaymentCardsQuery,
	onCardPaymentAsked,
	takeAskedCardPayment,
	useCardPaymentFiling,
} from "../card-payments";
import { formatMoney } from "../format";
import { membersQuery } from "../queries";
import type { ReviewItem } from "../review";
import { nameOf, type TransactionRow } from "../transactions";
import { useMoneyChange } from "../transfers";
import { CardPaymentQuestion } from "./card-payment";
import { betweenUsMeans, lowerFirst, parentNames, TRANSFER_MEANS } from "./review-between-us";

type Mode = "default" | "payment" | "transfer" | "between-us";

/**
 * What each choice means, said where it is chosen (issue 147), in CONTEXT.md's words. The names
 * are the ones specs and the glossary use; the line under each tells them apart. A Transfer is
 * told from Between us by what the money moved between: Accounts, or the two Parents, who are
 * named where their names are known (issue 152).
 */
const types = (
	names: readonly string[],
): Record<Exclude<Mode, "default">, { name: string; means: string; icon: typeof Sparkles }> => ({
	payment: {
		name: "Credit card payment",
		means: "Paying a card’s bill. What was bought on the card is already counted.",
		icon: CreditCard,
	},
	transfer: {
		name: "Transfer",
		means: `${TRANSFER_MEANS} It isn’t spending.`,
		icon: ArrowLeftRight,
	},
	"between-us": {
		name: "Between us",
		means: `${betweenUsMeans(names)}. It isn’t Income or spending.`,
		icon: Users,
	},
});

const DEFAULTS = {
	Spending: { means: "It counts in a Bucket or a Commitment.", icon: ReceiptText },
	Suggested: { means: "File it where Noodle suggests, or choose a Bucket.", icon: Sparkles },
};

/** The word on Review's menu button for the choice made. */
const SHORT: Record<Mode, string> = {
	default: "Suggested",
	payment: "Card payment",
	transfer: "Transfer",
	"between-us": "Between us",
};

/**
 * What the bank's wording suggests for money out, said once under the tiles: the tile to press if
 * it is so. Only ever a tile that is offered; nothing when the wording says nothing.
 */
function wordingHint(
	transaction: TransactionRow,
	names: readonly string[],
	offered: readonly Mode[],
): string | null {
	if (transaction.amountCents <= 0) return null;
	const text = transaction.note || transaction.merchantName;
	if (looksLikeCardPayment(text))
		return "Looks like a card payment. If it is, choose Credit card payment.";
	if (!offered.includes("between-us")) return null;
	const named = parentNamedIn(text, names);
	if (named) return `Looks like money sent to ${named}. If it is, choose Between us.`;
	if (looksPersonToPerson(text))
		return "Looks like money sent to a person. If it went to the other Parent, choose Between us.";
	return null;
}

/** Page-local treatment switch. A payment is available even after a mistaken Bucket filing. */
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
	renderHeader?: (choices: ReactNode, mode: Mode) => ReactNode;
}) {
	const hydrated = useHydrated();
	// The row's own "It’s a card payment" may have asked already (askCardPayment): the tiles then
	// open on Credit card payment, at "Payment to". Review's cards ask in their own way.
	const [mode, setMode] = useState<Mode>(() =>
		!renderHeader && takeAskedCardPayment(transaction.id) ? "payment" : "default",
	);
	useEffect(() => {
		if (renderHeader) return;
		return onCardPaymentAsked(transaction.id, () => setMode("payment"));
	}, [transaction.id, renderHeader]);
	const payment = mode === "payment";
	function choose(next: Mode) {
		setMode(next);
		onModeChange?.(next !== "default");
	}
	const [cardId, setCardId] = useState("");
	const id = useId();
	const cards = useQuery({ ...cardPaymentCardsQuery(), enabled: payment });
	// The Parents' names, for Between us and for the tiles' reading of the bank's wording.
	const { data: members } = useQuery(membersQuery());
	const names = parentNames(members ?? []);
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
				{renderHeader?.(null, "default")}
				{children}
			</>
		);
	// Transfer and Between us only while it is in no Bucket and no Commitment.
	const offered: Mode[] = [
		"default",
		"payment",
		...(!transaction.bucketId && !transaction.commitmentId
			? (["transfer", "between-us"] as const)
			: []),
	];
	const typeOf = (kind: Mode) =>
		kind === "default" ? { name: defaultLabel, ...DEFAULTS[defaultLabel] } : types(names)[kind];
	const hint =
		!renderHeader && mode === "default" ? wordingHint(transaction, names, offered) : null;
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
								aria-label={`Transaction type: ${SHORT[mode]}`}
								className="gap-1 px-2 text-xs"
							>
								<span>{SHORT[mode]}</span>
								<ChevronDown className="size-3" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" aria-label="Transaction type" className="w-72">
							{offered.map((kind) => {
								const { name, means, icon: Icon } = typeOf(kind);
								return (
									<DropdownMenuItem
										key={kind}
										// Named by its first line alone; the second says what it means.
										aria-labelledby={`${id}-${kind}-name`}
										aria-describedby={`${id}-${kind}-means`}
										className="items-start"
										onSelect={() => choose(kind)}
									>
										<Icon className="mt-0.5" />
										<span className="grid min-w-0 gap-0.5">
											<span id={`${id}-${kind}-name`} className="font-medium">
												{name}
											</span>
											<span id={`${id}-${kind}-means`} className="text-xs text-muted-foreground">
												{means}
											</span>
										</span>
									</DropdownMenuItem>
								);
							})}
						</DropdownMenuContent>
					</DropdownMenu>,
					mode,
				)
			) : (
				<fieldset
					aria-label="Transaction type"
					// Two across in a sheet or a narrow pane; all on one line once the row is wide.
					className="grid grid-cols-2 gap-2 @3xl:grid-cols-4"
				>
					{offered.map((kind) => {
						const { name, means, icon: Icon } = typeOf(kind);
						return (
							<RowButton
								key={kind}
								type="button"
								variant="tile"
								aria-pressed={mode === kind}
								aria-labelledby={`${id}-${kind}-name`}
								aria-describedby={`${id}-${kind}-means`}
								disabled={busy}
								onClick={() => choose(kind)}
								className="flex items-start gap-2.5 text-left disabled:opacity-60 aria-pressed:border-ring aria-pressed:bg-brand-soft"
							>
								<Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span className="grid min-w-0 gap-0.5">
									<span id={`${id}-${kind}-name`} className="text-sm font-medium text-foreground">
										{name}
									</span>
									<span id={`${id}-${kind}-means`} className="text-xs text-muted-foreground">
										{means}
									</span>
								</span>
							</RowButton>
						);
					})}
				</fieldset>
			)}
			{hint ? (
				<p data-slot="type-hint" className="text-[13px] text-muted-foreground">
					{hint}
				</p>
			) : null}
			{/* Keep unsaved spending fields intact if the Parent switches back. */}
			<div hidden={mode !== "default"}>{children}</div>
			{mode === "transfer" || mode === "between-us" ? (
				<div className="grid max-w-xl gap-4">
					<p className="text-sm text-muted-foreground">
						{mode === "transfer"
							? "Marked as a Transfer, it counts nowhere: it is your own money moving between your Accounts, like checking to savings, not spending in a Bucket."
							: `Marked as between us, it counts nowhere: it is ${lowerFirst(betweenUsMeans(names))}, not Income and not spending.`}
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
						Choose the card this {formatMoney(transaction.amountCents)} pays. Cards you keep by hand
						are included.
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
								<p className="text-sm text-muted-foreground">
									{card.commitment
										? `This payment will be filed in ${card.commitment.name}, which pays down ${card.name}.`
										: `This becomes a Transfer to ${card.name}, so it won’t count as spending in a Bucket.`}{" "}
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
