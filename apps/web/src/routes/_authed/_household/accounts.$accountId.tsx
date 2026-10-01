import { dayKeyAt, monthOfDay } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Progress } from "@noodle/ui/components/progress";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useHydrated,
	useRouteContext,
} from "@tanstack/react-router";
import { Ellipsis, Pencil, Unplug } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { accountSource, accountSourceText } from "../../../account-source";
import {
	AddGoalSheet,
	AmountSheet,
	BackToAccounts,
	GoalProgressBar,
	LinkRow,
} from "../../../components/goals";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { StatementBalanceNote, StatementsSection } from "../../../components/statements";
import { TermHelp } from "../../../components/term-help";
import {
	EditTransactionSheet,
	TransactionItem,
	useBringsSpendingIn,
	waitingForBank,
} from "../../../components/transaction-list";
import { formatMoney, shortDay } from "../../../format";
import {
	type AccountView,
	accountKindName,
	useAddGoal,
	useGoals,
	useRenameAccount,
	useUpdateAccountBalance,
} from "../../../goals";
import {
	accountImportsQuery,
	bankConnectionsQuery,
	goalsQuery,
	membersQuery,
	monthQuery,
} from "../../../queries";
import { unpairBankAccount } from "../../../server/bank-connections";
import { accountTransactionsQuery, type TransactionRow } from "../../../transactions";

export const Route = createFileRoute("/_authed/_household/accounts/$accountId")({
	loader: async ({ context, params }) => {
		const [data] = await Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(accountImportsQuery(params.accountId)),
			context.queryClient.ensureQueryData(bankConnectionsQuery()),
		]);
		if (!data.accounts.some((a) => a.id === params.accountId)) throw notFound();
		await Promise.all([
			context.queryClient.ensureInfiniteQueryData(accountTransactionsQuery(params.accountId)),
			context.queryClient.ensureQueryData(membersQuery()),
		]);
	},
	component: AccountPage,
});

function AccountPage() {
	const { accountId } = Route.useParams();
	const account = useGoals().accounts.find((a) => a.id === accountId);
	if (!account)
		return (
			<PageHeader
				className="max-w-2xl"
				eyebrow="Account"
				title="Account"
				leading={<BackToAccounts />}
			/>
		);
	return <AccountDetails account={account} />;
}

function AccountDetails({ account }: { account: AccountView }) {
	const hydrated = useHydrated();
	const rename = useRenameAccount();
	const updateBalance = useUpdateAccountBalance();
	const [sheet, setSheet] = useState<"balance" | "rename" | "unpair" | null>(null);
	const { connections } = useSuspenseQuery(bankConnectionsQuery()).data;
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const source = accountSource(account, connections);
	const connected = source.kind === "connected" ? source : null;
	// A live bank balance isn't typed over, unless the bank has stopped bringing it in.
	const typesBalance = !connected || connected.needsLogin || account.balance === null;
	const queryClient = useQueryClient();
	const unpair = useMutation({
		mutationFn: () => unpairBankAccount({ data: { accountId: account.id } }),
		onSuccess: () => {
			toast(`${account.name} is kept by hand or by statements now.`);
			void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
			void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
		},
		onError: () => toast("Couldn’t stop bringing it in. Try again.", { tone: "error" }),
	});
	const close = (open: boolean) => {
		if (!open) setSheet(null);
	};
	const owes = !account.holdsMoney;
	// Goal spending recorded since the last balance update has already come off the balance.
	const spentSince =
		account.latestBalance && account.balance !== null
			? account.latestBalance.amount - account.balance
			: 0;

	return (
		<>
			<PageHeader
				className="max-w-2xl"
				eyebrow={`${accountKindName[account.kind]} Account`}
				title={account.name}
				leading={<BackToAccounts />}
				actions={
					// One action is a button; with a Bank Connection's too, they share a menu.
					connected ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={!hydrated}
									aria-label={`More actions for ${account.name}`}
								>
									<Ellipsis />
									<span aria-hidden="true">More</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem onSelect={() => setSheet("rename")}>
									<Pencil />
									Rename…
								</DropdownMenuItem>
								<DropdownMenuItem
									variant="destructive"
									disabled={unpair.isPending}
									onSelect={() => setSheet("unpair")}
								>
									<Unplug />
									Stop bringing in…
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!hydrated}
							onClick={() => setSheet("rename")}
						>
							<Pencil />
							Rename
						</Button>
					)
				}
			/>
			{sheet === "unpair" && connected ? (
				<Confirm
					confirmLabel={`Stop bringing in from ${connected.connection.institution ?? "the bank"}`}
					onConfirm={() => unpair.mutate()}
					onCancel={() => setSheet(null)}
				>
					{account.name} stays, with its Goals, balance and Transactions. Noodle stops bringing in
					its new Transactions and balance; you can upload statements or update it by hand, or
					choose it again from the Bank Connection on Accounts.
				</Confirm>
			) : null}
			<div className="grid max-w-2xl gap-8">
				<Card role="region" aria-labelledby="account-balance">
					<div className="grid gap-3 p-(--card-pad)">
						<div className="flex items-start justify-between gap-4">
							<div className="grid gap-1">
								<h2 id="account-balance" className="text-[13px] font-medium text-muted-foreground">
									{owes ? "Owed" : "Balance"}
								</h2>
								<p
									className={cn(
										"text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums",
										account.balance === null && "text-subtle-foreground",
									)}
								>
									{account.balance === null ? "—" : formatMoney(account.balance)}
								</p>
							</div>
							{typesBalance ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={!hydrated}
									onClick={() => setSheet("balance")}
								>
									{account.balance === null
										? owes
											? "Add what’s owed"
											: "Add balance"
										: owes
											? "Update what’s owed"
											: "Update balance"}
								</Button>
							) : null}
						</div>
						<p className="text-sm text-muted-foreground">
							{accountSourceText(source)}
							{/* One balance with where and when it's from (#47), not three numbers apart. */}
							{!connected && account.latestBalance ? (
								<>
									{" · "}
									{owes ? "owed" : "balance"} as of{" "}
									{shortDay(dayKeyAt(new Date(account.latestBalance.at), timeZone))}
									{spentSince > 0 ? `, less ${formatMoney(spentSince)} spent from Goals since` : ""}
								</>
							) : null}
							{connected?.needsLogin ? (
								<>
									{" · "}
									<Link to="/accounts" className="font-medium text-foreground underline">
										Reconnect on Accounts
									</Link>
								</>
							) : null}
						</p>
						{account.balance === null ? (
							<p className="text-sm text-muted-foreground">
								{owes
									? "Add what’s owed on it today."
									: "Add what’s in it today, from your bank, to see what’s not set aside."}
							</p>
						) : connected && spentSince > 0 ? (
							<p className="text-sm text-muted-foreground">
								Less {formatMoney(spentSince)} spent from Goals since the bank last said.
							</p>
						) : null}
						<StatementBalanceNote
							account={account}
							onUse={(amountCents) =>
								updateBalance.mutate({ balanceId: ulid(), accountId: account.id, amountCents })
							}
						/>
						{account.holdsMoney && account.balance !== null ? <SplitBar account={account} /> : null}
					</div>
					{account.overClaimedBy > 0 ? (
						<p
							role="status"
							className="border-t bg-over-soft px-(--card-pad) py-3 text-[13px] text-over-foreground"
						>
							Goals have set aside {formatMoney(account.overClaimedBy)} more than the balance.
							Update the balance if it’s out of date, or release some of what a Goal has set aside.
						</p>
					) : null}
				</Card>
				<SaveFailed change={updateBalance} />
				<SaveFailed change={rename} />

				{account.holdsMoney ? (
					<Section aria-labelledby="account-set-aside">
						<SectionHeader
							id="account-set-aside"
							title="Set aside for Goals"
							count={account.earmarks.length}
							help={<TermHelp term="set-aside" />}
						/>
						<List>
							{account.earmarks.map(({ goal, amount }) => (
								<LinkRow
									key={goal.id}
									link={(props) => (
										<Link to="/goals/$goalId" params={{ goalId: goal.id }} {...props} />
									)}
									label={`${goal.name}, ${formatMoney(amount)} set aside`}
									title={goal.name}
									meta={`${goal.completed ? "Completed · " : ""}Goal of ${formatMoney(goal.target)}`}
									trailing={
										<span className="text-sm font-semibold tabular-nums">
											{formatMoney(amount)}
										</span>
									}
								/>
							))}
							<ListRow
								aria-label={
									account.unclaimed === null
										? "Not set aside, unknown until the balance is added"
										: `Not set aside, ${formatMoney(account.unclaimed)}`
								}
								title="Not set aside"
								meta="Free for new Goals"
								trailing={
									<span
										className={cn(
											"text-sm font-semibold tabular-nums",
											account.unclaimed === null && "font-normal text-subtle-foreground",
											account.overClaimedBy > 0 && "text-over",
										)}
									>
										{account.unclaimed === null ? "—" : formatMoney(account.unclaimed)}
									</span>
								}
							/>
						</List>
					</Section>
				) : (
					<PayOffSection account={account} />
				)}
				<AccountTransactions account={account} />
				<StatementsSection
					account={account}
					connected={
						connected
							? {
									institution: connected.connection.institution,
									needsLogin: connected.needsLogin,
								}
							: null
					}
				/>
			</div>

			<AmountSheet
				open={sheet === "balance"}
				onOpenChange={close}
				title={owes ? "Update what’s owed" : "Update balance"}
				description={
					owes
						? `What’s owed on ${account.name} today: the current balance on its site or app, pending charges included.`
						: `What’s in ${account.name} today, from your bank.`
				}
				label={owes ? "Owed now" : "Balance now"}
				initialCents={account.balance}
				allowZero
				submitLabel="Save"
				check={() => ({
					hint: owes
						? "Replaces what was owed before."
						: "Replaces the balance; what Goals have set aside stays as it is.",
				})}
				onSave={(amountCents) => {
					setSheet(null);
					updateBalance.mutate({ balanceId: ulid(), accountId: account.id, amountCents });
				}}
			/>
			<Sheet open={sheet === "rename"} onOpenChange={close}>
				{sheet === "rename" ? (
					<SheetContent>
						<SheetHeader title={`Rename ${account.name}`} />
						<RenameForm
							name={account.name}
							onSave={(name) => {
								setSheet(null);
								rename.mutate({ accountId: account.id, name });
							}}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</>
	);
}

/**
 * A credit card or loan's plan to pay it off (ADR-0019): its payoff Goal's progress, linking to
 * it, or "Plan to pay this off", which adds one with what's owed now as its target.
 */
function PayOffSection({ account }: { account: AccountView }) {
	const hydrated = useHydrated();
	const { goals, asOf, accounts } = useGoals();
	const addGoal = useAddGoal();
	const [adding, setAdding] = useState(false);
	const goal = goals.find((g) => g.id === account.payoffGoal?.id);
	const active = goal?.state === "active";
	const owes = account.balance !== null && account.balance > 0;
	return (
		<Section aria-labelledby="account-pay-off">
			<SectionHeader
				id="account-pay-off"
				title="Paying it off"
				help={<TermHelp term="payoff-goal" />}
			/>
			{goal ? (
				<List>
					<LinkRow
						link={(props) => <Link to="/goals/$goalId" params={{ goalId: goal.id }} {...props} />}
						label={`${goal.name}, paid down ${formatMoney(goal.progress.saved)} of ${formatMoney(goal.target)}`}
						title={goal.name}
						meta={
							goal.state === "completed"
								? `Completed · paid down ${formatMoney(goal.target)}`
								: goal.progress.status === "reached"
									? "Paid off · complete it on its page"
									: `Paid down ${formatMoney(goal.progress.saved)} of ${formatMoney(goal.target)}${goal.progress.monthly ? ` · ${formatMoney(goal.progress.monthly)} a month` : ""}`
						}
						trailing={
							active && goal.progress.status !== "reached" ? (
								<>
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(goal.progress.remaining)}
									</span>
									<span className="text-xs text-muted-foreground">still owed</span>
								</>
							) : undefined
						}
						below={active ? <GoalProgressBar share={goal.progress.share} /> : undefined}
					/>
				</List>
			) : null}
			{active ? null : (
				<Card className="grid justify-items-start gap-3 p-(--card-pad) text-sm text-muted-foreground">
					<p>
						{owes
							? `Plan extra payments on ${account.name} each month from Free to Spend, and watch what’s owed come down to $0.`
							: account.balance === null
								? "Add what’s owed on it first. Then you can plan to pay it off."
								: "Nothing’s owed on it now."}
					</p>
					{owes ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!hydrated}
							onClick={() => setAdding(true)}
						>
							Plan to pay this off
						</Button>
					) : null}
					<SaveFailed change={addGoal} />
				</Card>
			)}
			<AddGoalSheet
				open={adding}
				onOpenChange={setAdding}
				accounts={accounts}
				goals={goals}
				today={asOf}
				kind="payoff"
				accountId={account.id}
				lockKind
				onAdd={(variables) => {
					setAdding(false);
					addGoal.mutate(variables);
				}}
			/>
		</Section>
	);
}

/** How the balance splits: set aside for Goals, then not. Over-claimed fills it in the over colour. */
function SplitBar({ account }: { account: AccountView }) {
	const balance = account.balance ?? 0;
	const over = account.overClaimedBy > 0;
	const share = over ? 1 : balance > 0 ? Math.min(1, Math.max(0, account.earmarked / balance)) : 0;
	return (
		<div className="grid gap-2">
			<Progress
				aria-label="Set aside for Goals"
				value={share * 100}
				getValueLabel={() =>
					over
						? `${formatMoney(account.overClaimedBy)} more set aside than is in it`
						: `${formatMoney(account.earmarked)} of ${formatMoney(balance)}`
				}
				className="h-2"
				indicatorClassName={over ? "bg-over" : undefined}
			/>
			<p className="flex flex-wrap justify-between gap-x-4 text-[13px] text-muted-foreground tabular-nums">
				<span>Set aside {formatMoney(account.earmarked)}</span>
				<span className={cn(over && "text-over")}>
					Not set aside {formatMoney(account.unclaimed ?? 0)}
				</span>
			</p>
		</div>
	);
}

function RenameForm({ name, onSave }: { name: string; onSave: (name: string) => void }) {
	const hydrated = useHydrated();
	const id = useId();
	const [value, setValue] = useState(name);
	const [tried, setTried] = useState(false);
	const missing = tried && value.trim() === "";

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setTried(true);
		if (value.trim() !== "") onSave(value.trim());
	}

	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<Field
				label="Name"
				htmlFor={`${id}-name`}
				error={missing ? "Give the Account a name." : null}
			>
				<Input
					id={`${id}-name`}
					required
					aria-invalid={missing || undefined}
					aria-describedby={missing ? `${id}-name-error` : undefined}
					maxLength={40}
					autoComplete="off"
					value={value}
					onChange={(event) => setValue(event.currentTarget.value)}
				/>
			</Field>
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated}>
					Save
				</Button>
			</SheetFooter>
		</form>
	);
}

/** How many of an Account's latest Transactions its page lists before "All in Transactions". */
const ACCOUNT_TRANSACTIONS = 8;

/**
 * An Account's latest Transactions, from any month: what was brought in from it, Goal spending
 * from it, and Quick Adds Matched with its lines. Each opens the editor, as on Transactions;
 * Transactions has the rest, filtered to the Account.
 */
function AccountTransactions({ account }: { account: AccountView }) {
	const { parentId } = Route.useRouteContext();
	const { asOf } = useGoals();
	const thisMonth = monthOfDay(asOf);
	const list = useSuspenseInfiniteQuery(accountTransactionsQuery(account.id)).data;
	const members = useSuspenseQuery(membersQuery()).data;
	// Names what each row is assigned to; a Bucket since archived reads as one.
	const plan = useQuery(monthQuery(thisMonth)).data?.plan ?? { buckets: [], commitments: [] };
	const bringsIn = useBringsSpendingIn();
	const [editing, setEditing] = useState<TransactionRow | null>(null);
	const all = list.pages.flatMap((page) => page.transactions);
	const shown = all.slice(0, ACCOUNT_TRANSACTIONS);
	return (
		<Section aria-labelledby="account-transactions">
			<SectionHeader
				id="account-transactions"
				title="Transactions"
				action={
					shown.length > 0 ? (
						<Button variant="ghost" size="sm" asChild>
							<Link
								to="/transactions/$month"
								params={{ month: thisMonth }}
								search={{ account: account.id }}
							>
								All in Transactions
							</Link>
						</Button>
					) : undefined
				}
			/>
			{shown.length > 0 ? (
				<List aria-label={`Latest Transactions in ${account.name}`}>
					{shown.map((transaction) => (
						<TransactionItem
							key={transaction.id}
							transaction={transaction}
							plan={plan}
							members={members}
							waiting={waitingForBank(transaction, asOf, bringsIn)}
							dated
							onEdit={setEditing}
						/>
					))}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					{account.bankConnectionId
						? "Its Transactions show here once the bank brings them in."
						: "Its Transactions show here once a statement brings them in, or a Quick Add is Matched with one."}
				</Card>
			)}
			<EditTransactionSheet
				transaction={editing}
				today={asOf}
				parentId={parentId}
				onClose={() => setEditing(null)}
			/>
		</Section>
	);
}
