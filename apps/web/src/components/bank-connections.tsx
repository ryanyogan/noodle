import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Landmark, Plus } from "lucide-react";
import { ulid } from "ulid";
import { shortDayAt } from "../format";
import { bankConnectionsQuery, goalsQuery } from "../queries";
import {
	type BankConnectionSummary,
	type BankConnectionsData,
	type ConnectBankResult,
	connectBank,
	finishBankReconnect,
	startBankLink,
	startBankReconnect,
} from "../server/bank-connections";

// Bank Connections on the Accounts page: a Parent connects a bank or card through Plaid Link, and
// its Accounts appear here and among the Household's Accounts while the Import Workflow brings in
// their recent Transactions. Link runs in Plaid's own frame; the page only ever sees Link's
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

export function BankConnections() {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const { setUp, providers, connections } = useSuspenseQuery(bankConnectionsQuery()).data;
	const plaid = providers.includes("plaid");

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
			<SectionHeader id="bank-connections" title="Bank Connections" count={connections.length} />
			{connections.length > 0 ? (
				<>
					<List aria-label="Bank Connections">
						{connections.map((connection) => (
							<ConnectionRow key={connection.id} connection={connection} setUp={setUp} />
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
								? "Connect a bank or card, and Noodle adds its Accounts and brings in their recent Transactions."
								: "Connecting a bank needs Plaid, which isn’t set up for this copy of Noodle yet."}
						</p>
					</div>
					{connectButton(false)}
				</Card>
			)}
		</Section>
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
			title={connection.institution ?? "Bank"}
			meta={
				<>
					<span>
						{count === 1 ? "1 Account" : `${count} Accounts`}
						{" · "}
						<span className={cn(status.failed && "text-over")}>{status.text}</span>
					</span>
					{/* What the provider asked the Parent to read (Plaid's display_message), as plain text. */}
					{connection.notice ? (
						<span className="basis-full whitespace-pre-line break-words text-foreground">
							{connection.notice}
						</span>
					) : null}
				</>
			}
			trailing={
				connection.status === "reconnect" && setUp ? (
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
