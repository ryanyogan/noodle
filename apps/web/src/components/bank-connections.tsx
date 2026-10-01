import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Landmark, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, shortDayAt } from "../format";
import { accountKindName } from "../goals";
import { bankConnectionsQuery, goalsQuery } from "../queries";
import {
	type BankChoice,
	type BankConnectionSummary,
	type BankConnectionsData,
	type ConnectBankResult,
	chooseBankAccountsFn,
	connectBank,
	finishBankReconnect,
	getBankChoices,
	startBankLink,
	startBankReconnect,
} from "../server/bank-connections";
import { NativeSelect } from "./native-select";
import { TermHelp } from "./term-help";

// Bank Connections on the Accounts page: a Parent connects a bank or card through Plaid Link, then
// says which of the Household's Accounts each account there is, or adds it as a new one, or
// leaves it out (Choose Accounts, ADR-0020). Paired Accounts keep everything on them; the Import
// Workflow then brings in their recent Transactions, without doubling what statements brought. Link runs in Plaid's own frame; the page only ever sees Link's
// one-time public token, which the Worker exchanges. When a bank wants the Parent to log in again,
// its row says so, and Reconnect opens Link for that same login (update mode), so it stays the
// same Item on Plaid's plan rather than using another (ADR-0017).

/** What Plaid Link hands back when a Parent finishes linking (the fields read here). */
type LinkSuccess = { publicToken: string; institution: string | null };

type PlaidLinkHandler = { open: () => void; destroy: () => void };
type PlaidGlobal = {
	create: (config: {
		token: string;
		onSuccess: (publicToken: string, metadata: { institution?: { name?: string } | null }) => void;
		onExit: (error: unknown) => void;
	}) => PlaidLinkHandler;
};

// Plaid serves Link from this rolling "stable" URL and updates it in place (it asks that Link not
// be pinned or self-hosted), so it's loaded without an integrity hash: a fixed one would break on
// Plaid's next release.
const PLAID_LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

let plaidLink: Promise<PlaidGlobal> | null = null;

/** Loads Plaid Link's script once, when a Parent first connects a bank. */
function loadPlaidLink(): Promise<PlaidGlobal> {
	plaidLink ??= new Promise<PlaidGlobal>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = PLAID_LINK_SCRIPT;
		script.async = true;
		script.onload = () => {
			const plaid = (window as unknown as { Plaid?: PlaidGlobal }).Plaid;
			if (plaid) resolve(plaid);
			else reject(new Error("Plaid Link didn’t load"));
		};
		script.onerror = () => {
			plaidLink = null;
			script.remove();
			reject(new Error("Plaid Link didn’t load"));
		};
		document.head.appendChild(script);
	});
	return plaidLink;
}

/** Opens Plaid Link with the link token; null when the Parent closes it without linking. */
async function linkWithPlaid(token: string): Promise<LinkSuccess | null> {
	const plaid = await loadPlaidLink();
	return new Promise((resolve) => {
		const handler = plaid.create({
			token,
			onSuccess: (publicToken, metadata) => {
				handler.destroy();
				resolve({ publicToken, institution: metadata.institution?.name ?? null });
			},
			onExit: () => {
				handler.destroy();
				resolve(null);
			},
		});
		handler.open();
	});
}

/** E2E's stand-in for Link (AI_MODEL=stub): the fake link token is its own public token. */
const linkWithFake = async (token: string): Promise<LinkSuccess> => ({
	publicToken: token.replace("link-", "public-"),
	institution: "First Platypus Bank",
});

/** Opens Link, or E2E's stand-in for it, with the link token. */
const openLink = (setUp: BankConnectionsData["setUp"], token: string) =>
	setUp === "fake" ? linkWithFake(token) : linkWithPlaid(token);

type Connected = ConnectBankResult | { ok: false; reason: "closed" };

/**
 * Connecting a bank from anywhere on the Accounts page: Plaid Link, then Choose Accounts. One per
 * page, shared by Bank Connections and the ways to add an Account.
 */
export function useConnectBank() {
	const queryClient = useQueryClient();
	const { setUp, providers, connections } = useSuspenseQuery(bankConnectionsQuery()).data;
	const plaid = providers.includes("plaid");

	// The Bank Connection whose Accounts are being chosen, right after connecting or from its row.
	const [choosing, setChoosing] = useState<string | null>(null);

	const connect = useMutation({
		mutationFn: async (): Promise<Connected> => {
			const started = await startBankLink();
			if (!started.ok) return started;
			const linked = await openLink(setUp, started.linkToken);
			if (!linked) return { ok: false, reason: "closed" };
			return connectBank({ data: { connectionId: ulid(), ...linked } });
		},
		onSuccess: (result) => {
			if (result.ok) {
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
				setChoosing(result.connectionId);
			} else if (result.reason === "connected-already") {
				toast("That bank is connected already.");
			} else if (result.reason === "no-accounts") {
				toast("There’s no checking, savings, card or loan account there to connect.");
			} else if (result.reason === "not-set-up") {
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			}
		},
		onError: () =>
			toast("Couldn’t connect the bank.", {
				tone: "error",
				action: { label: "Retry", onClick: () => connect.mutate() },
			}),
	});

	return {
		plaid,
		setUp,
		connections,
		start: () => connect.mutate(),
		pending: connect.isPending,
		choose: setChoosing,
		chooseSheet: (
			<ChooseAccountsSheet
				connection={connections.find((c) => c.id === choosing) ?? null}
				onClose={() => setChoosing(null)}
			/>
		),
	};
}

export type ConnectBank = ReturnType<typeof useConnectBank>;

/** What connecting does, in a sentence or two: said before a Parent connects. */
export const CONNECT_EXPLAINED =
	"Noodle reads balances and about 90 days of Transactions, then new ones every day; it can’t move money. You say which Accounts you have already, so nothing counts twice, and Quick Adds are Matched with the bank’s copies. Each bank login you connect uses one of Noodle’s 10 Plaid connections.";

export function BankConnections({ bank }: { bank: ConnectBank }) {
	const hydrated = useHydrated();
	const { setUp, plaid, connections } = bank;
	const connect = { isPending: bank.pending, mutate: bank.start };

	const connectButton = (quiet: boolean) =>
		plaid ? (
			<Button
				type="button"
				size="sm"
				variant={quiet ? "ghost" : "default"}
				disabled={!hydrated || connect.isPending}
				onClick={() => connect.mutate()}
			>
				{quiet ? <Plus /> : null}
				Connect a bank
			</Button>
		) : null;

	return (
		<Section aria-labelledby="bank-connections">
			<SectionHeader
				id="bank-connections"
				title="Bank Connections"
				count={connections.length}
				help={<TermHelp term="bank-connection" />}
			/>
			{connections.length > 0 ? (
				<>
					<List aria-label="Bank Connections">
						{connections.map((connection) => (
							<ConnectionRow
								key={connection.id}
								connection={connection}
								setUp={setUp}
								onChoose={() => bank.choose(connection.id)}
							/>
						))}
					</List>
					{plaid ? <div className="flex">{connectButton(true)}</div> : null}
				</>
			) : (
				<Card className="grid gap-3 p-(--card-pad) sm:flex sm:items-center">
					<div className="flex flex-1 items-center gap-3 text-sm">
						<Tile>
							<Landmark />
						</Tile>
						<p className="text-muted-foreground">
							{plaid
								? CONNECT_EXPLAINED
								: "Connecting a bank needs Plaid, which isn’t set up for this copy of Noodle yet."}
						</p>
					</div>
					{connectButton(false)}
				</Card>
			)}
			{bank.chooseSheet}
		</Section>
	);
}

const statusText = (connection: BankConnectionSummary): { text: string; failed: boolean } => {
	switch (connection.status) {
		case "choosing":
			return { text: "Choose which Accounts these are to start bringing them in.", failed: true };
		case "importing":
			return { text: "Bringing in Transactions…", failed: false };
		case "failed":
			return { text: "Couldn’t bring in Transactions. Noodle will try again.", failed: true };
		case "reconnect":
			return { text: "The bank wants you to log in again.", failed: true };
		default:
			return {
				text: connection.lastImportedAt
					? `Up to date · ${shortDayAt(connection.lastImportedAt.getTime())}`
					: "Up to date",
				failed: false,
			};
	}
};

function ConnectionRow({
	connection,
	setUp,
	onChoose,
}: {
	connection: BankConnectionSummary;
	setUp: BankConnectionsData["setUp"];
	onChoose: () => void;
}) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const status = statusText(connection);
	const count = connection.accounts.length;
	const [failed, setFailed] = useState(false);

	const reconnect = useMutation({
		mutationFn: async (): Promise<"done" | "closed" | "gone"> => {
			const started = await startBankReconnect({ data: { connectionId: connection.id } });
			if (!started.ok) return "gone";
			// Update mode: Link logs in to the same Item, so there's nothing to exchange.
			if (!(await openLink(setUp, started.linkToken))) return "closed";
			const finished = await finishBankReconnect({ data: { connectionId: connection.id } });
			return finished.ok ? "done" : "gone";
		},
		onSuccess: (result) => {
			if (result === "done") toast("Reconnected. Bringing in new Transactions.");
			if (result !== "closed") {
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			}
		},
		// Said in the row, with what to do meanwhile: a toast went before the Parent could read it.
		onError: () => setFailed(true),
		onMutate: () => setFailed(false),
	});

	return (
		<ListRow
			leading={
				<Tile aria-hidden="true">
					<Landmark />
				</Tile>
			}
			title={connection.institution ?? "Bank"}
			meta={
				<>
					<span>
						{count === 1 ? "1 Account" : `${count} Accounts`}
						{" · "}
						<span className={cn(status.failed && "text-over")}>{status.text}</span>
					</span>
					{failed ? (
						<span role="alert" className="basis-full text-over">
							{connection.institution ?? "The bank"} didn’t take the login. Try again, or upload a
							statement on{" "}
							{connection.accounts.length === 1 ? "its Account’s page" : "each Account’s page"} for
							now: what the bank brings in later isn’t added twice.
						</span>
					) : null}
					{/* What the provider asked the Parent to read (Plaid's display_message), as plain text. */}
					{connection.notice ? (
						<span className="basis-full whitespace-pre-line break-words text-foreground">
							{connection.notice}
						</span>
					) : null}
				</>
			}
			trailing={
				connection.status === "choosing" && setUp ? (
					<Button type="button" size="sm" disabled={!hydrated} onClick={onChoose}>
						Choose Accounts
					</Button>
				) : connection.status === "reconnect" && setUp ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={!hydrated || reconnect.isPending}
						onClick={() => reconnect.mutate()}
						aria-label={`Reconnect ${connection.institution ?? "the bank"}`}
					>
						Reconnect
					</Button>
				) : setUp ? (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={!hydrated}
						onClick={onChoose}
						aria-label={`Choose Accounts for ${connection.institution ?? "the bank"}`}
					>
						Accounts
					</Button>
				) : null
			}
		/>
	);
}

/** What a Parent picked for one bank account in Choose Accounts. */
type Pick = "new" | "leave-out" | `pair:${string}`;

const defaultPick = (account: BankChoice): Pick =>
	account.suggested ? `pair:${account.suggested}` : "new";

/**
 * Choose Accounts (ADR-0020): for each account at the institution, the Account it is (Noodle's
 * suggestion first), a new Account, or neither. Accounts paired already show as they are.
 */
function ChooseAccountsSheet({
	connection,
	onClose,
}: {
	connection: BankConnectionSummary | null;
	onClose: () => void;
}) {
	return (
		<Sheet open={connection !== null} onOpenChange={(open) => (open ? null : onClose())}>
			{connection ? (
				<SheetContent>
					<SheetHeader
						title="Which of these do you have already?"
						description={`Pick the Account each ${connection.institution ?? "bank"} account already is, so Noodle keeps its Goals and history and counts nothing twice. Lines your statements already brought in aren’t added again.`}
					/>
					<ChooseAccountsForm connection={connection} onDone={onClose} />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function ChooseAccountsForm({
	connection,
	onDone,
}: {
	connection: BankConnectionSummary;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const choices = useQuery({
		queryKey: ["bank-choices", connection.id],
		queryFn: () => getBankChoices({ data: { connectionId: connection.id } }),
		staleTime: 0,
		gcTime: 0,
	});
	const [picks, setPicks] = useState<Record<string, Pick>>({});
	const [duplicate, setDuplicate] = useState(false);
	const open = (choices.data?.accounts ?? []).filter((a) => a.pairedWith === null);
	const pickOf = (account: BankChoice) => picks[account.externalId] ?? defaultPick(account);

	const save = useMutation({
		mutationFn: () =>
			chooseBankAccountsFn({
				data: {
					connectionId: connection.id,
					choices: open.map((account) => {
						const pick = pickOf(account);
						return {
							externalId: account.externalId,
							choice: pick.startsWith("pair:")
								? { pair: pick.slice(5) }
								: (pick as "new" | "leave-out"),
						};
					}),
				},
			}),
		onSuccess: (result) => {
			void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
			if (!result.ok) {
				toast("That bank isn’t connected any more.", { tone: "error" });
			} else if (result.refused.length > 0) {
				toast("Some of those Accounts were connected meanwhile. Choose again.", { tone: "error" });
				void choices.refetch();
				return;
			} else {
				toast(
					`Bringing in ${result.accounts === 1 ? "1 Account" : `${result.accounts} Accounts`} from ${connection.institution ?? "the bank"}.`,
				);
			}
			onDone();
		},
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const paired = open.map(pickOf).filter((pick) => pick.startsWith("pair:"));
		if (new Set(paired).size !== paired.length) {
			setDuplicate(true);
			return;
		}
		setDuplicate(false);
		save.mutate();
	}

	if (choices.isPending) {
		return (
			<div className="grid gap-3" aria-busy="true">
				<Skeleton className="h-16" />
				<Skeleton className="h-16" />
				<Skeleton className="h-16" />
			</div>
		);
	}
	if (!choices.data) {
		return (
			<FormError>
				Couldn’t reach {connection.institution ?? "the bank"} to list its accounts.{" "}
				<button type="button" className="underline" onClick={() => void choices.refetch()}>
					Try again
				</button>
			</FormError>
		);
	}
	const paired = choices.data.accounts.filter((a) => a.pairedWith !== null);
	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-5">
			{open.map((account) => (
				<Field
					key={account.externalId}
					htmlFor={`${id}-${account.externalId}`}
					label={account.name}
					hint={`${accountKindName[account.kind]}${account.balance === null ? "" : ` · ${account.kind === "credit-card" || account.kind === "loan" ? "owes " : ""}${formatMoney(account.balance)} at the bank`}${account.suggested ? ` · looks like your ${account.options.find((o) => o.id === account.suggested)?.name ?? "Account"}` : ""}`}
				>
					<NativeSelect
						id={`${id}-${account.externalId}`}
						value={pickOf(account)}
						aria-invalid={duplicate || undefined}
						onChange={(event) =>
							setPicks((was) => ({ ...was, [account.externalId]: event.target.value as Pick }))
						}
					>
						{account.options.map((option) => (
							<option key={option.id} value={`pair:${option.id}`}>
								Same as {option.name}
							</option>
						))}
						<option value="new">Add as a new Account</option>
						<option value="leave-out">Leave it out</option>
					</NativeSelect>
				</Field>
			))}
			{paired.length > 0 ? (
				<ul className="grid gap-1 text-sm text-muted-foreground" aria-label="Paired already">
					{paired.map((account) => (
						<li key={account.externalId}>
							{account.name} is{" "}
							{account.options.find((o) => o.id === account.pairedWith)?.name ?? "an Account"}{" "}
							already. To stop, open that Account.
						</li>
					))}
				</ul>
			) : null}
			{choices.data.gone.length > 0 ? (
				<ul className="grid gap-1 text-sm text-muted-foreground" aria-label="No longer at the bank">
					{choices.data.gone.map((account) => (
						<li key={account.id}>
							{account.name}: {connection.institution ?? "the bank"} doesn’t list it any more. Open
							it to stop bringing it in, then pair its new account here.
						</li>
					))}
				</ul>
			) : null}
			{duplicate ? (
				<FormError>Each Account can be only one of these. Pick another for one of them.</FormError>
			) : null}
			{save.isError ? <FormError>Couldn’t save that. Try again.</FormError> : null}
			<Button type="submit" disabled={save.isPending || open.length === 0}>
				{connection.status === "choosing" ? "Start bringing them in" : "Save"}
			</Button>
		</form>
	);
}
