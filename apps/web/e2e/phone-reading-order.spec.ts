import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { looks } from "./phone";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

// Reading order on a phone, standing in for VoiceOver's swipe order: This Month and Quick Add read
// top to bottom with their labels. The snapshots name the structure, not every word, so they only
// change when the order or a label does.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

for (const look of looks) {
	test(`This Month and Quick Add read in order${look.name}`, async ({ browser }) => {
		const page = await signedInPage(browser, parent.email, look.options);
		await createPlannedHousehold(page, {
			baseline: "5,000",
			buckets: [
				["Groceries", "1,200"],
				["Gas", "200"],
			],
		});
		await switchTo(page, "Month");

		await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - heading /\\w+/ [level=1]
      - button "Previous month"
      - link /^Next month/
      - navigation "Month and Plan":
        - link "Month"
        - link "Plan"
      - region /^Buckets/:
        - heading /^Buckets/ [level=2]
        - list:
          - listitem /^Groceries/:
            - link "Groceries"
            - meter "Groceries"
          - listitem /^Gas/:
            - link "Gas"
            - meter "Gas"
      - region "Income":
        - heading "Income" [level=2]
        - button "Add income"
      - region "Free to Spend":
        - heading "Free to Spend" [level=2]
      - region "To do"
    `);

		await page
			.getByRole("navigation", { name: "Main" })
			.getByRole("link", { name: "Quick Add" })
			.click();
		const sheet = page.getByRole("dialog", { name: "Quick Add" });
		await expect(sheet.getByRole("button", { name: /^Groceries/ })).toBeVisible();
		await expect(sheet).toMatchAriaSnapshot(`
		  - dialog "Quick Add":
		    - heading "Quick Add" [level=2]
		    - button "Close"
		    - status "Amount": $ 0
		    - paragraph: Type an amount
		    - textbox "Note":
		      - /placeholder: Where or what? (optional)
		    - button "Snap receipt"
		    - button "Say it"
		    - list "Add to":
		      - listitem:
		        - button /Groceries \\$\\d+,\\d+ left/ [disabled]
		      - listitem:
		        - button /Gas \\$\\d+ left/ [disabled]
		    - 'button "For: Everyone"'
		    - group "Keypad"
		`);
	});
}
