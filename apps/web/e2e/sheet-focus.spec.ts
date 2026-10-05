import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	openPlanBuckets,
	signedInPage,
	switchTo,
} from "./session";

// Every sheet shares packages/ui's Sheet, so one Plan sheet and one Accounts sheet stand for all:
// on desktop the first field takes focus when a sheet opens, and closing it (Esc, Close, or
// saving) puts focus back on the control that opened it (WAI-ARIA APG, dialog pattern).

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("a sheet focuses its first field, and gives focus back to what opened it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await openPlanBuckets(page);

	// Esc: back to the pencil that opened it.
	const edit = page.getByRole("button", { name: "Edit Groceries" });
	await edit.click();
	const sheet = page.getByRole("dialog", { name: "Groceries" });
	await expect(sheet.getByRole("textbox", { name: "Allowance", exact: true })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(edit).toBeFocused();

	// The Close button: the same.
	await edit.click();
	await sheet.getByRole("button", { name: "Close" }).click();
	await expect(sheet).toBeHidden();
	await expect(edit).toBeFocused();

	// Saving: the same, so the keyboard user carries on down the list.
	await edit.click();
	await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("1,300");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(edit).toBeFocused();

	// Asking before archiving, on the Bucket's page: a modal alert dialog on top of the sheet,
	// starting on Cancel, and Esc goes back to the Archive button in the sheet.
	await page.getByRole("link", { name: "Groceries", exact: true }).click();
	const editPage = page.getByRole("button", { name: "Edit Bucket", exact: true });
	await editPage.click();
	const archive = sheet.getByRole("button", { name: "Archive", exact: true });
	await archive.click();
	const ask = page.getByRole("alertdialog", { name: "Archive Groceries" });
	await expect(ask.getByRole("button", { name: "Cancel" })).toBeFocused();
	// Radix takes a frame to hand Esc to the new layer; until then Esc does nothing.
	await expect(async () => {
		await page.keyboard.press("Escape");
		await expect(ask).toBeHidden({ timeout: 250 });
	}).toPass();
	await expect(sheet).toBeVisible();
	await expect(archive).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(editPage).toBeFocused();

	// A sheet on another page, opened from the header. The Bucket is a drawer over the dimmed page
	// at this width, so it is closed first.
	await page.getByRole("link", { name: "Close Bucket" }).click();
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Everyday Checking");
	await choose(page, "Kind", accountKindLabel("checking"));
	await page.getByLabel("Balance now").fill("2,500");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Everyday Checking, / }).click();
	const rename = page.getByRole("button", { name: "Rename" });
	await rename.click();
	const renameSheet = page.getByRole("dialog");
	await expect(renameSheet.getByRole("textbox")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(renameSheet).toBeHidden();
	await expect(rename).toBeFocused();
	await page.context().close();
});
