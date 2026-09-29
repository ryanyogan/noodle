// A Bank Connection's credential (Plaid's access token) is sealed before it's stored: AES-GCM with
// the Worker's BANK_CONNECTION_KEY secret (32 random bytes, base64), bound to its Household and
// Bank Connection so a sealed credential copied onto another row won't open. Only the Worker ever
// opens it, to read from the provider; no screen reads it at all (loadBankConnections).

/** Which sealing this is, so the key or scheme can change without losing stored credentials. */
const VERSION = "v1";

export type CredentialContext = { householdId: string; connectionId: string };

/** The key from BANK_CONNECTION_KEY's base64; throws unless it's 32 bytes. */
export async function credentialKey(base64: string): Promise<CryptoKey> {
	const bytes = Uint8Array.from(atob(base64.trim()), (char) => char.charCodeAt(0));
	if (bytes.length !== 32) throw new Error("BANK_CONNECTION_KEY must be 32 bytes, base64");
	return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** A fixed key for tests and E2E's fakes: their credentials open nothing real. */
export const TEST_CREDENTIAL_KEY = btoa("noodle-test-bank-connection-key!");

const additionalData = ({ householdId, connectionId }: CredentialContext) =>
	new TextEncoder().encode(`${householdId}|${connectionId}`);

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function sealCredential(
	key: CryptoKey,
	credential: string,
	context: CredentialContext,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: additionalData(context) },
		key,
		new TextEncoder().encode(credential),
	);
	const out = new Uint8Array(iv.length + sealed.byteLength);
	out.set(iv);
	out.set(new Uint8Array(sealed), iv.length);
	return `${VERSION}:${toBase64(out)}`;
}

/** The credential in the clear; throws if it was sealed with another key or for another row. */
export async function openCredential(
	key: CryptoKey,
	sealed: string,
	context: CredentialContext,
): Promise<string> {
	const [version, body] = sealed.split(":");
	if (version !== VERSION || !body) throw new Error("Not a sealed Bank Connection credential");
	const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
	const opened = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: additionalData(context) },
		key,
		bytes.slice(12),
	);
	return new TextDecoder().decode(opened);
}
