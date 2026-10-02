import { env } from "cloudflare:workers";
import {
	type BankConnectionToMove,
	loadBankConnectionsToMoveWebhook,
	saveBankWebhookUrl,
} from "@noodle/db";
import { BankProviderError } from "./bank-connection";
import { openCredential } from "./bank-credential";
import { bankSetup } from "./bank-setup";
import { getDb } from "./db";
import { PLAID_WEBHOOK_PATH, sameText } from "./plaid-webhook";

// Moving Items' webhooks to the app's address (#71). An Item sends webhooks to the address its
// link token named when it was made, so Items made while the app was at another address (its
// workers.dev one) still send them there. This tells Plaid the current address
// (/item/webhook/update) for every Bank Connection not recorded as sending to it, and records it;
// Plaid answers each with ITEM/WEBHOOK_UPDATE_ACKNOWLEDGED, which plaid-webhook.ts records too.
// Safe to run again: one already moved isn't asked about twice, and one that failed is tried again.
//
// It's run by hand, once, after a deploy:
//   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://noodle.yogan.dev/admin/plaid/move-webhooks
// ADMIN_TOKEN is a Worker secret (`openssl rand -base64 32`, `wrangler secret put ADMIN_TOKEN`);
// without it the address doesn't exist.

export const PLAID_WEBHOOK_MOVE_PATH = "/admin/plaid/move-webhooks";

export type WebhookMoveDeps = {
	/** The Bank Connections not recorded as sending webhooks to `webhookUrl`. */
	connections: (webhookUrl: string) => Promise<BankConnectionToMove[]>;
	/** A Bank Connection's access token, opened. */
	open: (connection: BankConnectionToMove) => Promise<string>;
	/** Tells Plaid the Item's new address. */
	update: (accessToken: string, webhookUrl: string) => Promise<void>;
	save: (connection: BankConnectionToMove, webhookUrl: string) => Promise<void>;
	log: (line: Record<string, unknown>) => void;
};

/** Moves every Bank Connection's webhooks to `webhookUrl`; one that fails doesn't stop the rest. */
export async function moveBankWebhooks(
	deps: WebhookMoveDeps,
	webhookUrl: string,
): Promise<{ moved: number; failed: number }> {
	let moved = 0;
	let failed = 0;
	for (const connection of await deps.connections(webhookUrl)) {
		try {
			await deps.update(await deps.open(connection), webhookUrl);
			await deps.save(connection, webhookUrl);
			moved++;
			deps.log({ log: "plaid-webhook-move", connection_id: connection.id, outcome: "moved" });
		} catch (error) {
			failed++;
			deps.log({
				log: "plaid-webhook-move",
				connection_id: connection.id,
				outcome: "failed",
				error_code: error instanceof BankProviderError ? error.code : null,
			});
		}
	}
	return { moved, failed };
}

/** The Worker's side, for whoever holds ADMIN_TOKEN. */
export async function handlePlaidWebhookMove(request: Request): Promise<Response> {
	const { ADMIN_TOKEN, APP_ORIGIN } = env as unknown as {
		ADMIN_TOKEN?: string;
		APP_ORIGIN?: string;
	};
	const given = request.headers.get("Authorization") ?? "";
	if (!ADMIN_TOKEN || !sameText(given, `Bearer ${ADMIN_TOKEN}`)) {
		return new Response(null, { status: 404 });
	}
	if (request.method !== "POST") return new Response(null, { status: 405 });
	const setup = bankSetup();
	if (!setup || !APP_ORIGIN?.startsWith("https://")) {
		return Response.json({ error: "Plaid or APP_ORIGIN isn’t set up" }, { status: 409 });
	}
	const db = getDb();
	const result = await moveBankWebhooks(
		{
			connections: (webhookUrl) => loadBankConnectionsToMoveWebhook(db, "plaid", webhookUrl),
			open: async ({ householdId, id, credential }) =>
				openCredential(await setup.key(), credential, { householdId, connectionId: id }),
			update: setup.plaid.updateWebhook,
			save: ({ householdId, id }, webhookUrl) =>
				saveBankWebhookUrl(db, householdId, id, webhookUrl),
			log: (line) => console.log(JSON.stringify(line)),
		},
		`${APP_ORIGIN}${PLAID_WEBHOOK_PATH}`,
	);
	return Response.json(result);
}
