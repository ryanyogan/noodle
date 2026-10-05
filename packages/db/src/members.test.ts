import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createHouseholdForParent, type Db, listMembers, listParents, updateParent } from "./index";
import { buckets, members } from "./schema";
import { testDb } from "./test-db";

const householdId = "01HOUSEHOLD0000000000000000";
let db: Db;

const named = async (id: string) => (await listMembers(db, householdId)).find((m) => m.id === id);
const bucketName = async (id: string) =>
	(await db.select({ name: buckets.name }).from(buckets).where(eq(buckets.id, id)))[0]?.name;

async function personalAllowance(id: string, ownerMemberId: string, name: string) {
	await db.insert(buckets).values({
		id,
		householdId,
		name,
		color: 2,
		position: 1,
		fromMonth: "2026-10",
		ownerMemberId,
	});
}

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
});

describe("a Parent's own name and colour (issue 104)", () => {
	it("a Parent has no colour until they pick one", async () => {
		expect(await named("alex")).toMatchObject({ name: "Alex", kind: "parent", color: null });
	});

	it("a Parent renames and recolours themself", async () => {
		const saved = await updateParent(db, {
			householdId,
			memberId: "alex",
			byParentId: "alex",
			name: "Alexandra",
			color: 5,
		});
		expect(saved).toBe(true);
		expect(await named("alex")).toMatchObject({ name: "Alexandra", color: 5 });
		expect((await listParents(db, householdId)).map((p) => p.name)).toEqual(["Alexandra", "Sam"]);
		// Still the same sign-in.
		expect((await listParents(db, householdId))[0]?.clerkUserId).toBe("clerk-alex");
	});

	it("a colour alone leaves the name, and a name alone leaves the colour", async () => {
		await updateParent(db, { householdId, memberId: "sam", byParentId: "sam", color: 3 });
		expect(await named("sam")).toMatchObject({ name: "Sam", color: 3 });
		await updateParent(db, { householdId, memberId: "sam", byParentId: "sam", name: "Samira" });
		expect(await named("sam")).toMatchObject({ name: "Samira", color: 3 });
	});

	it("the other Parent is refused, and nothing changes", async () => {
		const saved = await updateParent(db, {
			householdId,
			memberId: "alex",
			byParentId: "sam",
			name: "Not Alex",
			color: 7,
		});
		expect(saved).toBe(false);
		expect(await named("alex")).toMatchObject({ name: "Alex", color: null });
	});

	it("a Parent of another Household, or a Child, is refused", async () => {
		await db
			.insert(members)
			.values({ id: "maya", householdId, kind: "child", name: "Maya", color: 1 });
		expect(
			await updateParent(db, { householdId, memberId: "maya", byParentId: "maya", name: "M" }),
		).toBe(false);
		expect(
			await updateParent(db, {
				householdId: "another",
				memberId: "alex",
				byParentId: "alex",
				name: "Elsewhere",
			}),
		).toBe(false);
		expect(await named("maya")).toMatchObject({ name: "Maya" });
		expect(await named("alex")).toMatchObject({ name: "Alex" });
	});

	it("their Personal Allowance follows when it's still named after them, and only theirs", async () => {
		await personalAllowance("alex-pa", "alex", "Alex’s Personal Allowance");
		await personalAllowance("sam-pa", "sam", "Alex’s Personal Allowance");
		await updateParent(db, {
			householdId,
			memberId: "alex",
			byParentId: "alex",
			name: "Alexandra",
			bucketRenames: [{ from: "Alex’s Personal Allowance", to: "Alexandra’s Personal Allowance" }],
		});
		expect(await bucketName("alex-pa")).toBe("Alexandra’s Personal Allowance");
		expect(await bucketName("sam-pa")).toBe("Alex’s Personal Allowance");
	});

	it("a Personal Allowance they named themself is left alone", async () => {
		await personalAllowance("alex-pa", "alex", "Fun money");
		await updateParent(db, {
			householdId,
			memberId: "alex",
			byParentId: "alex",
			name: "Alexandra",
			bucketRenames: [{ from: "Alex’s Personal Allowance", to: "Alexandra’s Personal Allowance" }],
		});
		expect(await bucketName("alex-pa")).toBe("Fun money");
	});
});
