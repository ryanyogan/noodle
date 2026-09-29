import { env } from "cloudflare:workers";
import {
	type BankConnectionSummary,
	type BankProvider,
	type Household,
	loadBankConnections,
	type Member,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { monotonicFactory, ulid } from "ulid";
import { z } from "zod";
import { type ConnectInstitutionResult, connectInstitution } from "./bank-connect";
import {
	type BankConnectionProvider,
	type BankHandoff,
	BankProviderError,
} from "./bank-connection";
import type { BankImportMessage } from "./bank-import-workflow";
import { type BankSetup, bankSetup, setUpProviders } from "./bank-setup";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";
import { INVALID_SETUP_TOKEN, SETUP_TOKEN_CLAIMED } from "./simplefin";

// Bank Connections for the screen: a Parent links their institution in Plaid Link, with a link
// token made here, and hands back Link's public token; or pastes a setup token from their
// SimpleFIN Bridge. The Worker exchanges either for the credential (sealed before it's stored),
// creates an Account for each checking, savings, card and loan account there, and puts the Bank
// Connection on the ingest Queue for the Import Workflow to bring in its Transactions. Plaid's
// secrets and the credential never leave the Worker.

export type { BankConnectionSummary };

export type BankConnectionsData = {
	/** How Bank Connections are set up here: null when the secrets aren't there. */
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

/** A link token for Plaid Link, for this Household. */
export const startBankLink = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<StartBankLinkResult> => {
		const plaid = bankSetup()?.plaid;
		if (!plaid) return { ok: false, reason: "not-set-up" };
		return { ok: true, linkToken: await plaid.linkToken(context.household.id) };
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
		if (!setup?.plaid) return { ok: false, reason: "not-set-up" };
		return connectAndImport(setup, setup.plaid.provider, context, data.connectionId, {
			token: data.publicToken,
			institution: data.institution,
		});
	});

export type ConnectSimplefinResult =
	| ConnectBankResult
	/** Not a setup token, or one claimed already: a SimpleFIN setup token can be claimed only once. */
	| { ok: false; reason: "invalid-token" | "claimed" };

/** Claims a SimpleFIN setup token, creates the Accounts it reaches, and starts their Import. */
export const connectSimplefin = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ connectionId: ulidSchema, setupToken: z.string().trim().min(1).max(2000) }))
	.handler(async ({ data, context }): Promise<ConnectSimplefinResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		try {
			return await connectAndImport(setup, setup.simplefin, context, data.connectionId, {
				token: data.setupToken,
				institution: null,
			});
		} catch (error) {
			if (!(error instanceof BankProviderError)) throw error;
			if (error.code === INVALID_SETUP_TOKEN) return { ok: false, reason: "invalid-token" };
			if (error.code === SETUP_TOKEN_CLAIMED) return { ok: false, reason: "claimed" };
			throw error;
		}
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
