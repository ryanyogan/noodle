import { monthOfDay } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { toast } from "@noodle/ui/components/toast";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { formatMoney } from "../format";
import { type MoneyInLine, useAlwaysWhosePay, useMoneyInEdit } from "../money-in";
import { membersQuery } from "../queries";

// Whose pay a line of Income is, said where its kind is said (Transactions, Review; issue 133,
// ADR-0057): a Parent or the Household, and the offer to remember its sender as that Parent's pay.

type Parent = { id: string; name: string };

/** The Parents, for "whose pay". */
export function useParents(): Parent[] {
	const { data } = useQuery(membersQuery());
	return (data ?? []).filter((member) => member.kind === "parent");
}

/**
 * Under a line marked Income: whose pay it is, and, once a Parent is picked, "Always treat
 * deposits from <name> as <Parent>'s pay?". `onDone` is called when the Rule is stated or declined.
 */
export function WhosePayOffer({ line, onDone }: { line: MoneyInLine; onDone?: () => void }) {
	const id = useId();
	const parents = useParents();
	const edit = useMoneyInEdit();
	const always = useAlwaysWhosePay();
	// What was said here, until the list has it; and the line as the server answered it.
	const [said, setSaid] = useState<{ whosePay: string | null; line: MoneyInLine } | null>(null);
	const [offering, setOffering] = useState(false);
	if (parents.length === 0) return null;
	const whose = said ? said.whosePay : line.whosePay;
	const parent = parents.find((one) => one.id === whose);
	const wording = line.note?.trim();
	const set = (whosePay: string | null) => {
		if (whosePay === whose) return;
		edit.mutate(
			{ line: said?.line ?? line, edit: { whosePay }, month: monthOfDay(line.date) },
			{
				onSuccess: (saved) => {
					setSaid({ whosePay, line: saved });
					setOffering(whosePay !== null);
					const who = parents.find((one) => one.id === whosePay)?.name;
					toast(
						who
							? `${formatMoney(saved.amount)} is ${who}’s pay`
							: `${formatMoney(saved.amount)} is the Household’s`,
						{ tone: "success" },
					);
				},
			},
		);
	};
	const remember = () => {
		if (!parent) return;
		always.mutate(
			{ line: said?.line ?? line, payMemberId: parent.id },
			{
				onSuccess: (stated) => {
					if (!stated) return;
					setOffering(false);
					toast(
						stated.changed > 0
							? `Deposits from ${wording} are ${parent.name}’s pay from now on, and ${stated.changed} already here ${stated.changed === 1 ? "is" : "are"} too`
							: `Deposits from ${wording} are ${parent.name}’s pay from now on`,
						{ tone: "success" },
					);
					onDone?.();
				},
			},
		);
	};
	return (
		<div className="grid gap-2" data-testid="whose-pay-offer">
			<p id={`${id}-q`} className="text-sm text-muted-foreground">
				Whose pay is it?
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this grid. */}
			<div role="group" aria-labelledby={`${id}-q`} className="flex flex-wrap gap-2">
				{[...parents, { id: null, name: "The Household" }].map((who) => (
					<Button
						key={who.id ?? "household"}
						type="button"
						size="sm"
						variant={who.id === whose ? "default" : "outline"}
						aria-pressed={who.id === whose}
						disabled={edit.isPending}
						onClick={() => set(who.id)}
					>
						{who.name}
					</Button>
				))}
			</div>
			{offering && parent && wording ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="min-w-0 text-sm break-words">
						Always treat deposits from {wording} as {parent.name}’s pay?
					</p>
					<Button type="button" size="sm" disabled={always.isPending} onClick={remember}>
						Yes, always
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => {
							setOffering(false);
							onDone?.();
						}}
					>
						Not now
					</Button>
				</div>
			) : null}
		</div>
	);
}
