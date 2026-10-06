import { expect, type Page, test } from "@playwright/test";
import { settledAxe } from "./axe";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	enterJoinedHousehold,
	signedInPage,
} from "./session";

// A Parent changes their own name and colour in Household settings (issue 104): only their own
// row has the pencil, and the other Parent's open screen follows without a reload.

const parents = (page: Page) => page.getByRole("region", { name: "Parents" }).getByRole("listitem");
/** The signed-in Parent's own row, and the other Parent's. */
const ownRow = (page: Page) => parents(page).filter({ hasText: "Parent · You" });
const otherRow = (page: Page) => parents(page).filter({ hasNotText: "Parent · You" });
const editOwn = (page: Page) => page.getByRole("button", { name: "Edit your name and colour" });
const ownSheet = (page: Page) => page.getByRole("dialog", { name: "Your name and colour" });

test("a Parent renames and recolours themself, and the other Parent sees it", async ({
	browser,
}) => {
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const alex = await signedInPage(browser, first.email);
		await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		await alex.goto("/household");
		await alex.getByLabel("Their email").fill(second.email);
		await alex.getByRole("button", { name: /^Invite/ }).click();
		await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();

		const sam = await signedInPage(browser, second.email);
		await sam.goto("/welcome");
		await sam.getByLabel("Your name").fill("Sam");
		await sam.getByRole("button", { name: /^Join / }).click();
		await enterJoinedHousehold(sam);
		await sam.goto("/household");
		await expect(parents(sam)).toHaveCount(2);

		// Each Parent's own row has the one pencil; the other Parent's row has none.
		await expect(editOwn(sam)).toHaveCount(1);
		await expect(ownRow(sam).getByRole("button")).toHaveCount(1);
		await expect(otherRow(sam).getByRole("button")).toHaveCount(0);
		await expect(parents(alex)).toHaveCount(2, clientRendered);
		await expect(editOwn(alex)).toHaveCount(1);
		await expect(otherRow(alex).getByRole("button")).toHaveCount(0);

		// Alex's sheet: name and colour, saved together.
		await editOwn(alex).click();
		const sheet = ownSheet(alex);
		await expect(sheet).toBeVisible();
		const { violations } = await (await settledAxe(alex))
			.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(
			violations.map((v) => `${v.id}: ${v.help}`),
			"Parent sheet: axe violations",
		).toEqual([]);
		// Nothing changed yet, and a name is required.
		await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
		await sheet.getByLabel("Name").fill("   ");
		await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
		await sheet.getByLabel("Name").fill("Alexandra");
		await sheet.getByRole("radio", { name: "Violet" }).check();
		await sheet.getByRole("button", { name: "Save" }).click();
		await expect(sheet).toBeHidden();
		await expect(ownRow(alex).getByText("Alexandra", { exact: true })).toBeVisible();

		// Sam's open Household settings follows, with no reload; Sam still can't edit Alexandra.
		await expect(otherRow(sam).getByText("Alexandra", { exact: true })).toBeVisible(clientRendered);
		await expect(otherRow(sam).getByRole("button")).toHaveCount(0);

		// And For names them by the new name on Sam's screen.
		await sam.getByRole("link", { name: "Quick Add" }).click();
		const quickAdd = sam.getByRole("dialog", { name: "Quick Add" });
		await quickAdd.getByRole("button", { name: /^For: / }).click();
		await expect(
			quickAdd.getByRole("radiogroup", { name: "For" }).getByRole("radio", { name: "Alexandra" }),
		).toBeVisible();

		// The colour was saved: Alex's sheet opens with it chosen.
		await alex.reload();
		await editOwn(alex).click();
		await expect(ownSheet(alex).getByRole("radio", { name: "Violet" })).toBeChecked();
		await expect(ownSheet(alex).getByLabel("Name")).toHaveValue("Alexandra");

		await Promise.all([alex.context().close(), sam.context().close()]);
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});
