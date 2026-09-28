// Prints a new VAPID key pair for Web Push, as .dev.vars lines: `bun scripts/vapid-keys.ts
// [mailto:you@example.com] >> .dev.vars`. For production, put each value with
// `wrangler secret put`. Changing the keys ends every existing subscription: each Parent turns
// Nudges on again.

const toBase64Url = (bytes: ArrayBuffer) =>
	Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
	"sign",
	"verify",
])) as CryptoKeyPair;
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(
	`VAPID_PUBLIC_KEY=${toBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey))}`,
);
console.log(`VAPID_PRIVATE_KEY=${d}`);
console.log(`VAPID_SUBJECT=${process.argv[2] ?? "mailto:nudges@example.com"}`);
