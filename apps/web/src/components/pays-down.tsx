import { parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { OptionSelect } from "@noodle/ui/components/select";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type KeyboardEvent, useState } from "react";
import { ulid } from "ulid";
import { needsCarriedTick, paysDownAccounts, paysDownHint } from "../commitments";
import { formatMoney, formatMoneyInput } from "../format";
import { type AddAccountVariables, useAddAccount, withAccount } from "../goals";
import { followedCardsQuery, goalsQuery, paymentSuggestionQuery } from "../queries";
import { AmountInput } from "./goals";
import { SaveFailed } from "./plan-editing";

// What a Commitment pays down (issue 93, ADR-0050): the "Pays down" choice in the Commitment
// sheet and the add form, and the line a linked Commitment's row carries.

/** The select's last choice: opens the inline form instead of being chosen. */
const ADD = "add-card-or-loan";

/**
 * "Pays down": the credit card or loan a Commitment's payments bring down, or Nothing. Shown only
 * when the Household has a card or loan in use. Submits `paysDown` (the Account's ID, "" for
 * none), `paysDownTick` ("needed" while a card Noodle follows is chosen without the tick,
 * "ticked", or "none") and `paysDownBusy` while a card or loan added here is still saving; the
 * form reads them with readCommitment.
 */
export function PaysDownField({
	id,
	initial,
	inCard = false,
	invalid = false,
	startAdding = false,
	suggest = false,
}: {
	id: string;
	initial?: { accountId?: string | null | undefined; carriedBalance?: boolean | undefined };
	/** Opens with "Add a card or loan…" ready: the Commitment is for a card Noodle doesn't have. */
	startAdding?: boolean;
	/** Offers an amount from the last three months of payments to the card or loan chosen. */
	suggest?: boolean;
	inCard?: boolean;
	/** The form was submitted without the tick a followed card needs. */
	invalid?: boolean;
}) {
	const goals = useQuery(goalsQuery()).data;
	const followed = useQuery(followedCardsQuery()).data;
	const addAccount = useAddAccount();
	const [value, setValue] = useState(initial?.accountId ?? "");
	const [carried, setCarried] = useState(initial?.carriedBalance ?? false);
	const [adding, setAdding] = useState(startAdding);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"credit-card" | "loan">("credit-card");
	const [owed, setOwed] = useState("");
	const [tried, setTried] = useState(false);
	// The card or loan added here, until it has saved: see `add`.
	const [added, setAdded] = useState<AddAccountVariables | null>(null);
	if (!goals) return null;
	const accounts = paysDownAccounts(
		(added ? withAccount(goals, added) : goals).accounts,
		followed ?? [],
	);
	// Nothing to pay down yet: Accounts is where the first card or loan is added.
	if (accounts.length === 0 && value === "" && !adding) return null;
	const chosen = accounts.find((account) => account.id === value) ?? null;
	// One it paid down before the Account was archived still shows, by name.
	const gone =
		value !== "" && chosen === null
			? (goals.archivedAccounts.find((account) => account.id === value)?.name ?? null)
			: null;
	const needsTick = chosen !== null && needsCarriedTick(chosen);
	const owedCents = owed.trim() === "" ? null : parseDollars(owed);
	const badName = tried && name.trim() === "";
	const badOwed = tried && owed.trim() !== "" && owedCents === null;

	function add() {
		setTried(true);
		if (name.trim() === "" || (owed.trim() !== "" && owedCents === null)) return;
		const accountId = ulid();
		const before = value;
		const account = {
			accountId,
			name: name.trim(),
			kind,
			balanceCents: owedCents,
			balanceId: ulid(),
		};
		addAccount.mutate(account, {
			// Not added after all: back to what was chosen before.
			onError: () => setValue(before),
			// Saved or not, the Household's own list has the last word from here.
			onSettled: () => setAdded(null),
		});
		// It's in the list at once, and chosen. The list the Household's Accounts are read from gains
		// it a moment later, and a select told to show a choice it doesn't have yet answers by
		// choosing Nothing, so the new one is listed here in the same render that chooses it.
		setAdded(account);
		setValue(accountId);
		setCarried(false);
		setAdding(false);
		setName("");
		setOwed("");
		setTried(false);
	}

	// Enter in these fields adds the card or loan; it must not save the Commitment around them.
	const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		add();
	};

	return (
		<div className="grid min-w-0 gap-3">
			<Field
				label="Pays down"
				htmlFor={`${id}-pays-down`}
				hint={gone ? `${gone} is archived. Pick another, or Nothing.` : paysDownHint(chosen)}
			>
				<OptionSelect
					// A new list of cards and loans starts the select again with its choice already in it:
					// one that gains a choice and is moved to it at once drops back to Nothing.
					key={accounts.map((account) => account.id).join(" ")}
					id={`${id}-pays-down`}
					name="paysDown"
					value={value}
					onValueChange={(next) => {
						if (next === ADD) {
							setAdding(true);
							return;
						}
						setValue(next);
						setCarried(false);
					}}
					className={inCard ? "bg-card" : undefined}
					choices={[
						{ value: "", label: "Nothing" },
						...accounts.map((account) => ({
							value: account.id,
							label: account.name,
							hint: account.owed === null ? "No balance yet" : `${formatMoney(account.owed)} owed`,
						})),
						...(gone ? [{ value, label: gone, hint: "Archived", disabled: true }] : []),
						{ value: ADD, label: "Add a card or loan…" },
					]}
				/>
			</Field>
			{suggest && chosen ? <PaymentSuggestionLine accountId={chosen.id} /> : null}
			<Input
				type="hidden"
				readOnly
				name="paysDownTick"
				value={needsTick ? (carried ? "ticked" : "needed") : "none"}
			/>
			{addAccount.isPending ? <Input type="hidden" name="paysDownBusy" value="1" readOnly /> : null}
			{needsTick ? (
				<div className="grid min-w-0 gap-1">
					<label
						htmlFor={`${id}-carried`}
						className="flex min-h-11 min-w-0 items-center gap-3 text-sm"
					>
						<Checkbox
							id={`${id}-carried`}
							checked={carried}
							onCheckedChange={(checked) => setCarried(checked === true)}
							aria-invalid={(invalid && !carried) || undefined}
						/>
						<span className="min-w-0">This is a set payment on a balance I’m carrying</span>
					</label>
					<Link
						to="/goals"
						search={{ add: "payoff" }}
						className="inline-flex min-h-11 items-center justify-self-start text-sm font-medium underline underline-offset-3"
					>
						Plan to pay this off instead
					</Link>
				</div>
			) : null}
			{adding ? (
				// biome-ignore lint/a11y/useSemanticElements: a fieldset can't shrink inside the sheet's grid at 320px.
				<div
					role="group"
					aria-label="Add a card or loan"
					className="grid min-w-0 gap-3 rounded-lg border p-3"
				>
					<div className="grid min-w-0 gap-3 sm:grid-cols-2">
						<Field
							label="Card or loan name"
							htmlFor={`${id}-new-name`}
							error={badName ? "Give it a name, like American Express." : null}
						>
							<Input
								id={`${id}-new-name`}
								maxLength={40}
								autoComplete="off"
								value={name}
								onChange={(event) => setName(event.currentTarget.value)}
								onKeyDown={onEnter}
								aria-invalid={badName || undefined}
								aria-describedby={badName ? `${id}-new-name-error` : undefined}
							/>
						</Field>
						<Field label="Kind" htmlFor={`${id}-new-kind`}>
							<OptionSelect
								id={`${id}-new-kind`}
								value={kind}
								onValueChange={(next) => setKind(next === "loan" ? "loan" : "credit-card")}
								className={inCard ? "bg-card" : undefined}
								choices={[
									{ value: "credit-card", label: "Credit card" },
									{ value: "loan", label: "Loan" },
								]}
							/>
						</Field>
					</div>
					<Field
						label="What’s owed today (optional)"
						htmlFor={`${id}-new-owed`}
						error={
							badOwed
								? "Enter what’s owed as a dollar amount, like 2,000, or leave it empty."
								: null
						}
					>
						<AmountInput
							id={`${id}-new-owed`}
							placeholder="0"
							value={owed}
							onChange={(event) => setOwed(event.currentTarget.value)}
							onKeyDown={onEnter}
							aria-invalid={badOwed || undefined}
							aria-describedby={badOwed ? `${id}-new-owed-error` : undefined}
						/>
					</Field>
					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="secondary" size="sm" onClick={add}>
							{kind === "loan" ? "Add loan" : "Add card"}
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
							Cancel
						</Button>
					</div>
				</div>
			) : null}
			<SaveFailed change={addAccount} />
		</div>
	);
}

/** "Pays down American Express", on a linked Commitment's row. Nothing until Accounts have loaded. */
export function PaysDownNote({
	accountId,
	joined = false,
}: {
	accountId: string;
	/** On a phone from 375px wide it follows the text before it on the same line, after a dot. */
	joined?: boolean;
}) {
	const goals = useQuery(goalsQuery()).data;
	const name =
		goals?.accounts.find((account) => account.id === accountId)?.name ??
		goals?.archivedAccounts.find((account) => account.id === accountId)?.name;
	if (!name) return null;
	return (
		<span
			className={cn("basis-full text-subtle-foreground", joined && "min-[375px]:max-sm:basis-auto")}
		>
			{joined ? (
				<span aria-hidden="true" className="hidden min-[375px]:max-sm:inline">
					·{" "}
				</span>
			) : null}
			Pays down {name}
		</span>
	);
}

/**
 * "About $2,300 a month across 9 payments", with a button that puts it in the form's "Amount due":
 * what the payments to this card or loan came to over the last three full months. Nothing with
 * too little history.
 */
function PaymentSuggestionLine({ accountId }: { accountId: string }) {
	const suggestion = useQuery(paymentSuggestionQuery(accountId)).data;
	if (!suggestion) return null;
	const amount = formatMoney(suggestion.amountCents);
	return (
		<div
			data-testid="payment-suggestion"
			className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
		>
			<span className="min-w-0">
				{suggestion.exact ? "" : "About "}
				{amount} a month across {suggestion.payments} payments
			</span>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="max-lg:min-h-11"
				onClick={(event) => {
					// The form's fields are its own (uncontrolled): the amount is written straight in.
					const field = event.currentTarget.form?.elements.namedItem("amount");
					if (!(field instanceof HTMLInputElement)) return;
					field.value = formatMoneyInput(suggestion.amountCents);
					field.focus();
				}}
			>
				Use {amount}
			</Button>
		</div>
	);
}
