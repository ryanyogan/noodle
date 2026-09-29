const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A ULID-shaped ID that is always the same for the same `key`, so something delivered twice (a
 * capture the Shortcut retries, a redelivered email) is written once.
 */
export async function idFor(key: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
	);
	// A ULID's first character is at most 7; the rest are any of the 32.
	return [...digest.slice(0, 26)]
		.map((byte, i) => CROCKFORD[i === 0 ? byte % 8 : byte % 32])
		.join("");
}
