import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBankConnection,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	loadGoals,
	setAccountWhose,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

// Whose an Account is (issue 144, ADR-0059): a Parent's, or the Household's while nobody has said.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };

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
		{ id: "cori", householdId, kind: "parent", name: "Cori", clerkUserId: "clerk-cori" },
		{ id: "kid", householdId, kind: "child", name: "Kid", color: 1 },
	]);
});

const add = (accountId: string, whoseMemberId?: string | null, household = householdId) =>
	addAccount(db, {
		householdId: household,
		accountId,
		name: accountId,
		kind: "checking",
		balanceCents: null,
		balanceId: `balance-${accountId}`,
		createdByMemberId: household === householdId ? parentId : "other-parent",
		whoseMemberId,
	});

const whose = async () =>
	Object.fromEntries((await loadGoals(db, viewer)).accounts.map((a) => [a.id, a.whose]));

describe("whose an Account is", () => {
	it("is the Household's until a Parent says, and a Parent's when added as theirs", async () => {
		await add("joint");
		await add("mine", parentId);
		await add("hers", "cori");
		expect(await whose()).toEqual({ joint: null, mine: parentId, hers: "cori" });
	});

	it("is not taken from a Child, or a Member of another Household, when adding", async () => {
		await add("kids", "kid");
		await add("strangers", "other-parent");
		expect(await whose()).toEqual({ kids: null, strangers: null });
	});

	it("is changed by a Parent, to either Parent or back to the Household", async () => {
		await add("joint");
		expect(
			await setAccountWhose(db, { householdId, accountId: "joint", whoseMemberId: "cori" }),
		).toEqual({ ok: true });
		expect(await whose()).toEqual({ joint: "cori" });
		expect(
			await setAccountWhose(db, { householdId, accountId: "joint", whoseMemberId: null }),
		).toEqual({ ok: true });
		expect(await whose()).toEqual({ joint: null });
	});

	it("refuses a Child, another Household's Member, and another Household's Account", async () => {
		await add("joint");
		await add("theirs", null, "other-household");
		for (const input of [
			{ householdId, accountId: "joint", whoseMemberId: "kid" },
			{ householdId, accountId: "joint", whoseMemberId: "other-parent" },
			{ householdId, accountId: "theirs", whoseMemberId: parentId },
			{ householdId, accountId: "theirs", whoseMemberId: null },
		]) {
			expect(await setAccountWhose(db, input)).toEqual({ ok: false });
		}
		expect(await whose()).toEqual({ joint: null });
	});

	it("is the Parent who connected the bank for an Account it adds, and unchanged for one it pairs with", async () => {
		await add("joint");
		await add("hers", "cori");
		await addBankConnection(db, {
			householdId,
			connectionId: "conn-1",
			provider: "plaid",
			externalId: "item-1",
			institution: "First Platypus Bank",
			credential: "v1:sealed",
			createdByMemberId: parentId,
		});
		const bank = (externalId: string) => ({
			externalId,
			name: externalId,
			mask: null,
			kind: "checking" as const,
			balance: 100,
		});
		await chooseBankAccounts(db, {
			householdId,
			connectionId: "conn-1",
			createdByMemberId: parentId,
			choices: [
				{ account: bank("a"), balanceId: "b-a", choice: { kind: "add", accountId: "added" } },
				{ account: bank("b"), balanceId: "b-b", choice: { kind: "pair", accountId: "joint" } },
				{ account: bank("c"), balanceId: "b-c", choice: { kind: "pair", accountId: "hers" } },
			],
		});
		expect(await whose()).toEqual({ joint: null, hers: "cori", added: parentId });
	});
});
