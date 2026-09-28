import { eq } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { type Household, households, type Member, members } from "./schema";

export type Db = DrizzleD1Database<typeof schema>;
export type { Household, Member };

export function createDb(d1: D1Database): Db {
	return drizzle(d1, { schema });
}

export type ParentMembership = { household: Household; parent: Member };

/** The Household a signed-in Parent belongs to, or null if they have none yet. */
export async function findMembershipByClerkUser(
	db: Db,
	clerkUserId: string,
): Promise<ParentMembership | null> {
	const rows = await db
		.select({ household: households, parent: members })
		.from(members)
		.innerJoin(households, eq(households.id, members.householdId))
		.where(eq(members.clerkUserId, clerkUserId))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Creates a Household with the signed-in user as its first Parent, atomically.
 * Idempotent per Parent: if they already belong to a Household, that one is returned.
 */
export async function createHouseholdForParent(
	db: Db,
	input: {
		clerkUserId: string;
		householdId: string;
		householdName: string;
		timeZone: string;
		parentId: string;
		parentName: string;
	},
): Promise<ParentMembership> {
	const existing = await findMembershipByClerkUser(db, input.clerkUserId);
	if (existing) return existing;
	try {
		await db.batch([
			db.insert(households).values({
				id: input.householdId,
				name: input.householdName,
				timeZone: input.timeZone,
			}),
			db.insert(members).values({
				id: input.parentId,
				householdId: input.householdId,
				kind: "parent",
				name: input.parentName,
				clerkUserId: input.clerkUserId,
			}),
		]);
	} catch (error) {
		// A concurrent request may have won the unique clerk_user_id race; the batch rolled back.
		const raced = await findMembershipByClerkUser(db, input.clerkUserId);
		if (raced) return raced;
		throw error;
	}
	const created = await findMembershipByClerkUser(db, input.clerkUserId);
	if (!created) throw new Error("Household was not created");
	return created;
}
