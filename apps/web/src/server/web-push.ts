// Sends a Web Push message with nothing but Web Crypto, so it runs on Workers: the payload is
// encrypted for the subscription (RFC 8291, `aes128gcm`, what Apple, Google, and Mozilla's push
// services all accept) and the request is signed with the app's VAPID key (RFC 8292).

/** A device's push subscription: its push service URL, public key, and auth secret (base64url). */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/**
 * The app's VAPID key pair, base64url: the public key as an uncompressed P-256 point (what the
 * browser subscribes with) and the private key's 32-byte scalar. `subject` is a `mailto:` or
 * `https:` contact for push services.
 */
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export type PushOptions = {
	/** Seconds the push service keeps it for an offline device. */
	ttl: number;
	urgency?: "very-low" | "low" | "normal" | "high";
	/** A newer message with the same topic replaces this one while it's still undelivered. */
	topic?: string;
};

const encoder = new TextEncoder();

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array | ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

/** A P-256 key as JWK, from an uncompressed public point and, for a private key, its scalar. */
function p256Jwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
	if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
		throw new Error("Expected an uncompressed P-256 public key");
	}
	return {
		kty: "EC",
		crv: "P-256",
		x: bytesToBase64Url(publicKey.slice(1, 33)),
		y: bytesToBase64Url(publicKey.slice(33, 65)),
		...(privateKey ? { d: bytesToBase64Url(privateKey) } : {}),
	};
}

async function hkdf(
	salt: Uint8Array<ArrayBuffer>,
	secret: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
	length: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt, info },
		key,
		length * 8,
	);
	return new Uint8Array(bits);
}

/** The record size in the `aes128gcm` header; one record holds any Web Push payload. */
const RECORD_SIZE = 4096;

/**
 * Encrypts a payload for one subscription (RFC 8291). A fresh salt and sender key pair are made
 * each time; tests pass fixed ones to check against the RFC's worked example.
 */
export async function encryptForPush(
	plaintext: Uint8Array<ArrayBuffer>,
	target: Pick<PushTarget, "p256dh" | "auth">,
	fixed?: { salt: Uint8Array<ArrayBuffer>; senderKeys: CryptoKeyPair },
): Promise<Uint8Array<ArrayBuffer>> {
	const receiverPublic = base64UrlToBytes(target.p256dh);
	const authSecret = base64UrlToBytes(target.auth);
	const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
	const senderKeys =
		fixed?.senderKeys ??
		((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
			"deriveBits",
		])) as CryptoKeyPair);
	const senderPublic = new Uint8Array(await crypto.subtle.exportKey("raw", senderKeys.publicKey));
	const receiverKey = await crypto.subtle.importKey(
		"jwk",
		p256Jwk(receiverPublic),
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	const sharedSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: receiverKey },
			senderKeys.privateKey,
			256,
		),
	);
	const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic);
	const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
	const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
	// A single, last record: the payload then the 0x02 delimiter, with no padding.
	const record = concat(plaintext, new Uint8Array([2]));
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record);
	const header = new Uint8Array(21);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, RECORD_SIZE);
	header[20] = senderPublic.length;
	return concat(header, senderPublic, new Uint8Array(ciphertext));
}

/** How long a VAPID signature holds; push services refuse more than 24 hours. */
const VAPID_VALID_SECONDS = 12 * 60 * 60;

/** The `Authorization` header for a push service (RFC 8292): a signed JWT and the public key. */
export async function vapidAuthorization(
	endpoint: string,
	vapid: VapidKeys,
	now = new Date(),
): Promise<string> {
	const publicKey = base64UrlToBytes(vapid.publicKey);
	const signingKey = await crypto.subtle.importKey(
		"jwk",
		p256Jwk(publicKey, base64UrlToBytes(vapid.privateKey)),
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	const part = (value: object) => bytesToBase64Url(encoder.encode(JSON.stringify(value)));
	const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
		aud: new URL(endpoint).origin,
		exp: Math.floor(now.getTime() / 1000) + VAPID_VALID_SECONDS,
		sub: vapid.subject,
	})}`;
	// Web Crypto signs ECDSA as r‖s, which is exactly the JWS ES256 form.
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		signingKey,
		encoder.encode(unsigned),
	);
	return `vapid t=${unsigned}.${bytesToBase64Url(signature)}, k=${vapid.publicKey}`;
}

/**
 * Sends one Web Push message and returns the push service's response: 201 once it has it; 404
 * or 410 when the subscription is gone for good; 429 or 5xx to try again later.
 */
export async function sendWebPush(
	target: PushTarget,
	payload: string,
	vapid: VapidKeys,
	options: PushOptions,
): Promise<Response> {
	const body = await encryptForPush(encoder.encode(payload), target);
	const headers = new Headers({
		Authorization: await vapidAuthorization(target.endpoint, vapid),
		"Content-Encoding": "aes128gcm",
		"Content-Type": "application/octet-stream",
		TTL: String(options.ttl),
	});
	if (options.urgency) headers.set("Urgency", options.urgency);
	if (options.topic) headers.set("Topic", options.topic);
	return fetch(target.endpoint, { method: "POST", headers, body });
}
