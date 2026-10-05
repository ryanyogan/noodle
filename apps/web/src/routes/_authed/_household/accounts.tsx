import { accountLabel, dayKeyAt } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Money } from "@noodle/ui/components/money";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Stat, StatGrid } from "@noodle/ui/components/stat";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useHydrated,
	useParams,
	useRouteContext,
} from "@tanstack/react-router";
import { ChevronRight, Landmark, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import {
	ListBesideDetail,
	masterDetailItem,
	sectionHeaderOverItem,
} from "../../../components/master-detail";
import { SaveFailed } from "../../../components/plan-editing";
import { formatMoney, shortDay } from "../../../format";
import {
	type AccountView,
	type ArchivedAccount,
	accountKindName,
	useAddAccount,
	useGoals,
} from "../../../goals";
import { bankConnectionsQuery, goalsQuery } from "../../../queries";
import { restoreAccount } from "../../../server/bank-connections";

export const Route = createFileRoute("/_authed/_household/accounts")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(bankConnectionsQuery()),
		]),
	component: AccountsPage,
});

function AccountsPage() {
	const hydrated = useHydrated();
	const { accounts, archivedAccounts } = useGoals();
	const [adding, setAdding] = useState(false);
	const picked = useParams({ strict: false, select: (params) => params.accountId });
	const addAccount = useAddAccount();
	const bank = useConnectBank();
	const cash = accounts.filter((a) => a.holdsMoney);
	const owing = accounts.filter((a) => !a.holdsMoney);

	if (accounts.length === 0) {
		return (
			<>
				<PageHeader eyebrow="Day to day" title="Accounts" />
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
					<ArchivedAccounts accounts={archivedAccounts} />
				</div>
			</>
		);
	}

	return (
		<>
			<PageHeader
				eyebrow="Day to day"
				title="Accounts"
				className={sectionHeaderOverItem}
				actions={
					<Button type="button" size="sm" disabled={!hydrated} onClick={() => setAdding(true)}>
						<Plus />
						Add Account
					</Button>
				}
			/>
			{/* The Accounts and Bank Connections on the left; the picked Account beside them (#67). While
			    none is picked they take the wide column and the totals the side one (#73). On phones the
			    totals come first. */}
			<ListBesideDetail
				picked={picked !== undefined}
				listFills
				noun="Account"
				listLabel="Accounts"
				aside={<AccountTotals accounts={accounts} />}
				list={
					<>
						<SaveFailed change={addAccount} />
						<AccountGroup id="accounts-cash" title="Cash" accounts={cash} />
						<AccountGroup id="accounts-owed" title="Cards and loans" accounts={owing} />
						<BankConnections bank={bank} />
						<ArchivedAccounts accounts={archivedAccounts} />
					</>
				}
			/>
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
			<AccountList>
				{accounts.map((account) => (
					<AccountItem key={account.id} account={account} />
				))}
			</AccountList>
		</Section>
	);
}

/**
 * The Accounts a Parent archived (ADR-0046), folded away at the bottom: each with Restore, which
 * puts it back in the list, the pickers and the totals. Nothing while there are none.
 */
function ArchivedAccounts({ accounts }: { accounts: ArchivedAccount[] }) {
	const queryClient = useQueryClient();
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const restore = useMutation({
		mutationFn: (account: ArchivedAccount) => restoreAccount({ data: { accountId: account.id } }),
		onSuccess: (_result, account) => {
			toast(`${account.name} is back in Accounts, kept by hand or by statements.`);
			void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
			void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
		},
		onError: () => toast("Couldn’t restore it. Try again.", { tone: "error" }),
	});
	if (accounts.length === 0) return null;
	return (
		<Collapsible className="group grid min-w-0 gap-3">
			<CollapsibleTrigger className="flex min-h-11 items-center gap-2 justify-self-start rounded-md pe-3 text-sm font-medium text-muted-foreground hover:text-foreground">
				<ChevronRight
					aria-hidden="true"
					className="size-4 transition-transform group-data-[state=open]:rotate-90"
				/>
				Archived
				<span className="tabular-nums">{accounts.length}</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<Card>
					<ul aria-label="Archived Accounts" className="[&>li+li]:border-t">
						{accounts.map((account) => (
							<li
								key={account.id}
								className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-(--card-pad) py-3"
							>
								<div className="grid min-w-0 gap-0.5">
									<p className="text-sm font-medium [overflow-wrap:anywhere]">
										{accountLabel(account)}
									</p>
									<p className="text-[13px] text-muted-foreground">
										{accountKindName[account.kind]} · Archived{" "}
										{shortDay(dayKeyAt(new Date(account.archivedAt), timeZone))}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									className="min-h-11"
									disabled={restore.isPending}
									aria-label={`Restore ${account.name}`}
									onClick={() => restore.mutate(account)}
								>
									Restore
								</Button>
							</li>
						))}
					</ul>
				</Card>
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * One group's Accounts: a list in the narrow pane beside a picked Account, a grid of cards (two or
 * three across, by the room there is) while the list has the wide column (#73), as Goals do. In
 * the grid the list's card steps aside (`contents`) and each row becomes a card of its own.
 */
function AccountList({ children }: { children: ReactNode }) {
	return (
		<div className="@container min-w-0">
			<Card className="@2xl:contents">
				<ul
					data-slot="list"
					className="[&>li+li]:border-t @2xl:grid @2xl:grid-cols-2 @5xl:grid-cols-3 @2xl:items-stretch @2xl:gap-3 @2xl:[&>li]:grid @2xl:[&>li]:overflow-hidden @2xl:[&>li]:rounded-(--radius-card) @2xl:[&>li]:border @2xl:[&>li]:bg-card @2xl:[&>li]:shadow-xs"
				>
					{children}
				</ul>
			</Card>
		</div>
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
		// The heading sits outside the card, so the card starts level with the first Account's (#73).
		<Section aria-labelledby="account-totals">
			<SectionHeader id="account-totals" title="Totals" />
			<Card className="grid gap-3 p-(--card-pad)">
				{/* Phones: two across even at 320, so the Accounts start a screen sooner (#74). */}
				<StatGrid className="grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] max-sm:grid-cols-[repeat(auto-fit,minmax(min(100%,6.75rem),1fr))]">
					{rows.map((row) => (
						<Stat
							key={row.label}
							label={row.label}
							value={<Money cents={row.value} />}
							tone={row.over ? "over" : undefined}
						/>
					))}
				</StatGrid>
				{missing > 0 ? (
					<p className="text-[13px] text-muted-foreground">
						{missing === 1 ? "1 Account has" : `${missing} Accounts have`} no balance yet, so
						{missing === 1 ? " it isn’t" : " they aren’t"} counted.
					</p>
				) : null}
			</Card>
		</Section>
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
				<li key={way.title}>
					<Card className="grid h-full content-start gap-2 p-(--card-pad)">
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
					</Card>
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
				<Link
					to="/accounts/$accountId"
					params={{ accountId: account.id }}
					{...masterDetailItem}
					{...props}
				/>
			)}
			label={`${account.name}, ${accountKindName[account.kind]}, ${balanceLabel(account)}`}
			leading={
				<Tile aria-hidden="true">
					<Icon />
				</Tile>
			}
			// On a card the name keeps to one line, cut short only when it's very long.
			title={<span className="@2xl:block @2xl:truncate">{account.name}</span>}
			trailingOnTitle
			// On a card the balance takes its own line, so the kind and bank line can wrap beside nothing.
			trailingClassName="@2xl:col-start-2 @2xl:row-start-2 @2xl:justify-items-start @2xl:text-start"
			meta={
				// Kind and source on one line, how it splits on the next, so a phone reads it in two.
				// A lapsed bank login is said once, on its Bank Connection; here only a small badge.
				<span className="min-w-0">
					<span>
						{accountKindName[account.kind]}
						{accountLabel(account) === account.name ? null : ` ••${account.mask}`}
						{" · "}
						{accountSourceText(source, true)}
					</span>
					{needsLogin ? (
						<>
							{" "}
							<Badge variant="over" className="align-middle">
								Log in again
							</Badge>
						</>
					) : null}
					{split ? (
						<span className={cn("block", split.over && "text-over")}>{split.text}</span>
					) : null}
				</span>
			}
			trailing={
				<span
					className={cn(
						"text-sm tabular-nums max-sm:text-end @2xl:text-base",
						account.balance === null ? "text-subtle-foreground max-sm:text-xs" : "font-semibold",
					)}
				>
					{account.balance !== null && !account.holdsMoney ? (
						// On a phone "owed" goes under the figure, so a long name has the room to wrap whole.
						<>
							{formatMoney(account.balance)}{" "}
							<span className="max-sm:block max-sm:text-xs max-sm:font-normal max-sm:text-muted-foreground">
								owed
							</span>
						</>
					) : account.balance === null ? (
						// On a phone "yet" goes under, as "owed" does: the name has the room.
						<>
							No balance <span className="max-sm:block">yet</span>
						</>
					) : (
						balanceLabel(account)
					)}
				</span>
			}
		/>
	);
}
