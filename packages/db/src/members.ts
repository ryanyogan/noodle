import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./index";
import { members } from "./schema";

// The Household's Members. Children are added by a Parent and never sign in. Every query is
// scoped by household_id; Member IDs from the client are only ever used together with it.

/** A Member as the app shows them. `color` is set only for Children. */
export type MemberSummary = {
	id: string;
	name: string;
	kind: "parent" | "child";
	color: number | null;
	/** Removed Children stay listed so Transactions For them can still name them. */
	removed: boolean;
};

/** Every Member, removed Children included, in the order they joined. */
export async function listMembers(db: Db, householdId: string): Promise<MemberSummary[]> {
	const rows = await db
		.select({
			id: members.id,
			name: members.name,
			kind: members.kind,
			color: members.color,
			removedAt: members.removedAt,
		})
		.from(members)
		.where(eq(members.householdId, householdId))
		.orderBy(members.createdAt, members.id);
	return rows.map(({ removedAt, ...member }) => ({ ...member, removed: removedAt !== null }));
}

/** Adds a Child. Idempotent per `memberId`: a retry leaves the first attempt's Child as it was. */
export async function addChild(
	db: Db,
	input: { householdId: string; memberId: string; name: string; color: number },
): Promise<void> {
	await db
		.insert(members)
		.values({
			id: input.memberId,
			householdId: input.householdId,
			kind: "child",
			name: input.name,
			color: input.color,
		})
		.onConflictDoNothing({ target: members.id });
}

/** Guards a write to only land on one of the Household's Children still in it. */
const ownChild = (householdId: string, memberId: string) =>
	and(
		eq(members.id, memberId),
		eq(members.householdId, householdId),
		eq(members.kind, "child"),
		isNull(members.removedAt),
	);

/** Renames or recolours a Child. */
export async function updateChild(
	db: Db,
	input: { householdId: string; memberId: string; name?: string; color?: number },
): Promise<void> {
	const set = {
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.color === undefined ? {} : { color: input.color }),
	};
	if (Object.keys(set).length === 0) return;
	await db.update(members).set(set).where(ownChild(input.householdId, input.memberId));
}

/**
 * Removes a Child from the Household. Transactions already For them keep it, so what they cost
 * stays true; they just can't be picked any more.
 */
export async function removeChild(
	db: Db,
	input: { householdId: string; memberId: string },
): Promise<void> {
	await db
		.update(members)
		.set({ removedAt: new Date() })
		.where(ownChild(input.householdId, input.memberId));
}
