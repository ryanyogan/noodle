import { MONEY_IN_KIND_LABELS } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
	type MoneyInLine,
	moneyInAccountsQuery,
	moneyInRulesQuery,
	useRememberAccountPair,
	useRemoveMoneyInRule,
} from "../money-in";

// Rules for money in (issue 131, ADR-0057): wording that is always one kind, and remembered pairs
// of Accounts ("money from Gusto into Chase is always a Transfer").

/**
 * Under a Transfer seen from one side only: which of the Household's other Accounts it came from,
 * and the offer to always treat money like it that way.
 */
export function AccountPairOffer({ line }: { line: MoneyInLine }) {
	const id = useId();
	const accounts = useQuery(moneyInAccountsQuery()).data ?? [];
	const remember = useRememberAccountPair();
	const [from, setFrom] = useState<string | null>(null);
	const into = accounts.find((account) => account.id === line.accountId);
	const others = accounts.filter((account) => account.id !== line.accountId);
	if (!into || others.length === 0) return null;
	const picked = others.find((account) => account.id === from);
	return (
		<div className="grid gap-2" data-testid="account-pair-offer">
			<p id={`${id}-q`} className="text-sm text-muted-foreground">
				Did it come from another of your Accounts?
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this grid. */}
			<div role="group" aria-labelledby={`${id}-q`} className="flex flex-wrap gap-2">
				{others.map((account) => (
					<Button
						key={account.id}
						type="button"
						size="sm"
						variant={account.id === from ? "default" : "outline"}
						aria-pressed={account.id === from}
						onClick={() => setFrom(account.id === from ? null : account.id)}
					>
						{account.name}
					</Button>
				))}
			</div>
			{picked ? (
				<div className="flex flex-wrap items-center gap-2">
					<p className="text-sm">
						Always treat money from {picked.name} into {into.name} as a Transfer?
					</p>
					<Button
						type="button"
						size="sm"
						disabled={remember.isPending}
						onClick={() =>
							remember.mutate({
								line,
								otherAccountId: picked.id,
								names: `from ${picked.name} into ${into.name}`,
							})
						}
					>
						Yes, always
					</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => setFrom(null)}>
						Not now
					</Button>
				</div>
			) : null}
		</div>
	);
}

/** The Rules page: the Rules for money in, each removable. Nothing when there are none. */
export function MoneyInRules() {
	const id = useId();
	const rules = useQuery(moneyInRulesQuery()).data ?? [];
	const remove = useRemoveMoneyInRule();
	if (rules.length === 0) return null;
	return (
		<Section aria-labelledby={id} data-testid="money-in-rules">
			<SectionHeader id={id} title="Rules for money in" count={rules.length} />
			<List>
				{rules.map((rule) => (
					<ListRow
						key={rule.id}
						data-testid="money-in-rule"
						title={`“${rule.pattern}”`}
						meta={
							<span>
								{rule.otherAccountName && rule.intoAccountName
									? `Always a Transfer from ${rule.otherAccountName} into ${rule.intoAccountName}`
									: `Always ${MONEY_IN_KIND_LABELS[rule.kind]}`}
							</span>
						}
						trailing={
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={remove.isPending}
								aria-label={`Remove the Rule for ${rule.pattern}`}
								onClick={() => remove.mutate(rule.id)}
							>
								Remove
							</Button>
						}
					/>
				))}
			</List>
		</Section>
	);
}
