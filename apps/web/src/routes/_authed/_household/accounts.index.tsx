import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
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
import { formatMoney } from "../../../format";
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
	const cash = accounts.filter((a) => a.holdsMoney);
	const owing = accounts.filter((a) => !a.holdsMoney);

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
					<AddAccountForm onAdd={(account) => addAccount.mutate(account)} />
					<SaveFailed change={addAccount} />
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
			{/* lg: the Accounts on the left; totals and Bank Connections in a rail that stays put (#47). */}
			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="grid min-w-0 gap-8">
					<SaveFailed change={addAccount} />
					<AccountGroup id="accounts-cash" title="Cash" accounts={cash} />
					<AccountGroup id="accounts-owed" title="Cards and loans" accounts={owing} />
				</div>
				{/* On phones the totals come first and the Bank Connections last. */}
				<div className="max-lg:contents lg:sticky lg:top-6 lg:grid lg:gap-8">
					<AccountTotals accounts={accounts} />
					<BankConnections bank={bank} />
				</div>
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

/** One kind of Account (Cash, or Cards and loans), listed; nothing when there are none. */
function AccountGroup({
	id,
	title,
	accounts,
}: {
	id: string;
	title: string;
	accounts: AccountView[];
}) {
	if (accounts.length === 0) return null;
	return (
		<Section aria-labelledby={id}>
			<SectionHeader id={id} title={title} count={accounts.length} />
			<List>
				{accounts.map((account) => (
					<AccountItem key={account.id} account={account} />
				))}
			</List>
		</Section>
	);
}

/**
 * What the Accounts add up to: the cash in them, what's owed on cards and loans, and how much of
 * the cash Goals have set aside. Accounts without a balance yet count for nothing, and say so.
 */
function AccountTotals({ accounts }: { accounts: AccountView[] }) {
	const sum = (values: (number | null)[]) => values.reduce<number>((t, v) => t + (v ?? 0), 0);
	const cash = accounts.filter((a) => a.holdsMoney);
	const owing = accounts.filter((a) => !a.holdsMoney);
	const notSetAside = sum(cash.map((a) => a.unclaimed));
	const missing = accounts.filter((a) => a.balance === null).length;
	const rows = [
		{ label: "Cash", value: sum(cash.map((a) => a.balance)), show: cash.length > 0 },
		{ label: "Owed", value: sum(owing.map((a) => a.balance)), show: owing.length > 0 },
		{
			label: "Set aside for Goals",
			value: sum(cash.map((a) => a.earmarked)),
			show: cash.length > 0,
		},
		{ label: "Not set aside", value: notSetAside, show: cash.length > 0, over: notSetAside < 0 },
	].filter((row) => row.show);
	return (
		<Card role="region" aria-labelledby="account-totals" className="max-lg:order-first">
			<div className="grid gap-3 p-(--card-pad)">
				<h2 id="account-totals" className="text-[13px] font-medium text-muted-foreground">
					Totals
				</h2>
				<dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-x-4 gap-y-3">
					{rows.map((row) => (
						<div key={row.label} className="grid gap-0.5">
							<dt className="text-[13px] text-muted-foreground">{row.label}</dt>
							<dd className={cn("text-lg font-semibold tabular-nums", row.over && "text-over")}>
								{formatMoney(row.value)}
							</dd>
						</div>
					))}
				</dl>
				{missing > 0 ? (
					<p className="text-[13px] text-muted-foreground">
						{missing === 1 ? "1 Account has" : `${missing} Accounts have`} no balance yet, so
						{missing === 1 ? " it isn’t" : " they aren’t"} counted.
					</p>
				) : null}
			</div>
		</Card>
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
			trailingOnTitle
			meta={
				// Kind and source on one line, how it splits on the next, so a phone reads it in two.
				<span>
					{accountKindName[account.kind]}
					{" · "}
					<span className={cn(needsLogin && "text-over")}>{accountSourceText(source, true)}</span>
					{split ? (
						<span className={cn("block", split.over && "text-over")}>{split.text}</span>
					) : null}
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
