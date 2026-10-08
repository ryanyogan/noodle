import type { Cents, DayKey, SalaryPay } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createHouseholdForParent, type Db, loadParentPay, setParentPay } from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

// How each Parent is paid (issue 156): on a salary, or hourly / pay that varies until one says.

const householdId = "household";
const parentId = "parent";

let db: Db;

beforeEach(async () => {
	db = testDb();
	for (const [id, parent, clerk] of [
		[householdId, parentId, "clerk-user"],
		["other-household", "other-parent", "other-clerk-user"],
	] as const) {
		await createHouseholdForParent(db, {
			clerkUserId: clerk,
			householdId: id,
			householdName: id,
			timeZone: "America/Chicago",
			parentId: parent,
			parentName: parent,
		});
	}
	await db.insert(members).values([
		{ id: "second", householdId, kind: "parent", name: "Second", clerkUserId: "clerk-second" },
		{ id: "kid", householdId, kind: "child", name: "Kid", color: 1 },
	]);
});

const salary: SalaryPay = {
	paycheck: 2_500_00 as Cents,
	schedule: { kind: "twice-a-month", days: [1, 15] },
};
const payOf = async (memberId: string, household = householdId) =>
	(await loadParentPay(db, household)).find((parent) => parent.memberId === memberId)?.pay;

describe("how a Parent is paid", () => {
	it("is hourly, or pay that varies, for every Parent until one says", async () => {
		expect(await loadParentPay(db, householdId)).toEqual([
			{ memberId: parentId, name: parentId, pay: null },
			{ memberId: "second", name: "Second", pay: null },
		]);
	});

	it("keeps a salary: one paycheck and its pay days", async () => {
		expect(await setParentPay(db, { householdId, memberId: parentId, pay: salary })).toEqual({
			ok: true,
		});
		expect(await payOf(parentId)).toEqual(salary);
		expect(await payOf("second")).toBeNull();
		const [row] = await db.select().from(members).where(eq(members.id, parentId));
		expect(row?.paySchedule).toBe('{"kind":"twice-a-month","days":[1,15]}');
		expect(row?.paycheckCents).toBe(2_500_00);
	});

	it("lets one Parent say how the other is paid", async () => {
		const monthly: SalaryPay = {
			paycheck: 4_000_00 as Cents,
			schedule: { kind: "monthly", day: 31 },
		};
		await setParentPay(db, { householdId, memberId: "second", pay: monthly });
		expect(await payOf("second")).toEqual(monthly);
	});

	it("goes back to hourly, or pay that varies", async () => {
		await setParentPay(db, { householdId, memberId: parentId, pay: salary });
		await setParentPay(db, { householdId, memberId: parentId, pay: null });
		expect(await payOf(parentId)).toBeNull();
		const [row] = await db.select().from(members).where(eq(members.id, parentId));
		expect(row).toMatchObject({ paySchedule: null, paycheckCents: null });
	});

	it("refuses a Child, and a Parent of another Household", async () => {
		expect(await setParentPay(db, { householdId, memberId: "kid", pay: salary })).toEqual({
			ok: false,
		});
		expect(await setParentPay(db, { householdId, memberId: "other-parent", pay: salary })).toEqual({
			ok: false,
		});
		expect(await payOf("other-parent", "other-household")).toBeNull();
	});

	it("reads a schedule it doesn't know as no salary", async () => {
		await db
			.update(members)
			.set({
				paycheckCents: 1_000_00,
				paySchedule: '{"kind":"every-four-weeks","anchor":"2026-10-02"}',
			})
			.where(eq(members.id, parentId));
		expect(await payOf(parentId)).toBeNull();
		await db.update(members).set({ paySchedule: "not json" }).where(eq(members.id, parentId));
		expect(await payOf(parentId)).toBeNull();
	});

	it("keeps every two weeks and weekly with the pay day they are counted from", async () => {
		for (const kind of ["every-two-weeks", "weekly"] as const) {
			const pay: SalaryPay = {
				paycheck: 1_800_00 as Cents,
				schedule: { kind, anchor: "2026-10-02" as DayKey },
			};
			expect(await setParentPay(db, { householdId, memberId: parentId, pay })).toEqual({
				ok: true,
			});
			expect(await payOf(parentId)).toEqual(pay);
		}
	});
});
