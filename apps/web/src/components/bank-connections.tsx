import { Alert, AlertDescription } from "@noodle/ui/components/alert";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { Landmark, Plus, Unplug } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import {
	type LinkError,
	type LinkedBank,
	LOGGED_LINK_EVENTS,
	type LoggedLinkEvent,
	lastUpdatedText,
	linkExitMessage,
	linkTokenExpired,
} from "../bank-link";
import { formatMoney } from "../format";
import { accountKindName } from "../goals";
import { bankConnectionsQuery, goalsQuery } from "../queries";
import {
	type BankChoice,
	type BankConnectionSummary,
	type BankConnectionsData,
	type BankDuplicate,
	type ConnectBankResult,
	checkBankDuplicate,
	chooseBankAccountsFn,
	connectBank,
	disconnectBank,
	finishBankReconnect,
	getBankChoices,
	getBankLinkSession,
	logBankLinkEvent,
	startBankLink,
	startBankReconnect,
} from "../server/bank-connections";
import { Confirm } from "./plan-editing";
import { TermHelp } from "./term-help";

// Bank Connections on the Accounts page: a Parent connects a bank or card through Plaid Link, then
// says which of the Household's Accounts each account there is, or adds it as a new one, or
// leaves it out (Choose Accounts, ADR-0020). Paired Accounts keep everything on them; the Import
// Workflow then brings in their recent Transactions, without doubling what statements brought. Link runs in Plaid's own frame; the page only ever sees Link's
// one-time public token, which the Worker exchanges. When a bank wants the Parent to log in again,
// its row says so, and Reconnect opens Link for that same login (update mode), so it stays the
// same Item on Plaid's plan rather than using another (ADR-0017).

/** The bank a Parent linked in Plaid Link, with Link's one-time public token for it. */
type Linked = LinkedBank & { publicToken: string };

type LinkMode = "connect" | "reconnect";

/** How Link ended: with a bank linked, or closed (with Plaid's error when something went wrong). */
type LinkOutcome =
	| { kind: "linked"; linked: Linked }
	| { kind: "exit"; error: LinkError | null; institution: string | null };

type PlaidInstitution = { name?: string | null; institution_id?: string | null } | null;
type PlaidEventMetadata = {
	link_session_id?: string | null;
	request_id?: string | null;
	error_type?: string | null;
	error_code?: string | null;
	exit_status?: string | null;
	view_name?: string | null;
	institution_id?: string | null;
};
type PlaidLinkHandler = { open: () => void; destroy: () => void };
type PlaidGlobal = {
	create: (config: {
		token: string;
		receivedRedirectUri?: string;
		onSuccess: (
			publicToken: string,
			metadata: { institution?: PlaidInstitution; accounts?: { mask?: string | null }[] | null },
		) => void;
		onExit: (error: LinkError | null, metadata: { institution?: PlaidInstitution }) => void;
		onEvent: (eventName: string, metadata: PlaidEventMetadata) => void;
	}) => PlaidLinkHandler;
};

// Plaid serves Link from this rolling "stable" URL and updates it in place (it asks that Link not
// be pinned or self-hosted), so it's loaded without an integrity hash: a fixed one would break on
// Plaid's next release. It's loaded only when a Parent connects a bank, never with the page.
// If the app ever sends a Content-Security-Policy, it must allow this script (script-src
// https://cdn.plaid.com), Plaid's frames (frame-src https://cdn.plaid.com) and Link's calls
// (connect-src https://production.plaid.com, and https://sandbox.plaid.com while on Sandbox), or
// Link won't open.
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

/**
 * Notes a Link event in the Worker's logs (logBankLinkEvent): only the few that say how a connect
 * went, with Link's session and request IDs. A note that doesn't arrive is no reason to stop.
 */
function logLinkEvent(mode: LinkMode, eventName: string, metadata: PlaidEventMetadata) {
	if (!(LOGGED_LINK_EVENTS as readonly string[]).includes(eventName)) return;
	void logBankLinkEvent({
		data: {
			event: eventName as LoggedLinkEvent,
			mode,
			linkSessionId: metadata.link_session_id ?? null,
			requestId: metadata.request_id ?? null,
			errorType: metadata.error_type ?? null,
			errorCode: metadata.error_code ?? null,
			exitStatus: metadata.exit_status ?? null,
			viewName: metadata.view_name ?? null,
			institutionId: metadata.institution_id ?? null,
		},
	}).catch(() => undefined);
}

type LinkOptions = {
	mode: LinkMode;
	/** The address the bank sent the Parent back to (/bank/return): Link carries on from it. */
	receivedRedirectUri?: string;
};

/** Opens Plaid Link with the link token, and says how it ended. */
async function linkWithPlaid(token: string, options: LinkOptions): Promise<LinkOutcome> {
	const plaid = await loadPlaidLink();
	return new Promise((resolve) => {
		const handler = plaid.create({
			token,
			...(options.receivedRedirectUri ? { receivedRedirectUri: options.receivedRedirectUri } : {}),
			onSuccess: (publicToken, metadata) => {
				handler.destroy();
				resolve({
					kind: "linked",
					linked: {
						publicToken,
						institution: metadata.institution?.name?.trim() || null,
						institutionId: metadata.institution?.institution_id || null,
						masks: (metadata.accounts ?? []).flatMap((a) => (a.mask ? [a.mask] : [])),
					},
				});
			},
			onExit: (error, metadata) => {
				handler.destroy();
				resolve({
					kind: "exit",
					error: error ?? null,
					institution: metadata?.institution?.name?.trim() || null,
				});
			},
			onEvent: (eventName, metadata) => logLinkEvent(options.mode, eventName, metadata ?? {}),
		});
		handler.open();
	});
}

// What's kept in this tab while Link runs, and for the page a Parent comes back to. Nothing here
// is secret: a link token only opens Link, and the server keeps a copy for the Parent as well
// (getBankLinkSession), for when the bank comes back in a browser that hasn't got this.
const LINK_KEY = "noodle.bank-link";
const AFTER_KEY = "noodle.bank-after";
/** E2E's switch for its stand-in Link: "oauth", "oauth-lost", "error" or "expired". */
const FAKE_LINK_KEY = "noodle.fake-link";

function stored<T>(key: string): T | null {
	try {
		const raw = window.sessionStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function keep(key: string, value: unknown) {
	try {
		window.sessionStorage.setItem(key, JSON.stringify(value));
	} catch {
		// No storage here (private browsing, say): the server's copy stands in.
	}
}

function forget(key: string) {
	try {
		window.sessionStorage.removeItem(key);
	} catch {
		// Nothing was kept.
	}
}

/** A Link in progress: its token, the page it started on, and the Bank Connection in update mode. */
type StoredLink = { linkToken: string; returnTo: string; connectionId: string | null };

const FAKE_BANK = "First Platypus Bank";

/**
 * E2E's stand-in for Link (AI_MODEL=stub): the fake link token is its own public token, for a
 * bank whose accounts are plaid-fake.ts's. FAKE_LINK_KEY makes it act as a bank that logs the
 * Parent in on its own page (it leaves for /bank/return, where it then finishes; "oauth-lost"
 * also drops what this tab kept, as a different browser would), as one that doesn't respond, or
 * as a link token that expired once.
 */
async function linkWithFake(token: string, options: LinkOptions): Promise<LinkOutcome> {
	const ids = { link_session_id: "fake-link-session", request_id: "fake-request" };
	const act = options.receivedRedirectUri ? null : stored<string>(FAKE_LINK_KEY);
	logLinkEvent(options.mode, "OPEN", ids);
	if (act === "error") {
		const error = { error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_NOT_RESPONDING" };
		logLinkEvent(options.mode, "EXIT", { ...ids, ...error });
		return { kind: "exit", error, institution: FAKE_BANK };
	}
	if (act === "expired") {
		forget(FAKE_LINK_KEY);
		return {
			kind: "exit",
			error: { error_type: "INVALID_INPUT", error_code: "INVALID_LINK_TOKEN" },
			institution: null,
		};
	}
	if (act === "oauth" || act === "oauth-lost") {
		if (act === "oauth-lost") forget(LINK_KEY);
		window.location.assign(`/bank/return?oauth_state_id=fake-${Date.now()}`);
		// The page is leaving: Link finishes on /bank/return.
		return new Promise(() => undefined);
	}
	logLinkEvent(options.mode, "HANDOFF", ids);
	return {
		kind: "linked",
		linked: {
			publicToken: token.replace("link-", "public-"),
			institution: FAKE_BANK,
			institutionId: "ins_fake",
			masks: ["0000", "1111", "3333", "4444", "5555"],
		},
	};
}

/** Opens Link, or E2E's stand-in for it, with the link token. */
const openLink = (setUp: BankConnectionsData["setUp"], token: string, options: LinkOptions) =>
	setUp === "fake" ? linkWithFake(token, options) : linkWithPlaid(token, options);

/**
 * Runs Link from the page the Parent is on: for a new Bank Connection, or to log in to one again
 * (update mode, the same Item). The link token is made now, when the Parent asked, so it's fresh
 * (they last 4 hours, 30 minutes in update mode); if Link still says it's no good, a new one is
 * made and Link reopened, once.
 */
async function linkHere(
	setUp: BankConnectionsData["setUp"],
	connectionId: string | null,
	newAccounts = false,
): Promise<LinkOutcome | { kind: "not-started" }> {
	const returnTo = window.location.pathname;
	let outcome: LinkOutcome | null = null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const started = connectionId
			? await startBankReconnect({ data: { connectionId, returnTo, newAccounts } })
			: await startBankLink({ data: { returnTo } });
		if (!started.ok) return { kind: "not-started" };
		keep(LINK_KEY, { linkToken: started.linkToken, returnTo, connectionId } satisfies StoredLink);
		outcome = await openLink(setUp, started.linkToken, {
			mode: connectionId ? "reconnect" : "connect",
		});
		if (outcome.kind !== "exit" || !linkTokenExpired(outcome.error)) break;
	}
	forget(LINK_KEY);
	return outcome ?? { kind: "not-started" };
}

/** A bank the Household seems to have connected already, with what Link just handed back for it. */
type DuplicateOffer = BankDuplicate & { linked: Linked };

type Connected =
	| ConnectBankResult
	| { ok: false; reason: "closed" }
	| { ok: false; reason: "exit"; message: string }
	| { ok: false; reason: "duplicate"; duplicate: DuplicateOffer };

/**
 * Link's onSuccess, wherever it happens (the page, or /bank/return): unless the Household has this
 * bank and these accounts already, exchanges the public token for a Bank Connection that waits
 * for Choose Accounts. `anyway` skips the check, once the Parent has said it's a different login.
 */
async function connectLinked(linked: Linked, anyway = false): Promise<Connected> {
	if (!anyway) {
		const duplicate = await checkBankDuplicate({
			data: {
				institutionId: linked.institutionId,
				institution: linked.institution,
				masks: linked.masks,
			},
		});
		if (duplicate) return { ok: false, reason: "duplicate", duplicate: { ...duplicate, linked } };
	}
	return connectBank({
		data: {
			connectionId: ulid(),
			publicToken: linked.publicToken,
			institution: linked.institution,
			institutionId: linked.institutionId,
		},
	});
}

type Reconnected =
	| { kind: "done" | "closed" | "gone" | "not-set-up" }
	| { kind: "exit"; message: string };

/**
 * Logs in to a Bank Connection's Item again, in Link's update mode: nothing to exchange. With
 * `newAccounts`, Link also asks which of the login's accounts to share, which is how one opened
 * since is added.
 */
async function reconnectBank(
	setUp: BankConnectionsData["setUp"],
	connectionId: string,
	institution: string | null,
	newAccounts = false,
): Promise<Reconnected> {
	const outcome = await linkHere(setUp, connectionId, newAccounts);
	if (outcome.kind === "not-started") return { kind: "not-set-up" };
	if (outcome.kind === "exit") {
		const message = linkExitMessage(outcome.error, outcome.institution ?? institution, true);
		return message ? { kind: "exit", message } : { kind: "closed" };
	}
	const finished = await finishBankReconnect({ data: { connectionId, newAccounts } });
	return { kind: finished.ok ? "done" : "gone" };
}

const RECONNECTED = "Reconnected. Bringing in new Transactions.";

/** Connect or Reconnect with Plaid not set up here, or refusing this copy's keys. */
const PLAID_NOT_SET_UP =
	"Connecting a bank needs Plaid, which isn’t set up for this copy of Noodle yet.";

/** What /bank/return leaves for the page the Parent started on. */
type AfterReturn = { result?: Connected; toast?: string; problem?: string };

/**
 * Finishes a Link that left for the bank's own page or app (OAuth) and came back to /bank/return:
 * Link is made again with the same link token and the address the bank came back to, and ends as
 * it would have on the page (connectLinked, or a reconnect done). Answers the page to go back to,
 * which picks up from there (useConnectBank); null when there's no Link in progress to finish.
 */
export async function finishBankReturn(
	setUp: BankConnectionsData["setUp"],
): Promise<string | null> {
	if (!setUp || !new URLSearchParams(window.location.search).has("oauth_state_id")) return null;
	const link = stored<StoredLink>(LINK_KEY) ?? (await getBankLinkSession());
	if (!link) return null;
	const reconnecting = link.connectionId !== null;
	const outcome = await openLink(setUp, link.linkToken, {
		mode: reconnecting ? "reconnect" : "connect",
		receivedRedirectUri: window.location.href,
	});
	forget(LINK_KEY);
	let after: AfterReturn = {};
	if (outcome.kind === "exit") {
		const problem = linkExitMessage(outcome.error, outcome.institution, reconnecting);
		if (problem) after = { problem };
	} else if (link.connectionId) {
		const finished = await finishBankReconnect({ data: { connectionId: link.connectionId } });
		if (finished.ok) after = { toast: RECONNECTED };
	} else {
		after = { result: await connectLinked(outcome.linked) };
	}
	keep(AFTER_KEY, after);
	return link.returnTo;
}

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
	// Why Link closed without connecting, in plain words, with a way forward.
	const [problem, setProblem] = useState<string | null>(null);
	// The bank just linked is one the Household has: reconnect it instead?
	const [duplicate, setDuplicate] = useState<DuplicateOffer | null>(null);
	const refresh = () =>
		void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });

	function settle(result: Connected) {
		if (result.ok) {
			refresh();
			setChoosing(result.connectionId);
		} else if (result.reason === "duplicate") {
			setDuplicate(result.duplicate);
		} else if (result.reason === "exit") {
			setProblem(result.message);
		} else if (result.reason === "connected-already") {
			toast("That bank is connected already.");
		} else if (result.reason === "no-accounts") {
			toast("There’s no checking, savings, card or loan account there to connect.");
		} else if (result.reason === "not-set-up") {
			toast(PLAID_NOT_SET_UP, { tone: "error" });
			refresh();
		}
	}

	const connect = useMutation({
		/** `anyway` is a bank already linked, which the Parent says is a different login. */
		mutationFn: async (anyway?: Linked): Promise<Connected> => {
			if (anyway) return connectLinked(anyway, true);
			const outcome = await linkHere(setUp, null);
			if (outcome.kind === "not-started") return { ok: false, reason: "not-set-up" };
			if (outcome.kind === "linked") return connectLinked(outcome.linked);
			const message = linkExitMessage(outcome.error, outcome.institution);
			return message ? { ok: false, reason: "exit", message } : { ok: false, reason: "closed" };
		},
		onMutate: () => setProblem(null),
		onSuccess: settle,
		onError: () =>
			toast("Couldn’t connect the bank.", {
				tone: "error",
				action: { label: "Retry", onClick: () => connect.mutate(undefined) },
			}),
	});

	// Back from the bank's own page by /bank/return: carry on as if Link had finished here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once, on arriving
	useEffect(() => {
		const after = stored<AfterReturn>(AFTER_KEY);
		if (!after) return;
		forget(AFTER_KEY);
		if (after.toast) {
			toast(after.toast);
			refresh();
		}
		if (after.problem) setProblem(after.problem);
		if (after.result) settle(after.result);
	}, []);

	return {
		plaid,
		setUp,
		connections,
		start: () => connect.mutate(undefined),
		pending: connect.isPending,
		choose: setChoosing,
		chooseSheet: (
			<>
				{problem ? (
					<Alert variant="destructive" role="alert">
						<AlertDescription>
							{problem}{" "}
							<Button
								variant="link"
								size="inline"
								className="text-current hover:text-current"
								disabled={connect.isPending}
								onClick={() => connect.mutate(undefined)}
							>
								Try again
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				<ChooseAccountsSheet
					connection={connections.find((c) => c.id === choosing) ?? null}
					onClose={() => setChoosing(null)}
				/>
				<DuplicateSheet
					offer={duplicate}
					setUp={setUp}
					onClose={() => setDuplicate(null)}
					onAnyway={(linked) => {
						setDuplicate(null);
						connect.mutate(linked);
					}}
					onProblem={setProblem}
				/>
			</>
		),
	};
}

/**
 * The bank a Parent just linked is one the Household has connected already (the same institution
 * and accounts): offers to log in to that one again, which keeps its Item, rather than making a
 * second (ADR-0017). A Parent whose login really is another one (their own, at the same bank) can
 * say so and carry on.
 */
function DuplicateSheet({
	offer,
	setUp,
	onClose,
	onAnyway,
	onProblem,
}: {
	offer: DuplicateOffer | null;
	setUp: BankConnectionsData["setUp"];
	onClose: () => void;
	onAnyway: (linked: Linked) => void;
	onProblem: (message: string) => void;
}) {
	const queryClient = useQueryClient();
	const bank = offer?.institution ?? offer?.linked.institution ?? "that bank";
	const reconnect = useMutation({
		mutationFn: async (): Promise<Reconnected> =>
			offer ? reconnectBank(setUp, offer.connectionId, offer.institution) : { kind: "closed" },
		onSuccess: (result) => {
			if (result.kind === "done") toast(RECONNECTED);
			if (result.kind === "exit") onProblem(result.message);
			if (result.kind === "not-set-up") onProblem(PLAID_NOT_SET_UP);
			void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			onClose();
		},
		onError: () => {
			onProblem(`${bank} didn’t take the login. Try again, or upload a statement for now.`);
			onClose();
		},
	});
	return (
		<Sheet open={offer !== null} onOpenChange={(open) => (open ? null : onClose())}>
			{offer ? (
				<SheetContent>
					<SheetHeader
						title={`You’ve already connected ${bank}. Reconnect it instead?`}
						description={`Reconnecting logs in to the ${bank} connection you have, and keeps its Accounts and everything on them. Connecting it a second time would use another of Noodle’s Plaid connections and bring its Transactions in twice.`}
					/>
					<SheetFooter>
						<SheetCancel />
						<Button
							type="button"
							variant="ghost"
							disabled={reconnect.isPending}
							onClick={() => onAnyway(offer.linked)}
						>
							It’s a different login
						</Button>
						<Button type="button" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
							Reconnect {bank}
						</Button>
					</SheetFooter>
				</SheetContent>
			) : null}
		</Sheet>
	);
}

export type ConnectBank = ReturnType<typeof useConnectBank>;

/** What connecting does, in a sentence or two: said before a Parent connects. */
export const CONNECT_EXPLAINED =
	"Noodle reads balances and about a year of Transactions, and can’t move money. You pick the Accounts you already have, so nothing counts twice; each bank login uses one of Noodle’s 10 Plaid connections.";

export function BankConnections({ bank }: { bank: ConnectBank }) {
	const hydrated = useHydrated();
	const { setUp, plaid, connections } = bank;
	const realBank = useSuspenseQuery(bankConnectionsQuery()).data.connectRealBank === true;
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
			{realBank ? (
				<Alert>
					<AlertDescription>
						<strong className="font-medium text-foreground">Connect your real bank.</strong> Until
						now Noodle used Plaid’s practice bank, so those Bank Connections have ended. Your
						Accounts and their Transactions are all still here. Connect your real bank to bring in
						new ones.
					</AlertDescription>
				</Alert>
			) : null}
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
				// Sized by its own width, not the screen's: in the 360px list pane beside an Account
				// the text and button stack, so the paragraph isn't squeezed to two words a line.
				<Card className="@container p-(--card-pad)">
					<div className="grid gap-3 @lg:flex @lg:items-center [&>button]:w-full @lg:[&>button]:w-auto">
						<div className="flex flex-1 items-start gap-3 text-sm @lg:items-center">
							<Tile>
								<Landmark />
							</Tile>
							<p className="text-muted-foreground">
								{plaid ? CONNECT_EXPLAINED : PLAID_NOT_SET_UP}
							</p>
						</div>
						{connectButton(false)}
					</div>
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
		case "disconnected":
			return {
				text: `Access was turned off at the bank, so nothing new comes in. Its Accounts and Transactions are still here. To bring in new ones, connect ${connection.institution ?? "the bank"} again.`,
				failed: true,
			};
		default:
			return {
				text: connection.lastImportedAt
					? `Up to date · ${lastUpdatedText(connection.lastImportedAt.getTime(), Date.now())}`
					: "Up to date",
				failed: false,
			};
	}
};

/**
 * Disconnecting a bank (#61), asked first: what stays (its Accounts, with their Transactions and
 * statements, kept by hand) and what goes (new Transactions coming in on their own).
 */
export function DisconnectBankDialog({
	institution,
	onDone,
	onCancel,
	connectionId,
}: {
	connectionId: string;
	institution: string | null;
	onDone?: () => void;
	onCancel: () => void;
}) {
	const queryClient = useQueryClient();
	const bankName = institution ?? "the bank";
	const disconnect = useMutation({
		mutationFn: () => disconnectBank({ data: { connectionId } }),
		onSuccess: (result) => {
			if (!result.ok) {
				toast(
					result.reason === "bank"
						? `${institution ?? "The bank"} didn’t answer, so it’s still connected. Try again in a little while.`
						: "Couldn’t disconnect it. Try again.",
					{ tone: "error" },
				);
				return;
			}
			toast(`${institution ?? "The bank"} is disconnected. Its Accounts are kept by hand now.`);
			void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
			onDone?.();
		},
		onError: () => toast("Couldn’t disconnect it. Try again.", { tone: "error" }),
	});
	return (
		<Confirm
			confirmLabel={`Disconnect ${bankName}`}
			onConfirm={() => disconnect.mutate()}
			onCancel={onCancel}
		>
			Its Accounts stay, with their Transactions and statements, and are kept by hand from now on.
			Noodle stops bringing in new Transactions from {bankName}, so add new spending with Quick Add
			or by uploading a statement. You can connect {bankName} again later.
		</Confirm>
	);
}

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
	// Why a reconnect didn't go through, in plain words. The Reconnect button stays beside it.
	const [failed, setFailed] = useState<string | null>(null);
	const [disconnecting, setDisconnecting] = useState(false);
	const bankName = connection.institution ?? "The bank";
	const statementsGo =
		connection.accounts.length === 1 ? "its Account’s page" : "each Account’s page";

	const reconnect = useMutation({
		// Update mode: Link logs in to the same Item, so there's nothing to exchange.
		mutationFn: () => reconnectBank(setUp, connection.id, connection.institution),
		onSuccess: (result) => {
			if (result.kind === "done") toast(RECONNECTED);
			if (result.kind === "not-set-up") setFailed(PLAID_NOT_SET_UP);
			if (result.kind === "exit") {
				setFailed(
					`${result.message} Statements go on ${statementsGo}: what the bank brings in later isn’t added twice.`,
				);
			} else if (result.kind !== "closed") {
				void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			}
		},
		// Said in the row, with what to do meanwhile: a toast went before the Parent could read it.
		onError: () =>
			setFailed(
				`${bankName} didn’t take the login. Try again, or upload a statement on ${statementsGo} for now: what the bank brings in later isn’t added twice.`,
			),
		onMutate: () => setFailed(null),
	});

	// The bank says this login has an account Noodle hasn't asked about (Plaid's
	// NEW_ACCOUNTS_AVAILABLE): Link in update mode asks which accounts to share, then Choose
	// Accounts says which Account the new one is.
	const offersNew =
		connection.newAccounts && (connection.status === "ready" || connection.status === "failed");
	const addNew = useMutation({
		mutationFn: () => reconnectBank(setUp, connection.id, connection.institution, true),
		onSuccess: (result) => {
			if (result.kind === "exit") setFailed(result.message);
			if (result.kind === "not-set-up") setFailed(PLAID_NOT_SET_UP);
			if (result.kind === "closed" || result.kind === "exit") return;
			void queryClient.invalidateQueries({ queryKey: bankConnectionsQuery().queryKey });
			if (result.kind === "done") onChoose();
		},
		onError: () => setFailed(`${bankName} didn’t take the login. Try again in a little while.`),
		onMutate: () => setFailed(null),
	});

	const trailing =
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
		) : offersNew && setUp ? (
			<Button
				type="button"
				size="sm"
				disabled={!hydrated || addNew.isPending}
				onClick={() => addNew.mutate()}
				aria-label={`Add the new account at ${connection.institution ?? "the bank"}`}
			>
				Add it
			</Button>
		) : connection.status === "disconnected" ? null : setUp ? (
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
		) : null;

	return (
		<ListRow
			stackTrailing
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
						<span className={cn(status.failed && "text-over")} suppressHydrationWarning>
							{status.text}
						</span>
					</span>
					{count > 0 ? (
						<span className="basis-full">{connection.accounts.map((a) => a.name).join(", ")}</span>
					) : null}
					{connection.brought.transactions > 0 ? (
						<span className="basis-full">
							Brought in{" "}
							{connection.brought.transactions === 1
								? "1 Transaction"
								: `${connection.brought.transactions} Transactions`}
							{connection.brought.matched > 0
								? ` · ${connection.brought.matched} Matched to Quick Adds`
								: ""}
							{connection.brought.inReview > 0 ? (
								<>
									{" · "}
									<Link to="/review" className="font-medium text-foreground underline">
										{connection.brought.inReview} waiting in Review
									</Link>
								</>
							) : null}
						</span>
					) : null}
					{offersNew ? (
						<span className="basis-full font-medium text-foreground">
							{bankName} has a new account. Add it?
						</span>
					) : null}
					{failed ? (
						<Alert variant="destructive" role="alert" className="basis-full">
							<AlertDescription>{failed}</AlertDescription>
						</Alert>
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
				<div className="flex flex-wrap items-center gap-2">
					{trailing}
					{setUp ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={!hydrated}
							onClick={() => setDisconnecting(true)}
							aria-label={`Disconnect ${connection.institution ?? "the bank"}`}
						>
							<Unplug />
							Disconnect
						</Button>
					) : null}
					{disconnecting ? (
						<DisconnectBankDialog
							connectionId={connection.id}
							institution={connection.institution}
							onCancel={() => setDisconnecting(false)}
						/>
					) : null}
				</div>
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
				<Button
					variant="link"
					size="inline"
					className="text-current hover:text-current"
					onClick={() => void choices.refetch()}
				>
					Try again
				</Button>
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
					<OptionSelect
						id={`${id}-${account.externalId}`}
						value={pickOf(account)}
						aria-invalid={duplicate || undefined}
						onValueChange={(value) =>
							setPicks((was) => ({ ...was, [account.externalId]: value as Pick }))
						}
						choices={[
							...account.options.map((option) => ({
								value: `pair:${option.id}`,
								label: `Same as ${option.name}`,
							})),
							{ value: "new", label: "Add as a new Account" },
							{ value: "leave-out", label: "Leave it out" },
						]}
					/>
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
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={save.isPending || open.length === 0}>
					{connection.status === "choosing" ? "Start bringing them in" : "Save"}
				</Button>
			</SheetFooter>
		</form>
	);
}
