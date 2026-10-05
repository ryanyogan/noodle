import { addDays, type DayKey, dayKeyAt, monthOfDay } from "@noodle/domain";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
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
import { DetailColumns } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
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
	useNavigate,
	useRouteContext,
} from "@tanstack/react-router";
import { Archive, Ellipsis, Pencil, Unplug } from "lucide-react";
import { type FormEvent, Fragment, useId, useState } from "react";
import { ulid } from "ulid";
import { accountSource, accountSourceText } from "../../../account-source";
import { DisconnectBankDialog } from "../../../components/bank-connections";
import {
	AccountPager,
	AddGoalSheet,
	AmountSheet,
	BackToAccounts,
	GoalProgressBar,
	LinkRow,
} from "../../../components/goals";
import { DetailHeader, DetailPending } from "../../../components/master-detail";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { StatementBalanceNote, StatementsSection } from "../../../components/statements";
import { TermHelp } from "../../../components/term-help";
import {
	EditTransactionSheet,
	TransactionItem,
	useBringsSpendingIn,
	waitingForBank,
} from "../../../components/transaction-list";
import { formatMoney, fullDay, shortDay } from "../../../format";
import {
	type AccountView,
	accountKindName,
	useAddGoal,
	useGoals,
	useRenameAccount,
	useUpdateAccountBalance,
} from "../../../goals";
import { perkSourcesForAccount } from "../../../perks";
import {
	accountImportsQuery,
	bankConnectionsQuery,
	commitmentsQuery,
	goalsQuery,
	membersQuery,
	monthQuery,
	perkSourcesQuery,
} from "../../../queries";
import { archiveAccount, unpairBankAccount } from "../../../server/bank-connections";
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
			context.queryClient.ensureQueryData(perkSourcesQuery()),
		]);
	},
	pendingComponent: DetailPending,
	component: AccountPage,
});

/** The More area's buttons: a full 44px to press, and a long bank name wraps inside at 320px. */
const moreButton = "h-auto min-h-11 max-w-full whitespace-normal py-2 text-start";

function AccountPage() {
	const { accountId } = Route.useParams();
	const account = useGoals().accounts.find((a) => a.id === accountId);
	if (!account)
		return <DetailHeader inPanel eyebrow="Account" title="Account" leading={<BackToAccounts />} />;
	return <AccountDetails account={account} />;
}

function AccountDetails({ account }: { account: AccountView }) {
	const hydrated = useHydrated();
	const rename = useRenameAccount();
	const updateBalance = useUpdateAccountBalance();
	const [sheet, setSheet] = useState<
		"balance" | "rename" | "unpair" | "disconnect" | "archive" | null
	>(null);
	const { connections } = useSuspenseQuery(bankConnectionsQuery()).data;
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const source = accountSource(account, connections);
	const connected = source.kind === "connected" ? source : null;
	// A live bank balance isn't typed over, unless the bank has stopped bringing it in.
	const typesBalance = !connected || connected.needsLogin || account.balance === null;
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { asOf } = useGoals();
	const bankName = connected?.connection.institution ?? "the bank";
	// The only Account syncing with its bank: stopping it disconnects the bank too (ADR-0046).
	const lastLinked = connected?.connection.accounts.length === 1;
	// Goals kept in it (or paying it off) that aren't archived: it can't be archived while they are.
	const goalsHere = useGoals().goals.filter(
		(goal) => goal.accountId === account.id && goal.state !== "archived",
	);
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
		void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
	};
	const bankSaidNo = `Couldn’t stop syncing with ${bankName} just now. Nothing changed. Try again.`;
	const unpair = useMutation({
		mutationFn: () => unpairBankAccount({ data: { accountId: account.id } }),
		onSuccess: (result) => {
			refresh();
			if (!result.ok) {
				if (result.reason !== "not-found") toast(bankSaidNo, { tone: "error" });
				return;
			}
			toast(
				result.disconnected
					? `${bankName} is disconnected. ${account.name} is kept by hand or by statements now.`
					: `${account.name} is kept by hand or by statements now.`,
			);
		},
		onError: () => toast(bankSaidNo, { tone: "error" }),
	});
	const archive = useMutation({
		mutationFn: () => archiveAccount({ data: { accountId: account.id } }),
		onSuccess: async (result) => {
			refresh();
			if (!result.ok) {
				if (result.reason === "goals") {
					toast(`${result.goals.join(", ")} is kept in it. Archive the Goal first.`, {
						tone: "error",
					});
				} else if (result.reason === "commitments") {
					// Straight to the Commitment, where "Pays down" can be changed or it can be ended.
					const one = result.commitments.length === 1;
					const paying = queryClient
						.getQueryData(commitmentsQuery().queryKey)
						?.commitments.find(
							(c) => c.accountId === account.id && result.commitments.includes(c.name),
						);
					const month = monthOfDay(asOf);
					toast(
						one
							? `${result.commitments[0]} pays it down. End the Commitment, or change what it pays down, first.`
							: `${result.commitments.join(", ")} pay it down. End them, or change what they pay down, first.`,
						{
							tone: "error",
							action: {
								label: one && paying ? `Open ${paying.name}` : "Open Commitments",
								onClick: () =>
									void (one && paying
										? navigate({
												to: "/plan/$month/commitments/$id",
												params: { month, id: paying.id },
											})
										: navigate({ to: "/plan/$month/commitments", params: { month } })),
							},
						},
					);
				} else if (result.reason === "bank" || result.reason === "not-set-up") {
					toast(bankSaidNo, { tone: "error" });
				}
				return;
			}
			// No Undo here: Restore, under Archived on Accounts, is the way back.
			toast(`${account.name} is archived. Restore it under Archived on Accounts.`);
			await navigate({ to: "/accounts" });
		},
		onError: () => toast("Couldn’t archive it. Nothing changed. Try again.", { tone: "error" }),
	});
	const close = (open: boolean) => {
		if (!open) setSheet(null);
	};
	const owes = !account.holdsMoney;
	// Goal spending recorded since the last balance update has already come off the balance; so
	// have a card or loan's payments filed in a Commitment that pays it down (ADR-0050).
	const spentSince =
		account.latestBalance && account.balance !== null
			? account.latestBalance.amount - account.balance
			: 0;
	const balanceDay = account.latestBalance
		? (account.latestBalance.day ?? dayKeyAt(new Date(account.latestBalance.at), timeZone))
		: null;
	// Paid down by hand for more than 35 days: what was bought or charged in interest since the
	// balance was entered isn't in the figure, and only a Parent can bring it in.
	const stale =
		owes &&
		!connected &&
		spentSince > 0 &&
		balanceDay !== null &&
		addDays(balanceDay, STALE_AFTER_DAYS) < asOf;

	return (
		<>
			<DetailHeader
				inPanel
				eyebrow={`${accountKindName[account.kind]} Account`}
				title={account.name}
				leading={<BackToAccounts />}
				pager={<AccountPager id={account.id} />}
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
								<DropdownMenuItem variant="destructive" onSelect={() => setSheet("disconnect")}>
									<Unplug />
									Disconnect {connected.connection.institution ?? "the bank"}…
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
					confirmLabel={`Stop syncing with ${bankName}`}
					onConfirm={() => unpair.mutate()}
					onCancel={() => setSheet(null)}
				>
					{account.name} stays, with its balance and Goals. Its Transactions stay. Nothing new comes
					in from {bankName}; you can upload statements or update it by hand.{" "}
					{lastLinked
						? `It’s the only Account syncing with ${bankName}, so ${bankName} is disconnected too. To sync again, connect ${bankName} on Accounts and choose this Account.`
						: `Your other Accounts at ${bankName} keep syncing. To sync this one again, press Accounts beside ${bankName} on the Accounts page and choose it.`}
				</Confirm>
			) : null}
			{sheet === "archive" ? (
				<Confirm
					confirmLabel="Archive this Account"
					onConfirm={() => archive.mutate()}
					onCancel={() => setSheet(null)}
				>
					{account.name} leaves Accounts, the pickers and the totals. Its Transactions stay, and
					past months still count them.{" "}
					{connected
						? `Nothing new comes in from ${bankName}${lastLinked ? `, and ${bankName} is disconnected, as this is its only Account here` : ""}. `
						: ""}
					You can bring it back with Restore, under Archived on Accounts.
				</Confirm>
			) : null}
			{sheet === "disconnect" && connected ? (
				<DisconnectBankDialog
					connectionId={connected.connection.id}
					institution={connected.connection.institution}
					onCancel={() => setSheet(null)}
				/>
			) : null}
			{/* In a wide pane: Transactions and statements on the left; the balance, what's set aside and the
			    payoff plan beside them on the right (#47, #73). Phones keep the figures first. */}
			<DetailColumns>
				<div className="grid min-w-0 gap-8 @3xl/detail:col-start-2 @3xl/detail:row-start-1">
					{/* Headed like Transactions beside it, so the two columns' headings and cards line up (#73). */}
					<Section aria-labelledby="account-balance">
						<SectionHeader id="account-balance" title={owes ? "Owed" : "Balance"} />
						<Card>
							<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-(--card-pad)">
								{/* The button drops under the figure when the two don't fit on a line (320px phones, #74). */}
								<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
									<div className="grid min-w-0 gap-1">
										{/* The same words as its row on Accounts, not a dash (#73). */}
										<p
											className={
												account.balance === null
													? "py-1 text-xl font-medium leading-tight text-subtle-foreground"
													: "text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums"
											}
										>
											{account.balance === null ? "No balance yet" : formatMoney(account.balance)}
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
											{owes && spentSince > 0
												? `${formatMoney(account.latestBalance.amount)} on ${shortDay(balanceDay ?? asOf)}, less ${formatMoney(spentSince)} paid since.`
												: `${owes ? "owed" : "balance"} as of ${shortDay(balanceDay ?? asOf)}${
														spentSince > 0
															? `, less ${formatMoney(spentSince)} spent from Goals since`
															: ""
													}`}
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
								{stale ? (
									<p className="text-sm text-muted-foreground">
										New charges and interest aren’t in this. Update what’s owed.
									</p>
								) : null}
								<StatementBalanceNote
									account={account}
									onUse={(amountCents, asOf) =>
										updateBalance.mutate({
											balanceId: ulid(),
											accountId: account.id,
											amountCents,
											asOf,
										})
									}
								/>
								{account.holdsMoney && account.balance !== null ? (
									<SplitBar account={account} />
								) : null}
							</div>
							{account.overClaimedBy > 0 ? (
								<p
									role="status"
									className="border-t bg-over-soft px-(--card-pad) py-3 text-[13px] text-over-foreground"
								>
									Goals have set aside {formatMoney(account.overClaimedBy)} more than the balance.
									Update the balance if it’s out of date, or release some of what a Goal has set
									aside.
								</p>
							) : null}
						</Card>
					</Section>
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
						<>
							<PayOffSection account={account} />
							<PaidDown account={account} connected={connected !== null} balanceDay={balanceDay} />
							<CardPerks account={account} />
						</>
					)}
				</div>
				<div className="grid min-w-0 gap-8 @3xl/detail:col-start-1 @3xl/detail:row-start-1">
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
					{/* Last on a phone, and quiet: what a Parent does once, not every visit (ADR-0046). */}
					<Section aria-labelledby="account-more">
						<SectionHeader id="account-more" title="More" />
						<Card className="grid gap-4 p-(--card-pad)">
							{connected ? (
								<div className="grid min-w-0 justify-items-start gap-1.5">
									<Button
										type="button"
										variant="outline"
										className={moreButton}
										disabled={!hydrated || unpair.isPending}
										onClick={() => setSheet("unpair")}
									>
										<Unplug />
										Stop syncing with {bankName}
									</Button>
									<p className="text-[13px] text-muted-foreground">
										Its Transactions stay. Nothing new comes in from {bankName}.
									</p>
								</div>
							) : null}
							<div className="grid min-w-0 justify-items-start gap-1.5">
								{goalsHere.length > 0 ? (
									<p className="text-sm text-muted-foreground">
										{goalsHere.map((goal) => goal.name).join(", ")}{" "}
										{goalsHere.length === 1 ? "is a Goal" : "are Goals"} kept in this Account, so it
										can’t be archived yet. Archive{" "}
										{goalsHere.length === 1 ? "that Goal" : "those Goals"} first.
									</p>
								) : (
									<>
										<Button
											type="button"
											variant="outline"
											className={moreButton}
											disabled={!hydrated || archive.isPending}
											onClick={() => setSheet("archive")}
										>
											<Archive />
											Archive this Account
										</Button>
										<p className="text-[13px] text-muted-foreground">
											Takes it off Accounts, the pickers and the totals. Its Transactions stay, and
											you can restore it.
										</p>
									</>
								)}
							</div>
						</Card>
					</Section>
				</div>
			</DetailColumns>

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

/** After this long, a card or loan paid down by hand says its figure misses new charges. */
const STALE_AFTER_DAYS = 35;

/** How many of a card or loan's payments its page lists before "Show all". */
const ACCOUNT_PAYMENTS = 6;

/**
 * The payments filed in Commitments that pay this card or loan down (ADR-0050), newest first,
 * with the Commitments themselves: where "Pays down" is changed. Kept by hand, each says whether
 * it came off what's owed (dated after the balance) or was already in it. Nothing until a
 * Commitment pays the Account down.
 */
function PaidDown({
	account,
	connected,
	balanceDay,
}: {
	account: AccountView;
	connected: boolean;
	balanceDay: DayKey | null;
}) {
	const hydrated = useHydrated();
	const data = useSuspenseQuery(goalsQuery()).data;
	// Names only: the page doesn't wait for every Commitment's year of charges.
	const commitments = useQuery(commitmentsQuery()).data?.commitments ?? [];
	const [showAll, setShowAll] = useState(false);
	const payments = data.payments.filter((p) => p.accountId === account.id).reverse();
	const paying = commitments.filter(
		(c) =>
			c.accountId === account.id && (c.endedFromMonth === null || c.endedFromMonth > data.month),
	);
	if (payments.length === 0 && paying.length === 0) return null;
	const nameOf = (id: string) => commitments.find((c) => c.id === id)?.name ?? "a Commitment";
	const when = (day: DayKey) =>
		day.slice(0, 4) === data.asOf.slice(0, 4) ? shortDay(day) : fullDay(day);
	return (
		<Section aria-labelledby="account-payments">
			<SectionHeader id="account-payments" title="Payments" count={payments.length} />
			<p className="px-1 text-sm text-muted-foreground">
				{paying.length > 0 ? (
					<>
						Paid down by{" "}
						{paying.map((c, i) => (
							<Fragment key={c.id}>
								{i > 0 ? ", " : ""}
								<Link
									to="/plan/$month/commitments/$id"
									params={{ month: data.month, id: c.id }}
									className="font-medium text-foreground underline underline-offset-3"
								>
									{c.name}
								</Link>
							</Fragment>
						))}
						.{" "}
					</>
				) : null}
				{connected
					? "Its bank keeps what’s owed up to date."
					: "A payment dated after what’s owed was last updated comes off it."}
			</p>
			{payments.length > 0 ? (
				<List aria-label={`Payments to ${account.name}`}>
					{payments.slice(0, showAll ? undefined : ACCOUNT_PAYMENTS).map((payment) => (
						<ListRow
							key={payment.id}
							title={`Payment · ${nameOf(payment.commitmentId)}`}
							meta={`${when(payment.date)}${
								connected || balanceDay === null
									? ""
									: payment.date > balanceDay
										? " · came off what’s owed"
										: " · already in what’s owed"
							}`}
							trailing={
								<span className="text-sm font-semibold tabular-nums">
									{formatMoney(payment.amount)}
								</span>
							}
						/>
					))}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					Payments filed in {paying.length === 1 ? paying[0]?.name : "them"} show here.
				</Card>
			)}
			{payments.length > ACCOUNT_PAYMENTS && !showAll ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					disabled={!hydrated}
					onClick={() => setShowAll(true)}
				>
					Show all {payments.length} payments
				</Button>
			) : null}
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
			<BudgetBar
				label="Set aside for Goals"
				value={share}
				max={1}
				state={over ? "over" : undefined}
				valueText={
					over
						? `${formatMoney(account.overClaimedBy)} more set aside than is in it`
						: `${formatMoney(account.earmarked)} of ${formatMoney(balance)}`
				}
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
					data-autofocus
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

/** A credit card's Perks, when it has any: a way to them from the card (#80). */
function CardPerks({ account }: { account: AccountView }) {
	const sources = perkSourcesForAccount(account, useSuspenseQuery(perkSourcesQuery()).data);
	const count = sources.reduce((sum, source) => sum + source.perks.length, 0);
	if (count === 0) return null;
	const names = sources.map((source) => source.name).join(", ");
	const meta = `${count} ${count === 1 ? "Perk" : "Perks"} · ${names}`;
	return (
		<Section aria-labelledby="account-perks">
			<SectionHeader id="account-perks" title="Perks" help={<TermHelp term="perk-source" />} />
			<List>
				<LinkRow
					link={(props) => <Link to="/insights/perks" {...props} />}
					label={`Perks for this card, ${meta}`}
					title="Perks for this card"
					meta={meta}
				/>
			</List>
		</Section>
	);
}
