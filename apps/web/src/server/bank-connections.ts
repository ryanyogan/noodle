import { env } from "cloudflare:workers";
import {
	type BankConnectionSummary,
	type BankLinkSession,
	type BankProvider,
	clearBankLinkSession,
	loadBankConnections,
	loadBankConnectionsToCompare,
	loadBankConnectionToImport,
	loadBankLinkSession,
	markBankConnectionReconnected,
	markBankNewAccounts,
	saveBankLinkSession,
	saveBankWebhookUrl,
	unpairAccount,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { monotonicFactory, ulid } from "ulid";
import { z } from "zod";
import { BANK_RETURN_PATH, duplicateOf, type KnownBank, sameBank } from "../bank-link";
import {
	applyBankChoices,
	type BankChoice,
	type BankChoices,
	bankChoices,
	type ConnectInstitutionResult,
	connectInstitution,
} from "./bank-connect";
import { openCredential } from "./bank-credential";
import { disconnectBankConnection } from "./bank-disconnect";
import type { BankImportMessage } from "./bank-import-workflow";
import { type BankSetup, bankSetup, providerFor, setUpProviders } from "./bank-setup";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { connectRealBankShown, plaidNotSetUp } from "./plaid";
import { PLAID_WEBHOOK_PATH } from "./plaid-webhook";
import { ulidSchema } from "./schemas";

// Bank Connections for the screen: a Parent links their institution in Plaid Link, with a link
// token made here, and hands back Link's public token. The Worker exchanges it for the Item's
// access token, the credential (sealed before it's stored). The Parent then chooses, for each
// checking, savings, card and loan account there, an Account the Household has already, a new
// one, or neither (ADR-0020), and the Bank Connection goes on the ingest Queue for the Import
// Workflow to bring in its Transactions. Each link token names the app's webhook, so Plaid
// says when there's more. A Bank Connection whose login lapsed is reconnected in Link's update
// mode, for the same Item (a fresh Link would use another of the Trial plan's Items; ADR-0017):
// nothing to exchange, it's simply ready again and synced. Plaid's secrets and the credential
// never leave the Worker.

export type { BankConnectionSummary };

export type BankConnectionsData = {
	/** How Bank Connections are set up here: null when Plaid's secrets aren't there. */
	setUp: BankSetup["mode"] | null;
	/** The providers a Parent can connect through. */
	providers: BankProvider[];
	connections: BankConnectionSummary[];
	/**
	 * Accounts shows "Connect your real bank" once: after the switch to production Plaid
	 * (PLAID_SANDBOX_RETIRED, set with it) ended the practice Bank Connections, until one is
	 * connected again.
	 */
	connectRealBank?: boolean;
};

/** The Household's Bank Connections, and whether a Parent can connect one. */
export const getBankConnections = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<BankConnectionsData> => {
		const setup = bankSetup();
		const connections = await loadBankConnections(getDb(), context.household.id);
		const { PLAID_SANDBOX_RETIRED } = env as unknown as { PLAID_SANDBOX_RETIRED?: string };
		return {
			setUp: setup?.mode ?? null,
			providers: setup ? setUpProviders(setup) : [],
			connections,
			connectRealBank: connectRealBankShown(PLAID_SANDBOX_RETIRED, connections),
		};
	});

export type StartBankLinkResult =
	| { ok: true; linkToken: string }
	| { ok: false; reason: "not-set-up" };

/**
 * Where Plaid posts an Item's webhooks: the app's own address (APP_ORIGIN), or this request's.
 * None over plain HTTP (a local copy), which Plaid couldn't reach anyway.
 */
function webhookUrl(): string | null {
	const origin = (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN ?? getRequestUrl().origin;
	return origin.startsWith("https://") ? `${origin}${PLAID_WEBHOOK_PATH}` : null;
}

/**
 * Where a bank that logs the Parent in on its own page or app (OAuth) sends them back:
 * APP_ORIGIN's /bank/return, which is the address registered under Allowed redirect URIs in
 * Plaid's dashboard. Only when the app is being served from there over HTTPS: a local copy, or a
 * preview at another address, sends none (Plaid would refuse an unregistered one, and a bank
 * would send the Parent to the wrong copy). PLAID_REDIRECT_URI names another registered address,
 * for a local copy trying OAuth against Sandbox.
 */
function redirectUri(): string | null {
	const { APP_ORIGIN, PLAID_REDIRECT_URI } = env as unknown as {
		APP_ORIGIN?: string;
		PLAID_REDIRECT_URI?: string;
	};
	if (PLAID_REDIRECT_URI) return PLAID_REDIRECT_URI;
	if (!APP_ORIGIN?.startsWith("https://") || getRequestUrl().origin !== APP_ORIGIN) return null;
	return `${APP_ORIGIN}${BANK_RETURN_PATH}`;
}

/**
 * The page a Parent started connecting from, to go back to after Link: Accounts, an Account's
 * page or the get-started wizard. Anything else is Accounts.
 */
const returnToSchema = z
	.string()
	.max(100)
	.regex(/^\/(setup|accounts(\/[0-9A-Za-z]{1,40})?)$/)
	.catch("/accounts");

/**
 * A link token Plaid refused because its secret doesn't fit PLAID_ENV (INVALID_API_KEYS) is null:
 * the Parent reads that Plaid isn't set up, never an error page. Anything else is thrown.
 */
function nullIfNotSetUp(error: unknown): null {
	if (!plaidNotSetUp(error)) throw error;
	console.error(JSON.stringify({ log: "plaid-not-set-up", reason: "keys refused for PLAID_ENV" }));
	return null;
}

/** A link token for Plaid Link, for this Household, made when the Parent presses Connect. */
export const startBankLink = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ returnTo: returnToSchema }))
	.handler(async ({ data, context }): Promise<StartBankLinkResult> => {
		const plaid = bankSetup()?.plaid;
		if (!plaid) return { ok: false, reason: "not-set-up" };
		const linkToken = await plaid
			.linkToken(context.household.id, { webhook: webhookUrl(), redirectUri: redirectUri() })
			.catch(nullIfNotSetUp);
		if (!linkToken) return { ok: false, reason: "not-set-up" };
		await saveBankLinkSession(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			linkToken,
			returnTo: data.returnTo,
			connectionId: null,
			now: new Date(),
		});
		return { ok: true, linkToken };
	});

/**
 * The Parent's Link in progress, for /bank/return when the browser it opens in doesn't have it
 * (an installed PWA whose bank came back in Safari, say); null when there's none still usable.
 */
export const getBankLinkSession = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<BankLinkSession | null> =>
			loadBankLinkSession(getDb(), context.household.id, context.parent.id, new Date()),
	);

const linkText = z.string().max(200).nullable();

/**
 * Notes what Plaid Link did, in the Worker's logs: the event, Link's session and request IDs (what
 * Plaid support asks for when a connect fails) and any error's type and code. No account data and
 * no names: the institution is its Plaid ID, the Household its own ID.
 */
export const logBankLinkEvent = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			event: z.enum(["OPEN", "SELECT_INSTITUTION", "ERROR", "EXIT", "HANDOFF"]),
			mode: z.enum(["connect", "reconnect"]),
			linkSessionId: linkText,
			requestId: linkText,
			errorType: linkText,
			errorCode: linkText,
			exitStatus: linkText,
			viewName: linkText,
			institutionId: linkText,
		}),
	)
	.handler(async ({ data, context }): Promise<void> => {
		console.log(
			JSON.stringify({
				log: "plaid-link",
				event: data.event,
				mode: data.mode,
				link_session_id: data.linkSessionId,
				request_id: data.requestId,
				error_type: data.errorType,
				error_code: data.errorCode,
				exit_status: data.exitStatus,
				view_name: data.viewName,
				institution_id: data.institutionId,
				household_id: context.household.id,
			}),
		);
	});

export type BankDuplicate = { connectionId: string; institution: string | null };

/**
 * Whether the bank a Parent just linked is one the Household has connected already: the same
 * institution, with no account there that the Bank Connection doesn't list (by last digits). Asked
 * before Link's public token is exchanged, so the Parent can reconnect the one they have instead
 * of making a second Item (each counts against Plaid's plan, and would bring every line in twice;
 * ADR-0017).
 */
export const checkBankDuplicate = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			institutionId: z.string().trim().max(100).nullable(),
			institution: z.string().trim().max(100).nullable(),
			masks: z.array(z.string().trim().min(1).max(10)).max(100),
		}),
	)
	.handler(async ({ data, context }): Promise<BankDuplicate | null> => {
		const setup = bankSetup();
		if (!setup) return null;
		const householdId = context.household.id;
		const connections = (await loadBankConnectionsToCompare(getDb(), householdId)).filter((c) =>
			sameBank(data, c),
		);
		if (connections.length === 0) return null;
		const key = await setup.key();
		const known = await Promise.all(
			connections.map(async (connection): Promise<KnownBank> => {
				const { id, institution, institutionId } = connection;
				try {
					const credential = await openCredential(key, connection.credential, {
						householdId,
						connectionId: id,
					});
					const accounts = await setup.plaid.provider.accounts(credential);
					return {
						connectionId: id,
						institution,
						institutionId,
						masks: accounts.flatMap((account) => (account.mask ? [account.mask] : [])),
					};
				} catch {
					// It can't be read just now (its login lapsed, most likely): the same bank, and
					// reconnecting is what it needs.
					return { connectionId: id, institution, institutionId, masks: null };
				}
			}),
		);
		const duplicate = duplicateOf(data, known);
		return duplicate
			? { connectionId: duplicate.connectionId, institution: duplicate.institution }
			: null;
	});

export type StartBankReconnectResult =
	| { ok: true; linkToken: string }
	| { ok: false; reason: "not-set-up" | "not-found" };

/** A link token for Plaid Link in update mode: a Parent logs in to a Bank Connection's Item again. */
export const startBankReconnect = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			connectionId: ulidSchema,
			returnTo: returnToSchema,
			/** To add an account opened since: Link asks which of the login's accounts to share. */
			newAccounts: z.boolean().default(false),
		}),
	)
	.handler(async ({ data, context }): Promise<StartBankReconnectResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		const householdId = context.household.id;
		const connection = await loadBankConnectionToImport(getDb(), householdId, data.connectionId);
		// A disconnected one's link is dead: only connecting the bank anew brings it back.
		if (!connection || connection.status === "disconnected")
			return { ok: false, reason: "not-found" };
		const accessToken = await openCredential(await setup.key(), connection.credential, {
			householdId,
			connectionId: connection.id,
		});
		const linkToken = await setup.plaid
			.linkToken(householdId, {
				webhook: webhookUrl(),
				redirectUri: redirectUri(),
				accessToken,
				accountSelection: data.newAccounts,
			})
			.catch(nullIfNotSetUp);
		if (!linkToken) return { ok: false, reason: "not-set-up" };
		await saveBankLinkSession(getDb(), {
			householdId,
			memberId: context.parent.id,
			linkToken,
			returnTo: data.returnTo,
			connectionId: connection.id,
			now: new Date(),
		});
		return { ok: true, linkToken };
	});

/** A Parent logged in again: the Bank Connection is ready, and syncs at once. */
export const finishBankReconnect = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema, newAccounts: z.boolean().default(false) }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const { household } = context;
		await clearBankLinkSession(getDb(), context.parent.id);
		// The Parent has been through Link's account selection: the offer has been answered.
		if (data.newAccounts) {
			await markBankNewAccounts(getDb(), household.id, data.connectionId, false);
		}
		const ready = await markBankConnectionReconnected(getDb(), household.id, data.connectionId);
		if (!ready) {
			// It wasn't waiting for a login (a Parent linked the same bank again and chose to
			// reconnect the one they have): it stays as it was, and is read now all the same.
			const connections = await loadBankConnections(getDb(), household.id);
			if (!connections.some((connection) => connection.id === data.connectionId)) {
				return { ok: false };
			}
		}
		await notifyHousehold(household.id, ["bank-connections"]);
		const message: BankImportMessage = {
			kind: "bank-import",
			householdId: household.id,
			connectionId: data.connectionId,
			timeZone: household.timeZone,
			runId: ulid(),
		};
		await env.INGEST_QUEUE.send(message);
		return { ok: true };
	});

export type ConnectBankResult = ConnectInstitutionResult | { ok: false; reason: "not-set-up" };

/**
 * Connects the institution a Parent linked in Plaid Link. It then waits for the Parent to choose
 * which Accounts its accounts are (chooseBankAccounts), so nothing is brought in yet.
 */
export const connectBank = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			connectionId: ulidSchema,
			publicToken: z.string().trim().min(1).max(200),
			institution: z.string().trim().min(1).max(100).nullable(),
			institutionId: z.string().trim().min(1).max(100).nullable().default(null),
		}),
	)
	.handler(async ({ data, context }): Promise<ConnectBankResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		const { household, parent } = context;
		await clearBankLinkSession(getDb(), parent.id);
		const result = await connectInstitution(
			{ db: getDb(), provider: setup.plaid.provider, key: await setup.key() },
			{
				householdId: household.id,
				memberId: parent.id,
				connectionId: data.connectionId,
				handoff: { token: data.publicToken, institution: data.institution },
				institutionId: data.institutionId,
			},
		);
		if (result.ok) {
			// Where its link token told Plaid to send webhooks, kept so a later move knows (#71).
			const webhook = webhookUrl();
			if (webhook) await saveBankWebhookUrl(getDb(), household.id, data.connectionId, webhook);
			await notifyHousehold(household.id, ["bank-connections"]);
		}
		return result;
	});

export type { BankChoice, BankChoices };

/** A Bank Connection's accounts, with the Account Noodle suggests for each (ADR-0020). */
export const getBankChoices = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<BankChoices | null> => {
		const setup = bankSetup();
		if (!setup) return null;
		const householdId = context.household.id;
		const connection = (await loadBankConnections(getDb(), householdId)).find(
			(c) => c.id === data.connectionId,
		);
		if (!connection) return null;
		const provider = providerFor(setup, connection.provider);
		if (!provider) return null;
		return bankChoices(
			{ db: getDb(), provider, key: await setup.key() },
			{ householdId, connectionId: connection.id, institution: connection.institution },
		);
	});

export type ChooseBankAccountsFnResult =
	| { ok: true; accounts: number; refused: string[] }
	| { ok: false; reason: "not-set-up" | "not-found" };

const choiceSchema = z.object({
	externalId: z.string().trim().min(1).max(200),
	choice: z.union([z.literal("new"), z.literal("leave-out"), z.object({ pair: ulidSchema })]),
});

/**
 * Pairs each of a Bank Connection's accounts with the Account the Parent chose, adds it, or leaves
 * it out, then brings in what's new: the first Import, when it was still choosing.
 */
export const chooseBankAccountsFn = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema, choices: z.array(choiceSchema).min(1).max(50) }))
	.handler(async ({ data, context }): Promise<ChooseBankAccountsFnResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		const { household, parent } = context;
		const result = await applyBankChoices(
			{
				db: getDb(),
				provider: setup.plaid.provider,
				key: await setup.key(),
				newId: monotonicFactory(),
			},
			{
				householdId: household.id,
				memberId: parent.id,
				connectionId: data.connectionId,
				choices: data.choices,
			},
		);
		if (!result.ok) return result;
		await notifyHousehold(household.id, ["goals", "bank-connections"]);
		const message: BankImportMessage = {
			kind: "bank-import",
			householdId: household.id,
			connectionId: data.connectionId,
			timeZone: household.timeZone,
			runId: ulid(),
		};
		await env.INGEST_QUEUE.send(message);
		return { ok: true, accounts: result.accounts, refused: result.refused };
	});

/**
 * Stops bringing an Account in from its Bank Connection (ADR-0020). The Account and everything on
 * it stay; it's kept by hand or by statements again.
 */
export const unpairBankAccount = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ accountId: ulidSchema }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const done = await unpairAccount(getDb(), context.household.id, data.accountId);
		if (done) await notifyHousehold(context.household.id, ["goals", "bank-connections"]);
		return { ok: done };
	});

export type DisconnectBankFnResult =
	| { ok: true }
	| { ok: false; reason: "not-set-up" | "not-found" | "bank" };

/**
 * A Parent disconnects a Bank Connection (#61): removed at the bank, its access token deleted,
 * and its Accounts kept by hand or by statements from now on, with everything on them.
 */
export const disconnectBank = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<DisconnectBankFnResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		const householdId = context.household.id;
		const result = await disconnectBankConnection(
			{
				db: getDb(),
				providerFor: (provider) => providerFor(setup, provider),
				openCredential: async (connection) =>
					openCredential(await setup.key(), connection.credential, {
						householdId,
						connectionId: connection.id,
					}),
			},
			{ householdId, connectionId: data.connectionId },
		);
		if (!result.ok) return result;
		// No activity history to record it in: the Plan's history holds Plan changes only. The
		// Worker's log says who, by ID.
		console.log(
			JSON.stringify({
				log: "bank-disconnected",
				household_id: householdId,
				connection_id: data.connectionId,
				member_id: context.parent.id,
			}),
		);
		await notifyHousehold(householdId, ["goals", "bank-connections"]);
		return { ok: true };
	});
