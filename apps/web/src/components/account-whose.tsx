import { Field } from "@noodle/ui/components/field";
import { OptionSelect } from "@noodle/ui/components/select";
import { toast } from "@noodle/ui/components/toast";
import { useHydrated, useRouteContext } from "@tanstack/react-router";
import { useId } from "react";
import { WHOSE_HOUSEHOLD, WHOSE_HOUSEHOLD_LABEL, whoseChoices } from "../account-whose";
import { type AccountView, useSetAccountWhose } from "../goals";
import { SaveFailed } from "./plan-editing";
import { useParents } from "./whose-pay";

// "Whose Account": a Parent or the Household (issue 144, ADR-0059). It only decides the group an
// Account is listed under on Accounts; both Parents see every Account either way.

/** The Parent looking at the page; "" outside the Household's pages. */
export const useViewerId = (): string =>
	useRouteContext({ strict: false, select: (context) => context.parentId }) ?? "";

/** The picker in a form: `value` is a Parent's Member id, or "" for the Household. */
export function WhoseAccountField({
	id,
	value,
	onValueChange,
	disabled,
	hint,
}: {
	id: string;
	value: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
	hint?: string;
}) {
	const choices = whoseChoices(useParents(), useViewerId());
	return (
		<Field label="Whose Account" htmlFor={id} hint={hint}>
			<OptionSelect
				id={id}
				disabled={disabled}
				value={value}
				choices={choices}
				onValueChange={onValueChange}
			/>
		</Field>
	);
}

/** On an Account's page: whose it is, saved as soon as it is chosen. */
export function AccountWhose({ account }: { account: AccountView }) {
	const id = useId();
	const hydrated = useHydrated();
	const parents = useParents();
	const change = useSetAccountWhose();
	return (
		<div className="grid max-w-sm gap-2">
			<WhoseAccountField
				id={`${id}-whose`}
				disabled={!hydrated}
				value={account.whose ?? WHOSE_HOUSEHOLD}
				hint="Where it’s listed on Accounts. Both of you see it either way."
				onValueChange={(value) => {
					const whoseMemberId = value === WHOSE_HOUSEHOLD ? null : value;
					if (whoseMemberId === account.whose) return;
					const name = parents.find((parent) => parent.id === whoseMemberId)?.name;
					change.mutate(
						{ accountId: account.id, whoseMemberId },
						{
							onSuccess: () => toast(`${account.name} is ${name ?? WHOSE_HOUSEHOLD_LABEL}’s now.`),
						},
					);
				}}
			/>
			<SaveFailed change={change} />
		</div>
	);
}
