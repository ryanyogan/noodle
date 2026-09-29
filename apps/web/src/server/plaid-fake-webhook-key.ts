// The fake Plaid's webhook signing key (a P-256 JWK), for tests and E2E only: plaid-fake.ts hands
// out its public half as /webhook_verification_key/get would, and tests sign webhooks with the
// private half. It has no imports so E2E can load it as it is.

export const FAKE_WEBHOOK_KEY_ID = "fake-webhook-key";

export const FAKE_WEBHOOK_PRIVATE_KEY: JsonWebKey = {
	kty: "EC",
	crv: "P-256",
	x: "vX05fKVcGeXpCnCykdBP70b5vWWBgA_6Shq3IlGGWXg",
	y: "OnIgrkD44Uaykm-x0wCe2AmUKn4SMsze1bSLCfbNliI",
	d: "nKofT50PBhYZmvVawZsH971rFYhJ2cwvjgz_U5UyD7M",
};

const base64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");

/** A Plaid-Verification JWT for `body`, as Plaid signs one, issued at `issuedAt`. */
export async function signFakeWebhook(body: string, issuedAt = new Date()): Promise<string> {
	const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
	const header = encode({ alg: "ES256", kid: FAKE_WEBHOOK_KEY_ID, typ: "JWT" });
	const payload = encode({
		iat: Math.floor(issuedAt.getTime() / 1000),
		request_body_sha256: [...new Uint8Array(digest)]
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join(""),
	});
	const key = await crypto.subtle.importKey(
		"jwk",
		FAKE_WEBHOOK_PRIVATE_KEY,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}
