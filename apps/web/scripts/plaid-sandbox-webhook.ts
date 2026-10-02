// Dev only: makes Plaid's Sandbox send the app real, signed webhooks, to try the deployed
// /webhooks/plaid (or a tunnel to a local one) end to end. It only ever talks to
// sandbox.plaid.com, so it can't touch a production Item whatever keys it's given.
//
//   PLAID_CLIENT_ID=... PLAID_SECRET=<sandbox secret> PLAID_ACCESS_TOKEN=access-sandbox-... \
//     bun scripts/plaid-sandbox-webhook.ts fire SYNC_UPDATES_AVAILABLE
//     bun scripts/plaid-sandbox-webhook.ts fire NEW_ACCOUNTS_AVAILABLE
//     bun scripts/plaid-sandbox-webhook.ts reset-login        # then ITEM/ERROR ITEM_LOGIN_REQUIRED
//     bun scripts/plaid-sandbox-webhook.ts new-item https://noodle.yogan.dev/webhooks/plaid
//
// `fire` takes any code /sandbox/item/fire_webhook knows (SYNC_UPDATES_AVAILABLE,
// NEW_ACCOUNTS_AVAILABLE, LOGIN_REPAIRED, PENDING_DISCONNECT, USER_PERMISSION_REVOKED,
// USER_ACCOUNT_REVOKED, ERROR, ...). `new-item` makes a Sandbox Item whose webhooks go to the
// address given and prints its access token, for when there's no Sandbox Bank Connection's token
// to hand: the app won't know that Item, so it answers 200 and logs "ignored", which still
// proves the signature check against Plaid's real key. Watch the outcome with `wrangler tail`.

const HOST = "https://sandbox.plaid.com";

const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;
if (!clientId || !secret) {
	console.error("Set PLAID_CLIENT_ID and PLAID_SECRET (the Sandbox secret).");
	process.exit(1);
}

async function plaid(
	path: string,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const response = await fetch(`${HOST}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"PLAID-CLIENT-ID": clientId as string,
			"PLAID-SECRET": secret as string,
		},
		body: JSON.stringify(body),
	});
	const json = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		console.error(`${path}: ${json.error_code} ${json.error_message}`);
		process.exit(1);
	}
	return json;
}

function accessToken(): string {
	const token = process.env.PLAID_ACCESS_TOKEN;
	if (!token?.startsWith("access-sandbox-")) {
		console.error("Set PLAID_ACCESS_TOKEN to a Sandbox Item's access token (access-sandbox-...).");
		process.exit(1);
	}
	return token;
}

const [command, argument] = process.argv.slice(2);

if (command === "fire" && argument) {
	const answer = await plaid("/sandbox/item/fire_webhook", {
		access_token: accessToken(),
		webhook_code: argument,
	});
	console.log(`Fired ${argument}: ${JSON.stringify(answer)}`);
} else if (command === "reset-login") {
	const answer = await plaid("/sandbox/item/reset_login", { access_token: accessToken() });
	console.log(`Login reset (the Item now needs a reconnect): ${JSON.stringify(answer)}`);
} else if (command === "new-item" && argument?.startsWith("https://")) {
	const made = await plaid("/sandbox/public_token/create", {
		institution_id: "ins_109508",
		initial_products: ["transactions"],
		options: { webhook: argument },
	});
	const exchanged = await plaid("/item/public_token/exchange", { public_token: made.public_token });
	console.log(`Item ${exchanged.item_id}, sending webhooks to ${argument}.`);
	console.log(`PLAID_ACCESS_TOKEN=${exchanged.access_token}`);
} else {
	console.error(
		"Usage: plaid-sandbox-webhook.ts fire <WEBHOOK_CODE> | reset-login | new-item <https webhook URL>",
	);
	process.exit(1);
}
