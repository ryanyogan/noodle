import { testDb } from "@noodle/db/test-db";
import { describe, expect, it } from "vitest";
import { memoryMerchants } from "./categorize-model";
import {
	RELEARN_BATCH,
	rebuildMerchantIndex,
	relearnBatches,
	relearnMerchants,
} from "./merchant-rebuild";

// The merchant index is built again after a snapshot is restored (#78, ADR-0035). Which merchants
// and Buckets come from the rows is tested in @noodle/db (merchant-rebuild.test.ts).

const learned = [
	{ merchant: "corner bakery", bucketId: "groceries" },
	{ merchant: "hardware store", bucketId: "home" },
];

describe("building the merchant index again", () => {
	it("teaches it each merchant's Bucket, for that Household only", async () => {
		const index = memoryMerchants();
		expect(await relearnMerchants(index, "h1", learned)).toBe(2);
		const found = await index.nearest("h1", ["corner bakery", "hardware store"]);
		expect(found.get("corner bakery")?.bucketId).toBe("groceries");
		expect(found.get("hardware store")?.bucketId).toBe("home");
		expect((await index.nearest("h2", ["corner bakery"])).size).toBe(0);
	});

	it("changes nothing when run again, and replaces what the index knew before", async () => {
		const index = memoryMerchants();
		await index.learn("h1", "corner bakery", "a bucket the restore removed");
		await relearnMerchants(index, "h1", learned);
		await relearnMerchants(index, "h1", learned);
		expect(index.size()).toBe(2);
		expect((await index.nearest("h1", ["corner bakery"])).get("corner bakery")?.bucketId).toBe(
			"groceries",
		);
	});

	it("goes a batch at a time, every merchant once", () => {
		const many = Array.from({ length: RELEARN_BATCH * 2 + 5 }, (_, i) => ({
			merchant: `merchant ${i}`,
			bucketId: "b",
		}));
		const batches = relearnBatches(many);
		expect(batches.map((batch) => batch.length)).toEqual([RELEARN_BATCH, RELEARN_BATCH, 5]);
		expect(batches.flat()).toEqual(many);
		expect(relearnBatches([])).toEqual([]);
	});

	it("learns nothing for a Household that taught it nothing", async () => {
		const index = memoryMerchants();
		expect(await rebuildMerchantIndex({ db: testDb(), merchants: index }, "nobody")).toBe(0);
		expect(index.size()).toBe(0);
	});
});
