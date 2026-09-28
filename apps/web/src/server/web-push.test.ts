import { describe, expect, test } from "vitest";
import { base64UrlToBytes, bytesToBase64Url, encryptForPush, vapidAuthorization } from "./web-push";

const jwkFor = (publicKey: string, privateKey: string): JsonWebKey => {
	const point = base64UrlToBytes(publicKey);
	return {
		kty: "EC",
		crv: "P-256",
		x: bytesToBase64Url(point.slice(1, 33)),
		y: bytesToBase64Url(point.slice(33)),
		d: privateKey,
	};
};

describe("encryptForPush", () => {
	test("matches RFC 8291's worked example", async () => {
		// RFC 8291 §5 and Appendix A.
		const sender = {
			publicKey:
				"BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
			privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
		};
		const algorithm = { name: "ECDH", namedCurve: "P-256" };
		const senderKeys = {
			publicKey: await crypto.subtle.importKey(
				"raw",
				base64UrlToBytes(sender.publicKey),
				algorithm,
				true,
				[],
			),
			privateKey: await crypto.subtle.importKey(
				"jwk",
				jwkFor(sender.publicKey, sender.privateKey),
				algorithm,
				false,
				["deriveBits"],
			),
		};
		const body = await encryptForPush(
			new TextEncoder().encode("When I grow up, I want to be a watermelon"),
			{
				p256dh:
					"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
				auth: "BTBZMqHH6r4Tts7J_aSIgg",
			},
			{ salt: base64UrlToBytes("DGv6ra1nlYgDCS1FRnbzlw"), senderKeys },
		);
		expect(bytesToBase64Url(body)).toBe(
			"DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
				"mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
				"pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
		);
	});
});

describe("vapidAuthorization", () => {
	test("signs a JWT for the push service's origin that the public key verifies", async () => {
		const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])) as CryptoKeyPair;
		const publicKey = bytesToBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
		const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
		const now = new Date("2026-09-15T12:00:00Z");
		const header = await vapidAuthorization(
			"https://web.push.apple.com/QGuQyavXutnMH-long-token",
			{ publicKey, privateKey: d ?? "", subject: "mailto:nudges@example.com" },
			now,
		);

		const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
		expect(key).toBe(publicKey);
		const [head, claims, signature] = (token ?? "").split(".");
		const decode = (part = "") => JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
		expect(decode(head)).toEqual({ typ: "JWT", alg: "ES256" });
		expect(decode(claims)).toEqual({
			aud: "https://web.push.apple.com",
			exp: now.getTime() / 1000 + 12 * 60 * 60,
			sub: "mailto:nudges@example.com",
		});
		const verified = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			pair.publicKey,
			base64UrlToBytes(signature ?? ""),
			new TextEncoder().encode(`${head}.${claims}`),
		);
		expect(verified).toBe(true);
	});
});
