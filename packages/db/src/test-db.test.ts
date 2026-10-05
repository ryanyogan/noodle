import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { commitments, transactions } from "./schema";
import { testDb } from "./test-db";

// The test database refuses what D1 would get wrong without saying so: a batch reading two
// columns of one name.

describe("a batch reading two columns of one name", () => {
	const joined = (db: ReturnType<typeof testDb>) =>
		db.select({ id: transactions.id, commitmentId: commitments.id }).from(transactions);

	it("is refused, naming the column", async () => {
		const db = testDb();
		const twins = joined(db).innerJoin(commitments, eq(commitments.id, transactions.commitmentId));
		await expect(db.batch([twins])).rejects.toThrow(/two columns named "id"/);
	});

	it("is read outside a batch, where rows come back as arrays", async () => {
		const db = testDb();
		await expect(
			joined(db).innerJoin(commitments, eq(commitments.id, transactions.commitmentId)),
		).resolves.toEqual([]);
	});

	it("is read once the twin has a name of its own", async () => {
		const db = testDb();
		const named = db
			.select({
				id: transactions.id,
				commitmentId: sql<string>`${commitments.id}`.as("commitment_id"),
			})
			.from(transactions)
			.innerJoin(commitments, eq(commitments.id, transactions.commitmentId));
		await expect(db.batch([named])).resolves.toEqual([[]]);
	});
});
