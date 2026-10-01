import { Button } from "@noodle/ui/components/button";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Landmark, Plus } from "lucide-react";
import { useState } from "react";
import { accountSource, accountSourceText } from "../../../account-source";
import { BankConnections } from "../../../components/bank-connections";
import {
	AddAccountForm,
	AddAccountSheet,
	accountIcons,
	accountSplitText,
	balanceLabel,
	LinkRow,
} from "../../../components/goals";
import { SaveFailed } from "../../../components/plan-editing";
import { type AccountView, accountKindName, useAddAccount, useGoals } from "../../../goals";
import { bankConnectionsQuery, goalsQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/accounts/")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(bankConnectionsQuery()),
		]),
	component: AccountsPage,
});

function AccountsPage() {
	const hydrated = useHydrated();
	const { accounts } = useGoals();
	const [adding, setAdding] = useState(false);
	const addAccount = useAddAccount();

	if (accounts.length === 0) {
		return (
			<>
				<PageHeader title="Accounts" />
				<div className="grid max-w-2xl gap-4">
					<EmptyState
						icon={<Landmark />}
						title="Accounts are where the money is"
						description="Every Transaction comes from one. Connect a bank to bring them in, add an Account and upload its statements, or add one by hand with what’s in it now."
					/>
					<AddAccountForm onAdd={(account) => addAccount.mutate(account)} />
					<SaveFailed change={addAccount} />
					<BankConnections />
				</div>
			</>
		);
	}

	return (
		<>
			<PageHeader
				title="Accounts"
				actions={
					<Button type="button" size="sm" disabled={!hydrated} onClick={() => setAdding(true)}>
						<Plus />
						Add Account
					</Button>
				}
			/>
			<div className="grid max-w-2xl gap-8">
				<Section aria-labelledby="accounts">
					<SectionHeader id="accounts" title="Accounts" count={accounts.length} />
					<SaveFailed change={addAccount} />
					<List>
						{accounts.map((account) => (
							<AccountItem key={account.id} account={account} />
						))}
					</List>
				</Section>
				<BankConnections />
			</div>
			<AddAccountSheet
				open={adding}
				onOpenChange={setAdding}
				onAdd={(account) => {
					addAccount.mutate(account);
					setAdding(false);
				}}
			/>
		</>
	);
}

/** An Account: its kind and balance, and for money-holding ones how it splits. */
function AccountItem({ account }: { account: AccountView }) {
	const Icon = accountIcons[account.kind];
	const split = accountSplitText(account);
	const { connections } = useSuspenseQuery(bankConnectionsQuery()).data;
	const source = accountSource(account, connections);
	const needsLogin = source.kind === "connected" && source.needsLogin;
	return (
		<LinkRow
			link={(props) => (
				<Link to="/accounts/$accountId" params={{ accountId: account.id }} {...props} />
			)}
			label={`${account.name}, ${accountKindName[account.kind]}, ${balanceLabel(account)}`}
			leading={
				<Tile aria-hidden="true">
					<Icon />
				</Tile>
			}
			title={account.name}
			meta={
				// One run of text, so it wraps like a sentence on a phone.
				<span>
					{accountKindName[account.kind]}
					{split ? (
						<>
							{" · "}
							<span className={cn(split.over && "text-over")}>{split.text}</span>
						</>
					) : null}
					<span className={cn("block", needsLogin && "text-over")}>
						{accountSourceText(source, true)}
					</span>
				</span>
			}
			trailing={
				<span
					className={cn(
						"text-sm tabular-nums",
						account.balance === null ? "text-subtle-foreground" : "font-semibold",
					)}
				>
					{balanceLabel(account)}
				</span>
			}
		/>
	);
}
