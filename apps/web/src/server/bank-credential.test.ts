import { describe, expect, it } from "vitest";
import {
	credentialKey,
	openCredential,
	sealCredential,
	TEST_CREDENTIAL_KEY,
} from "./bank-credential";

const context = { householdId: "household-1", connectionId: "connection-1" };

describe("Bank Connection credentials", () => {
	it("seals a credential so only the same key, Household and Bank Connection open it", async () => {
		const key = await credentialKey(TEST_CREDENTIAL_KEY);
		const sealed = await sealCredential(key, "access-sandbox-123", context);
		expect(sealed).toMatch(/^v1:/);
		expect(sealed).not.toContain("access-sandbox-123");
		expect(await openCredential(key, sealed, context)).toBe("access-sandbox-123");

		await expect(
			openCredential(key, sealed, { ...context, connectionId: "connection-2" }),
		).rejects.toThrow();
		await expect(
			openCredential(key, sealed, { ...context, householdId: "household-2" }),
		).rejects.toThrow();
		const other = await credentialKey(btoa("another-key-of-thirty-two-bytes!"));
		await expect(openCredential(other, sealed, context)).rejects.toThrow();
	});

	it("seals the same credential differently each time", async () => {
		const key = await credentialKey(TEST_CREDENTIAL_KEY);
		const [a, b] = await Promise.all([
			sealCredential(key, "access", context),
			sealCredential(key, "access", context),
		]);
		expect(a).not.toBe(b);
	});

	it("refuses a key that isn't 32 bytes", async () => {
		await expect(credentialKey(btoa("too short"))).rejects.toThrow(/32 bytes/);
	});
});
