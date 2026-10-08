import { type Cents, type PaySchedule, parsePaySchedule, type SalaryPay } from "@noodle/domain";
import { and, eq } from "drizzle-orm";
import type { Db } from "./index";
import { members } from "./schema";

// How each Parent is paid (issue 156): on a salary, with what one paycheck usually is and when it
// is due, or hourly / pay that varies, which is nothing stored. Either Parent says it for either,
// as either says whose pay a line of Income is.

/** A Parent and how they are paid; `pay` is null for hourly, or pay that varies. */
export type ParentPay = { memberId: string; name: string; pay: SalaryPay | null };

/** The schedule as stored: null for none, or for one this version can't read. */
function storedSchedule(value: string | null): PaySchedule | null {
	if (value === null) return null;
	try {
		return parsePaySchedule(JSON.parse(value));
	} catch {
		return null;
	}
}

/** The Household's Parents, in the order they joined, each with how they are paid. */
export async function loadParentPay(db: Db, householdId: string): Promise<ParentPay[]> {
	const rows = await db
		.select({
			memberId: members.id,
			name: members.name,
			paycheckCents: members.paycheckCents,
			paySchedule: members.paySchedule,
		})
		.from(members)
		.where(and(eq(members.householdId, householdId), eq(members.kind, "parent")))
		.orderBy(members.createdAt, members.id);
	return rows.map(({ memberId, name, paycheckCents, paySchedule }) => {
		const schedule = storedSchedule(paySchedule);
		const salaried = schedule !== null && paycheckCents !== null && paycheckCents > 0;
		return {
			memberId,
			name,
			pay: salaried ? { paycheck: paycheckCents as Cents, schedule } : null,
		};
	});
}

/**
 * Says how a Parent is paid: on a salary (`pay`), or hourly / pay that varies (null). Refused
 * unless the Member is one of the Household's Parents.
 */
export async function setParentPay(
	db: Db,
	input: { householdId: string; memberId: string; pay: SalaryPay | null },
): Promise<{ ok: boolean }> {
	const { pay } = input;
	const changed = await db
		.update(members)
		.set({
			paycheckCents: pay ? pay.paycheck : null,
			paySchedule: pay ? JSON.stringify(pay.schedule) : null,
		})
		.where(
			and(
				eq(members.id, input.memberId),
				eq(members.householdId, input.householdId),
				eq(members.kind, "parent"),
			),
		)
		.returning({ id: members.id });
	return { ok: changed.length > 0 };
}
