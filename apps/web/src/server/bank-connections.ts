import { env } from "cloudflare:workers";
import {
	type BankConnectionSummary,
	type BankProvider,
	type Household,
	loadBankConnections,
	loadBankConnectionToImport,
	type Member,
	markBankConnectionReconnected,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { monotonicFactory, ulid } from "ulid";
import { z } from "zod";
import { type ConnectInstitutionResult, connectInstitution } from "./bank-connect";
import type { BankConnectionProvider, BankHandoff } from "./bank-connection";
import { openCredential } from "./bank-credential";
import type { BankImportMessage } from "./bank-import-workflow";
import { type BankSetup, bankSetup, setUpProviders } from "./bank-setup";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { PLAID_WEBHOOK_PATH } from "./plaid-webhook";
import { ulidSchema } from "./schemas";

// Bank Connections for the screen: a Parent links their institution in Plaid Link, with a link
// token made here, and hands back Link's public token. The Worker exchanges it for the Item's
// access token, the credential (sealed before it's stored), creates an Account for each checking,
// savings, card and loan account there, and puts the Bank Connection on the ingest Queue for the
// Import Workflow to bring in its Transactions. Each link token names the app's webhook, so Plaid
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
};

/** The Household's Bank Connections, and whether a Parent can connect one. */
export const getBankConnections = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<BankConnectionsData> => {
		const setup = bankSetup();
		return {
			setUp: setup?.mode ?? null,
			providers: setup ? setUpProviders(setup) : [],
			connections: await loadBankConnections(getDb(), context.household.id),
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

/** A link token for Plaid Link, for this Household. */
export const startBankLink = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<StartBankLinkResult> => {
		const plaid = bankSetup()?.plaid;
		if (!plaid) return { ok: false, reason: "not-set-up" };
		return {
			ok: true,
			linkToken: await plaid.linkToken(context.household.id, { webhook: webhookUrl() }),
		};
	});

export type StartBankReconnectResult =
	| { ok: true; linkToken: string }
	| { ok: false; reason: "not-set-up" | "not-found" };

/** A link token for Plaid Link in update mode: a Parent logs in to a Bank Connection's Item again. */
export const startBankReconnect = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<StartBankReconnectResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		const householdId = context.household.id;
		const connection = await loadBankConnectionToImport(getDb(), householdId, data.connectionId);
		if (!connection) return { ok: false, reason: "not-found" };
		const accessToken = await openCredential(await setup.key(), connection.credential, {
			householdId,
			connectionId: connection.id,
		});
		return {
			ok: true,
			linkToken: await setup.plaid.linkToken(householdId, { webhook: webhookUrl(), accessToken }),
		};
	});

/** A Parent logged in again: the Bank Connection is ready, and syncs at once. */
export const finishBankReconnect = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const { household } = context;
		const ready = await markBankConnectionReconnected(getDb(), household.id, data.connectionId);
		if (!ready) return { ok: false };
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

/** Connects the institution a Parent linked in Plaid Link, creates its Accounts, and starts its Import. */
export const connectBank = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			connectionId: ulidSchema,
			publicToken: z.string().trim().min(1).max(200),
			institution: z.string().trim().min(1).max(100).nullable(),
		}),
	)
	.handler(async ({ data, context }): Promise<ConnectBankResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		return connectAndImport(setup, setup.plaid.provider, context, data.connectionId, {
			token: data.publicToken,
			institution: data.institution,
		});
	});

/** Connects through the provider and, once its Accounts are made, puts its Import on the Queue. */
async function connectAndImport(
	setup: BankSetup,
	provider: BankConnectionProvider,
	{ household, parent }: { household: Household; parent: Pick<Member, "id"> },
	connectionId: string,
	handoff: BankHandoff,
): Promise<ConnectInstitutionResult> {
	const result = await connectInstitution(
		{ db: getDb(), provider, key: await setup.key(), newId: monotonicFactory() },
		{ householdId: household.id, memberId: parent.id, connectionId, handoff },
	);
	if (!result.ok) return result;
	await notifyHousehold(household.id, ["goals", "bank-connections"]);
	const message: BankImportMessage = {
		kind: "bank-import",
		householdId: household.id,
		connectionId,
		timeZone: household.timeZone,
		runId: ulid(),
	};
	await env.INGEST_QUEUE.send(message);
	return { ok: true, accounts: result.accounts };
}
