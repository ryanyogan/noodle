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
import {
	BankConnections,
	CONNECT_EXPLAINED,
	type ConnectBank,
	useConnectBank,
} from "../../../components/bank-connections";
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
	const bank = useConnectBank();

	if (accounts.length === 0) {
		return (
			<>
				<PageHeader title="Accounts" />
				<div className="grid max-w-3xl gap-6">
					<EmptyState
						icon={<Landmark />}
						title="Accounts are where the money is"
						description="Every Transaction comes from one. Pick how Noodle should know about each of yours."
					/>
					<AddAccountWays bank={bank} />
					<Section aria-labelledby="add-by-hand">
						<SectionHeader id="add-by-hand" title="Add an Account yourself" />
						<AddAccountForm onAdd={(account) => addAccount.mutate(account)} />
						<SaveFailed change={addAccount} />
					</Section>
					{bank.connections.length > 0 ? <BankConnections bank={bank} /> : bank.chooseSheet}
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
				<BankConnections bank={bank} />
			</div>
			<AddAccountSheet
				open={adding}
				onOpenChange={setAdding}
				onConnect={
					bank.plaid
						? () => {
								setAdding(false);
								bank.start();
							}
						: undefined
				}
				onAdd={(account) => {
					addAccount.mutate(account);
					setAdding(false);
				}}
			/>
		</>
	);
}

/**
 * The three ways Noodle can know about an Account, side by side, each saying what it does and
 * what happens to Quick Adds: connecting first, as the one that keeps itself up to date.
 */
function AddAccountWays({ bank }: { bank: ConnectBank }) {
	const hydrated = useHydrated();
	const ways = [
		{
			title: "Connect your bank",
			badge: "Recommended",
			text: bank.plaid
				? CONNECT_EXPLAINED
				: "Connecting a bank needs Plaid, which isn’t set up for this copy of Noodle yet.",
			action: bank.plaid ? (
				<Button type="button" size="sm" disabled={!hydrated || bank.pending} onClick={bank.start}>
					Connect a bank
				</Button>
			) : null,
		},
		{
			title: "Upload statements",
			text: "Add the Account below, then upload CSV or OFX files from your bank’s site on its page. Quick Adds are Matched with each statement’s lines.",
			action: null,
		},
		{
			title: "Type in a balance",
			text: "For cash, or a bank Noodle can’t reach. Add it below with what’s in it now, and update it yourself; your Quick Adds are its spending.",
			action: null,
		},
	];
	return (
		<ul aria-label="Ways to add an Account" className="grid gap-3 md:grid-cols-3">
			{ways.map((way) => (
				<li key={way.title} className="grid content-start gap-2 rounded-2xl border bg-card p-4">
					<p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
						{way.title}
						{way.badge ? (
							<span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-foreground">
								{way.badge}
							</span>
						) : null}
					</p>
					<p className="text-[13px] text-muted-foreground">{way.text}</p>
					{way.action ? <div className="pt-1">{way.action}</div> : null}
				</li>
			))}
		</ul>
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
