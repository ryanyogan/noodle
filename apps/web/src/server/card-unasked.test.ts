import {
	addAccount,
	addCommitment,
	createHouseholdForParent,
	type Db,
	importStatement,
	linkCommitment,
	loadGoals,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { type Cents, cardKeptUnasked, cardPaymentIsSpending, type DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { loadCardPaymentCards } from "./transfers";

// A card with no answer to "How do its purchases get into Noodle?" (issue 141): an older app, or
// an add queued offline, still makes one. It is "not asked": "It's a card payment" treats it by
// the documented rule (cardPaymentIsSpending), and the Accounts page asks about it.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const today: DayKey = "2026-10-07";
const filedIn = { id: "bill", name: "Apple Card bill" };

let db: Db;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	// As the add-card server function passes it on when the client sent no answer.
	await addAccount(db, {
		householdId,
		accountId: "apple",
		name: "Apple Card",
		kind: "credit-card",
		balanceCents: 0 as Cents,
		balanceId: "apple-balance",
		createdByMemberId: parentId,
		purchases: undefined,
	});
});

/** A Commitment of this month's Plan pays the card down. */
async function paidDown() {
	await addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "bill",
		name: "Apple Card bill",
		month: "2026-10",
		amountCents: 30_000 as Cents,
		cadence: "monthly",
		dueDate: "2026-10-05",
	});
	expect(
		await linkCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "bill",
			accountId: "apple",
			carriedBalance: false,
			month: "2026-10",
			today,
		}),
	).toEqual({ ok: true });
}

/** A statement's purchases came in for the card lately: Noodle follows it. */
async function followed() {
	let next = 0;
	await importStatement(db, {
		householdId,
		importId: "statement",
		accountId: "apple",
		source: "csv",
		fileName: null,
		fileKey: null,
		lines: [{ date: "2026-10-02", amount: -4_000, description: "COSTCO WHSE #1042", bankId: null }],
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId: () => `row-${++next}`,
	});
}

const offered = () => loadCardPaymentCards(db, householdId, today);
const asked = async () => {
	const { accounts } = await loadGoals(db, viewer);
	const card = accounts.find((account) => account.id === "apple");
	if (!card) throw new Error("no card");
	expect(card.purchases).toBeNull();
	return cardKeptUnasked(card, today);
};

describe("a card nobody has said how its purchases get in for", () => {
	it("not followed, nothing paying it down: its payment is a Transfer, and the Accounts page asks", async () => {
		expect(await offered()).toEqual([
			{ id: "apple", name: "Apple Card", kept: null, commitment: null },
		]);
		expect(cardPaymentIsSpending(null, false)).toBe(false);
		expect(await asked()).toBe(true);
	});

	it("not followed, a Commitment pays it down: its payment is the spending, filed there, and the Accounts page asks", async () => {
		await paidDown();
		expect(await offered()).toEqual([
			{ id: "apple", name: "Apple Card", kept: null, commitment: filedIn },
		]);
		expect(cardPaymentIsSpending(null, true)).toBe(true);
		expect(await asked()).toBe(true);
	});

	it("followed, nothing paying it down: read as kept by its statements, a Transfer, and not asked about", async () => {
		await followed();
		expect(await offered()).toEqual([
			{ id: "apple", name: "Apple Card", kept: "statements", commitment: null },
		]);
		expect(await asked()).toBe(false);
	});

	it("followed, a Commitment pays it down: still a Transfer, never filed in the Commitment too", async () => {
		await paidDown();
		await followed();
		expect(await offered()).toEqual([
			{ id: "apple", name: "Apple Card", kept: "statements", commitment: null },
		]);
		expect(await asked()).toBe(false);
	});
});
