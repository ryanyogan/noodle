import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, notFound, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { AmountSheet, BackToAccounts, LinkRow } from "../../../components/goals";
import { SaveFailed } from "../../../components/plan-editing";
import { StatementBalanceNote, StatementsSection } from "../../../components/statements";
import { TermHelp } from "../../../components/term-help";
import { formatMoney } from "../../../format";
import {
	type AccountView,
	accountKindName,
	useGoals,
	useRenameAccount,
	useUpdateAccountBalance,
} from "../../../goals";
import { accountImportsQuery, goalsQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/accounts/$accountId")({
	loader: async ({ context, params }) => {
		const [data] = await Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(accountImportsQuery(params.accountId)),
		]);
		if (!data.accounts.some((a) => a.id === params.accountId)) throw notFound();
	},
	component: AccountPage,
});

function AccountPage() {
	const { accountId } = Route.useParams();
	const account = useGoals().accounts.find((a) => a.id === accountId);
	if (!account)
		return <PageHeader eyebrow="Account" title="Account" leading={<BackToAccounts />} />;
	return <AccountDetails account={account} />;
}

function AccountDetails({ account }: { account: AccountView }) {
	const hydrated = useHydrated();
	const rename = useRenameAccount();
	const updateBalance = useUpdateAccountBalance();
	const [sheet, setSheet] = useState<"balance" | "rename" | null>(null);
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
				eyebrow={`${accountKindName[account.kind]} Account`}
				title={account.name}
				leading={<BackToAccounts />}
				actions={
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
				}
			/>
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
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!hydrated}
								onClick={() => setSheet("balance")}
							>
								{account.balance === null ? "Add balance" : "Update balance"}
							</Button>
						</div>
						{account.balance === null ? (
							<p className="text-sm text-muted-foreground">
								{owes
									? "Add what’s owed on it today."
									: "Add what’s in it today, from your bank, to see what’s not set aside."}
							</p>
						) : spentSince > 0 ? (
							<p className="text-sm text-muted-foreground">
								Goal spending of {formatMoney(spentSince)} since the balance was last updated is
								already taken off.
							</p>
						) : null}
						<StatementBalanceNote account={account} />
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
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						A {accountKindName[account.kind].toLowerCase()} is tracked by what’s owed on it. Goals
						are set aside in a checking or savings Account.
					</Card>
				)}
				<StatementsSection account={account} />
			</div>

			<AmountSheet
				open={sheet === "balance"}
				onOpenChange={close}
				title={owes ? "Update what’s owed" : "Update balance"}
				description={
					owes
						? `What’s owed on ${account.name} today.`
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

/** How the balance splits: set aside for Goals, then not. Over-claimed fills it in the over colour. */
function SplitBar({ account }: { account: AccountView }) {
	const balance = account.balance ?? 0;
	const over = account.overClaimedBy > 0;
	const share = over ? 1 : balance > 0 ? Math.min(1, Math.max(0, account.earmarked / balance)) : 0;
	return (
		<div className="grid gap-2">
			<div aria-hidden="true" className="relative h-2 overflow-hidden rounded-full bg-surface-3">
				<div
					className={cn(
						"absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--duration-meter) ease-spring",
						over ? "bg-over" : "bg-muted-foreground",
					)}
					style={{ width: `${(share * 100).toFixed(2)}%` }}
				/>
			</div>
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
	const valid = value.trim() !== "";

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (valid) onSave(value.trim());
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field label="Name" htmlFor={`${id}-name`}>
				<Input
					id={`${id}-name`}
					required
					maxLength={40}
					autoComplete="off"
					value={value}
					onChange={(event) => setValue(event.currentTarget.value)}
				/>
			</Field>
			<Button type="submit" disabled={!hydrated || !valid}>
				Save
			</Button>
		</form>
	);
}
