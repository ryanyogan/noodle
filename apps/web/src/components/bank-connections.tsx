import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Landmark, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { shortDayAt } from "../format";
import { bankConnectionsQuery, goalsQuery } from "../queries";
import {
	type BankConnectionSummary,
	type BankConnectionsData,
	type ConnectBankResult,
	type ConnectSimplefinResult,
	connectBank,
	connectSimplefin,
	finishBankReconnect,
	startBankLink,
	startBankReconnect,
} from "../server/bank-connections";

// Bank Connections on the Goals page: a Parent connects a bank or card through Plaid Link, or by
// pasting a setup token from their SimpleFIN Bridge, and its Accounts appear here and among the
// Household's Accounts while the Import Workflow brings in their recent Transactions. Link runs in
// Plaid's own frame; the page only ever sees Link's one-time public token, or the setup token the
// Parent pasted, which the Worker exchanges. When a Plaid bank wants the Parent to log in again,
// its row says so, and Reconnect opens Link for that same login (update mode).

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

export function BankConnections() {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const { setUp, providers, connections } = useSuspenseQuery(bankConnectionsQuery()).data;
	const [simplefinOpen, setSimplefinOpen] = useState(false);
	const plaid = providers.includes("plaid");
	const simplefin = providers.includes("simplefin");

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
				toast(
					`Connected ${result.accounts === 1 ? "1 Account" : `${result.accounts} Accounts`}. Bringing in their Transactions.`,
				);
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
				void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
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

	const connectButtons = (quiet: boolean) => (
		<div className={quiet ? "flex flex-wrap gap-1" : "grid gap-2 sm:flex"}>
			{plaid ? (
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
			) : null}
			{simplefin ? (
				<Button
					type="button"
					size="sm"
					variant={quiet ? "ghost" : plaid ? "outline" : "default"}
					disabled={!hydrated}
					onClick={() => setSimplefinOpen(true)}
				>
					{quiet ? <Plus /> : null}
					Connect with SimpleFIN
				</Button>
			) : null}
		</div>
	);

	return (
		<Section aria-labelledby="bank-connections">
			<SectionHeader id="bank-connections" title="Bank Connections" count={connections.length} />
			{connections.length > 0 ? (
				<>
					<List aria-label="Bank Connections">
						{connections.map((connection) => (
							<ConnectionRow key={connection.id} connection={connection} setUp={setUp} />
						))}
					</List>
					{/* Under the list, not in the header: two ways to connect don't fit beside the title on a phone. */}
					{setUp ? connectButtons(true) : null}
				</>
			) : (
				<Card className="grid gap-3 p-(--card-pad) sm:flex sm:items-center">
					<div className="flex flex-1 items-center gap-3 text-sm">
						<Tile>
							<Landmark />
						</Tile>
						<p className="text-muted-foreground">
							{setUp
								? "Connect a bank or card, and Noodle adds its Accounts and brings in their recent Transactions."
								: "Bank Connections aren’t set up for this copy of Noodle yet."}
						</p>
					</div>
					{setUp ? connectButtons(false) : null}
				</Card>
			)}
			<Sheet open={simplefinOpen} onOpenChange={setSimplefinOpen}>
				{simplefinOpen ? (
					<SheetContent>
						<SheetHeader
							title="Connect with SimpleFIN"
							description="Make a setup token at your SimpleFIN Bridge and paste it here. Noodle adds the Accounts it reaches and brings in their recent Transactions."
						/>
						<SimplefinForm onDone={() => setSimplefinOpen(false)} />
					</SheetContent>
				) : null}
			</Sheet>
		</Section>
	);
}

/** Why a setup token didn't connect, for the Parent to act on. */
const simplefinProblem = (result: Exclude<ConnectSimplefinResult, { ok: true }>): string | null => {
	switch (result.reason) {
		case "invalid-token":
			return "That isn’t a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge.";
		case "claimed":
			return "That setup token was used already, and each one connects only once. Make a new one at SimpleFIN Bridge. If you didn’t use it, revoke it there.";
		case "connected-already":
			return "Those Accounts are connected already.";
		case "no-accounts":
			return "There’s no checking, savings, card or loan account there to connect. Add one at SimpleFIN Bridge, then make a new setup token.";
		default:
			return null;
	}
};

/** The setup token a Parent pastes from SimpleFIN Bridge; the Worker claims it. */
function SimplefinForm({ onDone }: { onDone: () => void }) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const id = useId();
	const [token, setToken] = useState("");
	const [problem, setProblem] = useState<string | null>(null);

	const connect = useMutation({
		mutationFn: (setupToken: string) =>
			connectSimplefin({ data: { connectionId: ulid(), setupToken } }),
		onSuccess: (result) => {
			if (result.ok) {
				onDone();
				toast(
					`Connected ${result.accounts === 1 ? "1 Account" : `${result.accounts} Accounts`}. Bringing in their Transactions.`,
				);
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
				void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
				return;
			}
			if (result.reason === "not-set-up") {
				onDone();
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
				return;
			}
			setProblem(simplefinProblem(result));
		},
		onError: () => setProblem("Couldn’t reach SimpleFIN Bridge. Try again in a minute."),
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (token.trim() === "" || connect.isPending) return;
		setProblem(null);
		connect.mutate(token.trim());
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field
				label="Setup token"
				htmlFor={`${id}-token`}
				hint="Each setup token can be claimed only once. The access it gives stays sealed on Noodle’s server."
			>
				<Input
					id={`${id}-token`}
					value={token}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					enterKeyHint="go"
					disabled={!hydrated}
					aria-invalid={problem ? true : undefined}
					onChange={(event) => {
						setToken(event.currentTarget.value);
						setProblem(null);
					}}
				/>
			</Field>
			{problem ? <FormError>{problem}</FormError> : null}
			<Button type="submit" disabled={!hydrated || token.trim() === "" || connect.isPending}>
				{connect.isPending ? "Connecting…" : "Connect"}
			</Button>
		</form>
	);
}

const statusText = (connection: BankConnectionSummary): { text: string; failed: boolean } => {
	switch (connection.status) {
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
}: {
	connection: BankConnectionSummary;
	setUp: BankConnectionsData["setUp"];
}) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const status = statusText(connection);
	const count = connection.accounts.length;

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
		onError: () =>
			toast("Couldn’t reconnect the bank.", {
				tone: "error",
				action: { label: "Retry", onClick: () => reconnect.mutate() },
			}),
	});

	return (
		<ListRow
			leading={
				<Tile aria-hidden="true">
					<Landmark />
				</Tile>
			}
			title={
				connection.institution ??
				(connection.provider === "simplefin" ? "SimpleFIN Bridge" : "Bank")
			}
			meta={
				<>
					<span>
						{count === 1 ? "1 Account" : `${count} Accounts`}
						{" · "}
						<span className={cn(status.failed && "text-over")}>{status.text}</span>
					</span>
					{/* What the provider asked the Parent to read (SimpleFIN's errors), as plain text. */}
					{connection.notice ? (
						<span className="basis-full whitespace-pre-line break-words text-foreground">
							{connection.notice}
						</span>
					) : null}
				</>
			}
			trailing={
				// Only Plaid's logins lapse; a SimpleFIN Bridge is fixed at the Bridge (its notice says how).
				connection.status === "reconnect" && connection.provider === "plaid" && setUp ? (
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
				) : null
			}
		/>
	);
}
