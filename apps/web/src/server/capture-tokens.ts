import {
	createCaptureToken as createCaptureTokenInDb,
	loadCaptureToken,
	revokeCaptureToken as revokeCaptureTokenInDb,
} from "@noodle/db";
import { type DayKey, dayKeyAt } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { hashCaptureToken, newCaptureToken } from "./capture";
import { getDb } from "./db";
import { householdMiddleware } from "./household";

// Each Parent's own capture token, for the iPhone Shortcut. Only its hash is kept, so the token
// itself is seen once, in what making it returns; the other Parent never sees either.

/** When the viewer's live capture token was made, or null while they have none. */
export const getCaptureToken = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<{ createdOn: DayKey | null }> => {
		// Wrapped: a server function answering a bare null has no body to read.
		const token = await loadCaptureToken(getDb(), context.household.id, context.parent.id);
		return { createdOn: token && dayKeyAt(token.createdAt, context.household.timeZone) };
	});

/** Makes the viewer a new capture token, revoking any they had, and returns it: its only showing. */
export const createCaptureToken = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<{ token: string }> => {
		const token = newCaptureToken();
		await createCaptureTokenInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			tokenId: ulid(),
			tokenHash: await hashCaptureToken(token),
		});
		return { token };
	});

/** Revokes the viewer's capture token: their Shortcut stops working until they make a new one. */
export const revokeCaptureToken = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		await revokeCaptureTokenInDb(getDb(), context.household.id, context.parent.id);
	});
