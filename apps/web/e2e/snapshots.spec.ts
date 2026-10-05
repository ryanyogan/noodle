import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	enterJoinedHousehold,
	pickQuickAddBucket,
	signedInPage,
} from "./session";

// Household snapshots (#78, ADR-0035): take one in Household → Your data, change something,
// restore it behind the typed Household name, and what was there is back.

let parents: Awaited<ReturnType<typeof createTestParent>>[] = [];

test.afterEach(async () => {
	await Promise.all(parents.map((p) => p.remove()));
	parents = [];
});

async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await sheet.getByLabel("Note").fill(note);
	await pickQuickAddBucket(sheet, bucket);
	await expect(sheet).toBeHidden();
}

test("a Parent takes a snapshot, adds a Transaction, restores the snapshot, and it's as it was", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email);
	await createPlannedHousehold(page, { baseline: "9000", buckets: [["Groceries", "600"]] });
	await quickAdd(page, "42.10", "Groceries", "Farmers market");

	await page.goto("/household");
	const snapshots = page.getByRole("region", { name: "Snapshots" });
	await snapshots.getByLabel("Note").fill("Before the big shop");
	await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
	const history = snapshots.getByRole("list", { name: "Snapshot history" });
	const taken = history.getByRole("listitem").filter({ hasText: "Before the big shop" });
	await expect(taken).toContainText("Taken by");
	await expect(taken).toContainText("1 Transaction,");

	// Something changes after the snapshot.
	await page.goto("/month");
	await quickAdd(page, "310.00", "Groceries", "Warehouse run");
	// Transactions lists each one by its note; This Month shows only totals.
	await page.goto("/transactions");
	await expect(page.getByText("Warehouse run").first()).toBeVisible();

	await page.goto("/household");
	await taken.getByRole("button", { name: /^Restore the snapshot from/ }).click();
	const sheet = page.getByRole("dialog", { name: "Restore this snapshot?" });
	await expect(sheet.getByRole("list", { name: "What a restore does" })).toContainText(
		"1 Transaction",
	);
	const confirm = sheet.getByRole("button", { name: "Restore" });
	await expect(confirm).toBeDisabled();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rink");
	await expect(confirm).toBeDisabled();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rinks");
	await confirm.click();
	await expect(sheet).toBeHidden();

	// A snapshot of how things were just before is taken first, holding both Transactions.
	const before = history.getByRole("listitem").filter({ hasText: "Before a restore" });
	await expect(before).toContainText("2 Transactions,", { timeout: 30_000 });
	await expect(page.getByText("Restored. Your Household is back to how it was.")).toBeVisible({
		timeout: 120_000,
	});

	await page.goto("/transactions");
	await expect(page.getByText("Farmers market").first()).toBeVisible();
	await expect(page.getByText("Warehouse run")).toHaveCount(0);
});

test("when one Parent restores a snapshot, the other Parent is emailed about it", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const first = await createTestParent();
	const second = await createTestParent();
	parents.push(first, second);
	const alex = await signedInPage(browser, first.email);
	await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	await alex.goto("/household");
	await alex.getByLabel("Their email").fill(second.email);
	await alex.getByRole("button", { name: /^Invite/ }).click();
	await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();
	const sam = await signedInPage(browser, second.email);
	await sam.goto("/welcome");
	await sam.getByLabel("Your name").fill("Sam");
	await sam.getByRole("button", { name: "Join The Rinks" }).click();
	await enterJoinedHousehold(sam);

	await alex.goto("/household");
	const snapshots = alex.getByRole("region", { name: "Snapshots" });
	await snapshots.getByLabel("Note").fill("Before Sam’s changes");
	await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
	const taken = snapshots
		.getByRole("list", { name: "Snapshot history" })
		.getByRole("listitem")
		.filter({ hasText: "Before Sam’s changes" });
	await taken.getByRole("button", { name: /^Restore the snapshot from/ }).click();
	const sheet = alex.getByRole("dialog", { name: "Restore this snapshot?" });
	await sheet.getByLabel("Type “The Rinks”").fill("The Rinks");
	await sheet.getByRole("button", { name: "Restore" }).click();
	await expect(alex.getByText("Restored. Your Household is back to how it was.")).toBeVisible({
		timeout: 120_000,
	});

	// Sam hears by email (the dev outbox keeps it); the Nudge goes to Sam's devices, which a test
	// browser isn't. Alex, who restored, gets neither.
	const restoreEmails = async (to: string) => {
		const response = await alex.request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
		expect(response.ok()).toBe(true);
		const emails = (await response.json()) as { subject: string; text: string }[];
		return emails.filter((email) => / restored the snapshot from /.test(email.subject));
	};
	await expect.poll(async () => (await restoreEmails(second.email)).length).toBe(1);
	const [email] = await restoreEmails(second.email);
	expect(email?.text).toContain("Your Household’s data is back to how it was then.");
	expect(await restoreEmails(first.email)).toHaveLength(0);
	// Sam is still in the Household after the restore.
	await sam.goto("/household");
	await expect(sam.getByRole("region", { name: "Snapshots" })).toContainText("Before a restore");
});

/**
 * Watches the page's connections to its Household Agent; call before it loads. The returned
 * function waits until one is open: it answers the ping a screen sends on coming back into view.
 * (As in live-updates.spec.ts.)
 */
function watchHouseholdAgent(page: Page) {
	let answered = false;
	page.on("websocket", (socket) => {
		if (!socket.url().endsWith("/api/household-agent")) return;
		socket.on("framereceived", (frame) => {
			if (frame.payload === "pong") answered = true;
		});
	});
	return () =>
		expect
			.poll(async () => {
				await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
				return answered;
			})
			.toBe(true);
}

test("a snapshot one Parent takes shows in the other Parent's list without a reload", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const first = await createTestParent();
	const second = await createTestParent();
	parents.push(first, second);
	const alex = await signedInPage(browser, first.email);
	await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	await alex.goto("/household");
	await alex.getByLabel("Their email").fill(second.email);
	await alex.getByRole("button", { name: /^Invite/ }).click();
	await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();
	const sam = await signedInPage(browser, second.email);
	await sam.goto("/welcome");
	await sam.getByLabel("Your name").fill("Sam");
	await sam.getByRole("button", { name: "Join The Rinks" }).click();
	await enterJoinedHousehold(sam);

	// Sam has Household settings open, connected to the Household's live updates, and stays there.
	const connected = watchHouseholdAgent(sam);
	await sam.goto("/household");
	const samSnapshots = sam.getByRole("region", { name: "Snapshots" });
	await expect(samSnapshots.getByRole("button", { name: "Take a snapshot" })).toBeVisible();
	await expect(samSnapshots).not.toContainText("Seen by Sam");
	await connected();
	await sam.evaluate(() => {
		(window as { loadedOnce?: boolean }).loadedOnce = true;
	});

	await alex.goto("/household");
	const snapshots = alex.getByRole("region", { name: "Snapshots" });
	await snapshots.getByLabel("Note").fill("Seen by Sam");
	await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
	const history = (page: Page) =>
		page
			.getByRole("region", { name: "Snapshots" })
			.getByRole("list", { name: "Snapshot history" })
			.getByRole("listitem")
			.filter({ hasText: "Seen by Sam" });
	await expect(history(alex)).toHaveCount(1);

	// It shows for Sam by itself: the page was never loaded again.
	await expect(history(sam)).toHaveCount(1);
	expect(await sam.evaluate(() => (window as { loadedOnce?: boolean }).loadedOnce === true)).toBe(
		true,
	);
});
