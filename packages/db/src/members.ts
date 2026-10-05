import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./index";
import { buckets, members } from "./schema";

// The Household's Members. Children are added by a Parent and never sign in. Every query is
// scoped by household_id; Member IDs from the client are only ever used together with it.

/** A Member as the app shows them. A Parent has no `color` until they pick one. */
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
 * Renames or recolours a Parent, who changes only themself (issue 104): `byParentId` is the Parent
 * signed in, and a change to anyone else is refused (false, nothing written). `bucketRenames`
 * carries their Personal Allowance along when it still has a name made from theirs
 * ("Alex’s Personal Allowance"); one they named themself is left alone.
 */
export async function updateParent(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		byParentId: string;
		name?: string;
		color?: number;
		bucketRenames?: { from: string; to: string }[];
	},
): Promise<boolean> {
	if (input.memberId !== input.byParentId) return false;
	const own = and(
		eq(members.id, input.memberId),
		eq(members.householdId, input.householdId),
		eq(members.kind, "parent"),
	);
	const found = await db.select({ id: members.id }).from(members).where(own).limit(1);
	if (found.length === 0) return false;
	const set = {
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.color === undefined ? {} : { color: input.color }),
	};
	if (Object.keys(set).length === 0) return true;
	const renames = (input.name === undefined ? [] : (input.bucketRenames ?? [])).filter(
		({ from, to }) => from !== to,
	);
	await db.batch([
		db.update(members).set(set).where(own),
		...renames.map(({ from, to }) =>
			db
				.update(buckets)
				.set({ name: to })
				.where(
					and(
						eq(buckets.householdId, input.householdId),
						eq(buckets.ownerMemberId, input.memberId),
						eq(buckets.name, from),
					),
				),
		),
	]);
	return true;
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
