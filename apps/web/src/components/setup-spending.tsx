import type { ImportRecord } from "@noodle/db";
import { ACCOUNT_KINDS, type AccountKind } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { OptionSelect } from "@noodle/ui/components/select";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Spinner } from "@noodle/ui/components/spinner";
import { Tile } from "@noodle/ui/components/tile";
import { useHydrated, useRouteContext } from "@tanstack/react-router";
import { FileUp, Landmark } from "lucide-react";
import { type FormEvent, Suspense, useId, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, shortDay } from "../format";
import { accountKindName, useAddAccount, useGoals, useUpdateAccountBalance } from "../goals";
import { backgroundStatus, type SetupJobView } from "../setup";
import { importSummary } from "../statements";
import { useConnectBank } from "./bank-connections";
import { SaveFailed } from "./plan-editing";
import { balanceOffer, type Draft, NO_DRAFT, UploadForm } from "./statements";

// How spending comes in during the get-started wizard (#53), without leaving it: connecting a bank
// (Plaid Link, then Choose Accounts, ADR-0020) or uploading one Account's statement. Both use what
// the Accounts pages use; the Setup Workflow waits for the first history either one brings, and
// its jobs say how the reading is going.

/** How the reading stands, in the header's words; before any job reports, that it has begun. */
function Reading({ jobs }: { jobs: SetupJobView[] }) {
	const done = jobs.length > 0 && jobs.every((job) => job.status === "done");
	return (
		<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
			{done ? null : <Spinner />}
			{backgroundStatus(jobs) ?? "Reading your spending…"}
		</p>
	);
}

/** The bank path: a button that opens Plaid Link here, then the bank's name and the reading. */
export function SetupBankCard({ jobs }: { jobs: SetupJobView[] }) {
	const hydrated = useHydrated();
	const bank = useConnectBank();
	const { connections } = bank;

	if (connections.length === 0) {
		return (
			<Card className="grid gap-3 p-(--card-pad) text-sm">
				<div className="flex items-center gap-3">
					<Tile aria-hidden="true">
						<Landmark />
					</Tile>
					<p className="font-medium">Connect your bank</p>
				</div>
				<p className="text-muted-foreground">
					{bank.plaid
						? "You log in to your bank in its own window. Noodle reads balances and about a year of spending, then new spending every day. It can’t move money."
						: "Connecting a bank isn’t set up for this copy of Noodle yet. You can go on, and add what you spend by hand or from a statement later."}
				</p>
				{bank.plaid ? (
					<Button
						type="button"
						className="justify-self-start"
						disabled={!hydrated || bank.pending}
						onClick={bank.start}
					>
						{bank.pending ? <Spinner /> : null}
						Connect your bank
					</Button>
				) : null}
				{bank.chooseSheet}
			</Card>
		);
	}

	return (
		<Card className="grid gap-3 p-(--card-pad) text-sm">
			{connections.map((connection) => {
				const name = connection.institution ?? "Your bank";
				return (
					<div key={connection.id} className="grid gap-2">
						<div className="flex items-center gap-3">
							<Tile aria-hidden="true">
								<Landmark />
							</Tile>
							<p className="font-medium">{name} is connected</p>
						</div>
						{connection.status === "choosing" ? (
							<>
								<p className="text-muted-foreground">
									Say which accounts there to bring in, and Noodle starts reading.
								</p>
								<Button
									type="button"
									className="justify-self-start"
									disabled={!hydrated}
									onClick={() => bank.choose(connection.id)}
								>
									Choose Accounts
								</Button>
							</>
						) : connection.status === "reconnect" || connection.status === "failed" ? (
							<p className="text-over">
								{name} didn’t let Noodle read your spending. You can go on, and sort it out on
								Accounts later.
							</p>
						) : null}
					</div>
				);
			})}
			{connections.some((c) => c.status !== "choosing") ? <Reading jobs={jobs} /> : null}
			{bank.chooseSheet}
		</Card>
	);
}

/**
 * The statement path: which Account the statement is from (one there already, or a new one with a
 * name and a kind), then the file, with the same upload form as an Account’s page. Once the
 * spending has been read and nothing is being uploaded, there’s nothing left to show, until the
 * Parent asks for another statement.
 */
export function SetupStatementCard({ jobs }: { jobs: SetupJobView[] }) {
	const hydrated = useHydrated();
	const id = useId();
	const { accounts } = useGoals();
	const addAccount = useAddAccount();
	const [accountId, setAccountId] = useState<string | null>(null);
	const [from, setFrom] = useState(() => accounts[0]?.id ?? "new");
	const [name, setName] = useState("");
	const [nameMissing, setNameMissing] = useState(false);
	const [kind, setKind] = useState<AccountKind>("checking");
	const [draft, setDraft] = useState<Draft>(NO_DRAFT);
	const [imported, setImported] = useState<(ImportRecord & { accountName: string }) | null>(null);
	const account = accounts.find((a) => a.id === accountId) ?? null;
	const { timeZone } = useRouteContext({ from: "/_authed/setup" }).household;
	const updateBalance = useUpdateAccountBalance();
	// The statement's closing balance, offered as the Account's (as on the Account's page) until
	// the Parent uses it or keeps what Noodle has.
	const [balanceAnswered, setBalanceAnswered] = useState(false);
	// Set when the Parent asks for another statement, so the card shows even once reading is done.
	const [another, setAnother] = useState(false);
	const offer =
		imported && account && !balanceAnswered
			? balanceOffer(account, imported.closingBalance, timeZone)
			: null;
	const read = jobs.some((job) => job.job === "history" && job.status === "done");

	if (imported) {
		return (
			<Card className="grid gap-2 p-(--card-pad) text-sm">
				<p className="font-medium">
					{imported.fileName ?? "Your statement"} is in for {imported.accountName}
				</p>
				<p className="text-muted-foreground">{importSummary(imported)}.</p>
				{offer && account && imported.closingBalance ? (
					<div className="grid gap-2 rounded-md border p-3">
						<p className="text-muted-foreground">
							It ends {offer.owing ? "owing" : "at"}{" "}
							<span className="font-medium text-foreground tabular-nums">
								{formatMoney(offer.amount)}
							</span>{" "}
							on {shortDay(imported.closingBalance.date)}.{" "}
							{account.balance === null
								? `${account.name} has no ${account.holdsMoney ? "balance" : "amount owed"} yet.`
								: `Noodle has ${formatMoney(account.balance)}${account.holdsMoney ? "" : " owed"}.`}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								size="sm"
								disabled={!hydrated}
								onClick={() => {
									updateBalance.mutate({
										balanceId: ulid(),
										accountId: account.id,
										amountCents: offer.amount,
									});
									setBalanceAnswered(true);
								}}
							>
								Use {formatMoney(offer.amount)} {offer.owing ? "as what’s owed" : "as the balance"}
							</Button>
							{account.balance !== null ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => setBalanceAnswered(true)}
								>
									Keep {formatMoney(account.balance)}
								</Button>
							) : null}
						</div>
					</div>
				) : null}
				<Reading jobs={jobs} />
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="justify-self-start"
					onClick={() => {
						setImported(null);
						setBalanceAnswered(false);
						setAccountId(null);
						setFrom(accountId ?? "new");
						setName("");
						setKind("checking");
						setAnother(true);
					}}
				>
					Upload another statement
				</Button>
			</Card>
		);
	}
	if (read && !account && !another) return null;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (from !== "new") return setAccountId(from);
		const trimmed = name.trim();
		setNameMissing(!trimmed);
		if (!trimmed) return;
		const accountId = ulid();
		addAccount.mutate({ accountId, name: trimmed, kind, balanceCents: null, balanceId: ulid() });
		setAccountId(accountId);
	}

	const heading = (
		<div className="flex items-center gap-3">
			<Tile aria-hidden="true">
				<FileUp />
			</Tile>
			<p className="font-medium">Upload your statement</p>
		</div>
	);

	if (account) {
		return (
			<Card className="grid grid-cols-[minmax(0,1fr)] gap-3 p-(--card-pad) text-sm">
				{heading}
				{/* Side by side on a phone too: the words wrap, "Another account" stays at the right. */}
				<div className="flex items-start justify-between gap-2">
					<p className="min-w-0 text-muted-foreground">
						A CSV, OFX or QFX file from your bank for{" "}
						<span className="font-medium text-foreground">{account.name}</span>.
					</p>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="-my-1 shrink-0"
						onClick={() => {
							setDraft(NO_DRAFT);
							setAccountId(null);
							setFrom(account.id);
							// A new Account starts from the default, not the kind of the one just made.
							setName("");
							setKind("checking");
							setAnother(true);
						}}
					>
						Another account
					</Button>
				</div>
				{addAccount.isPending ? (
					<Skeleton className="h-11" />
				) : (
					<Suspense fallback={<Skeleton className="h-11" />}>
						<UploadForm
							account={account}
							draft={draft}
							onDraft={setDraft}
							onImported={(record) => {
								setDraft(NO_DRAFT);
								setImported({ ...record, accountName: account.name });
							}}
						/>
					</Suspense>
				)}
			</Card>
		);
	}

	const nameField = (
		<Field
			label={accounts.length > 0 ? "Its name" : "Which account is this from?"}
			htmlFor={`${id}-name`}
			hint="A name you’ll know it by, like Checking."
			error={nameMissing ? "Give the Account a name." : null}
		>
			<Input
				id={`${id}-name`}
				value={name}
				maxLength={40}
				autoComplete="off"
				aria-invalid={nameMissing || undefined}
				aria-describedby={nameMissing ? `${id}-name-error` : undefined}
				onChange={(event) => {
					setName(event.currentTarget.value);
					setNameMissing(false);
				}}
			/>
		</Field>
	);

	return (
		<Card className="grid gap-3 p-(--card-pad) text-sm">
			{heading}
			<p className="text-muted-foreground">
				Download a statement from your bank’s website, about three months if you can, and upload it
				here. Amounts fill in once it’s read.
			</p>
			<form onSubmit={onSubmit} noValidate className="grid gap-3">
				{accounts.length > 0 ? (
					<Field label="Which account is this from?" htmlFor={`${id}-from`}>
						<OptionSelect
							id={`${id}-from`}
							value={from}
							onValueChange={setFrom}
							choices={[
								...accounts.map((a) => ({ value: a.id, label: a.name })),
								{ value: "new", label: "A new Account" },
							]}
						/>
					</Field>
				) : null}
				{from === "new" ? (
					<div className="grid gap-3 sm:grid-cols-2">
						{nameField}
						<Field label="Kind" htmlFor={`${id}-kind`}>
							<OptionSelect
								id={`${id}-kind`}
								value={kind}
								onValueChange={(value) => setKind(value as AccountKind)}
								choices={ACCOUNT_KINDS.map((k) => ({ value: k, label: accountKindName[k] }))}
							/>
						</Field>
					</div>
				) : null}
				<Button type="submit" className="justify-self-start" disabled={!hydrated}>
					Choose the statement
				</Button>
			</form>
			<SaveFailed change={addAccount} />
		</Card>
	);
}
