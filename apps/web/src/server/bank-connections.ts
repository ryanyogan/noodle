import { env } from "cloudflare:workers";
import { type BankConnectionSummary, loadBankConnections } from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { monotonicFactory, ulid } from "ulid";
import { z } from "zod";
import { type ConnectInstitutionResult, connectInstitution } from "./bank-connect";
import type { BankImportMessage } from "./bank-import-workflow";
import { type BankSetup, bankSetup } from "./bank-setup";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Bank Connections for the screen: a Parent links their institution in Plaid Link, with a link
// token made here, and hands back Link's public token. The Worker exchanges it for the
// credential (sealed before it's stored), creates an Account for each checking, savings, card and
// loan account there, and puts the Bank Connection on the ingest Queue for the Import Workflow to
// bring in its Transactions. Plaid's secrets and the credential never leave the Worker.

export type { BankConnectionSummary };

export type BankConnectionsData = {
	/** How Bank Connections are set up here: null when the secrets aren't there. */
	setUp: BankSetup["mode"] | null;
	connections: BankConnectionSummary[];
};

/** The Household's Bank Connections, and whether a Parent can connect one. */
export const getBankConnections = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		async ({ context }): Promise<BankConnectionsData> => ({
			setUp: bankSetup()?.mode ?? null,
			connections: await loadBankConnections(getDb(), context.household.id),
		}),
	);

export type StartBankLinkResult =
	| { ok: true; linkToken: string }
	| { ok: false; reason: "not-set-up" };

/** A link token for Plaid Link, for this Household. */
export const startBankLink = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<StartBankLinkResult> => {
		const setup = bankSetup();
		if (!setup) return { ok: false, reason: "not-set-up" };
		return { ok: true, linkToken: await setup.linkToken(context.household.id) };
	});

export type ConnectBankResult = ConnectInstitutionResult | { ok: false; reason: "not-set-up" };

/** Connects the institution a Parent linked, creates its Accounts, and starts its Import. */
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
		const { household, parent } = context;
		const { connectionId } = data;
		const result = await connectInstitution(
			{ db: getDb(), provider: setup.provider, key: await setup.key(), newId: monotonicFactory() },
			{
				householdId: household.id,
				memberId: parent.id,
				connectionId,
				handoff: { token: data.publicToken, institution: data.institution },
			},
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
	});
