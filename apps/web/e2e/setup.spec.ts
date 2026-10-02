import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { enterJoinedHousehold, savedBy, serverFn, signedInPage } from "./session";

// The get-started wizard's shell (#53): a new Household lands on it, Hello chooses how spending
// comes in, Take-home pay is set on the Plan, Back works, and a reload resumes where it was.

test("a new Household goes through Hello and Take-home pay, and a reload resumes", async ({
	browser,
}) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await page.goto("/welcome");
		await page.getByLabel("Household name").fill("The Starters");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();

		await expect(page).toHaveURL(/\/setup$/);
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await expect(page.getByText("about 8 minutes left")).toBeVisible();
		const by = page.getByRole("radio", { name: /I’ll add things by hand/ });
		await by.check();
		let saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await saved;

		await expect(page.getByText("Step 2 of 7")).toBeVisible();
		const pay = page.getByRole("textbox", {
			name: "What lands in your account in a normal month, after tax?",
		});
		// Help for biweekly pay: one paycheck × 26 ÷ 12.
		await page.getByRole("button", { name: "Paid every two weeks?" }).click();
		await page.getByRole("textbox", { name: "One paycheck" }).fill("2400");
		await page.getByRole("button", { name: "Use $5,200" }).click();
		await expect(pay).toHaveValue(/^5,?200(\.00)?$/);

		// Back keeps Hello's choice.
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Back" }).click();
		await saved;
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await expect(by).toBeChecked();
		await page.getByRole("button", { name: "Continue" }).click();

		await pay.fill("5,000");
		const takeHomePaySaved = savedBy(page, "setTakeHomePay");
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await takeHomePaySaved;
		await saved;
		await expect(page.getByText("Step 3 of 7")).toBeVisible();

		// Leaving and coming back resumes on the same step, with the answers kept.
		await page.reload();
		await expect(page.getByText("Step 3 of 7")).toBeVisible();
		await page.getByRole("button", { name: "Back" }).click();
		await expect(pay).toHaveValue(/^5,?000(\.00)?$/);

		// The take-home pay landed on the Plan.
		await page.getByRole("link", { name: "Set up later" }).click();
		await expect(page).toHaveURL(/\/month\//);
		await page.goto("/plan");
		await expect(page.getByText(/\$5,000/).first()).toBeVisible();
	} finally {
		await parent.remove();
	}
});

test("by hand: Bills, Buckets and a Goal land on the Plan, and going back adds nothing twice", async ({
	browser,
}) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await page.goto("/welcome");
		await page.getByLabel("Household name").fill("The Planners");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();
		await expect(page).toHaveURL(/\/setup$/);
		await page.getByRole("radio", { name: /I’ll add things by hand/ }).check();
		let saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await saved;
		await page
			.getByRole("textbox", { name: "What lands in your account in a normal month, after tax?" })
			.fill("5,000");
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await saved;

		// Step 3: tick two bills, give each an amount, and add one of our own.
		await expect(page.getByText("Step 3 of 7")).toBeVisible();
		await page.getByRole("checkbox", { name: "Mortgage or rent" }).check();
		await page.getByRole("textbox", { name: "Mortgage or rent amount" }).fill("1500");
		await page.getByRole("checkbox", { name: "Phone" }).check();
		// A ticked bill needs an amount before going on.
		await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
		await page.getByRole("textbox", { name: "Phone amount" }).fill("80");
		await page.getByRole("button", { name: "Add another" }).click();
		await page.getByRole("textbox", { name: "Name of New bill" }).fill("Piano lessons");
		await page.getByRole("textbox", { name: "Piano lessons amount" }).fill("120");
		await expect(page.getByText("$1,700")).toBeVisible();
		const added: string[] = [];
		page.on("request", (request) => {
			if (request.method() !== "POST") return;
			const url = new URL(request.url());
			for (const fn of ["addCommitment", "addBucket", "addPersonalAllowance", "addGoal"]) {
				if (serverFn(fn)(url)) added.push(fn);
			}
		});
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await saved;

		// Step 4: starter Buckets, scaled from what's left after the bills ($3,300).
		await expect(page.getByText("Step 4 of 7")).toBeVisible();
		const groceries = page.getByRole("textbox", { name: "Groceries amount" });
		await expect(groceries).toHaveValue(/^990(\.00)?$/);
		await expect(page.getByRole("textbox", { name: "Name of Alex’s money" })).toBeVisible();
		await expect(page.locator('[data-bucket="gifts"]').getByRole("switch")).toBeChecked();
		await expect(page.locator('[data-bucket="gas"]').getByRole("switch")).not.toBeChecked();
		await groceries.fill("800");
		await page.getByRole("button", { name: "Remove Fun" }).click();
		await page.getByRole("textbox", { name: "Name of Gas" }).fill("Fuel");
		await expect(page.getByText(/Left to plan:/)).toContainText("$");
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await saved;

		// Step 5: one Goal.
		await expect(page.getByText("Step 5 of 7")).toBeVisible();
		await page.getByRole("radio", { name: /Emergency fund/ }).check();
		await page.getByRole("textbox", { name: "How much?" }).fill("3000");
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Add Goal" }).click();
		await saved;
		await expect(page.getByText("Step 6 of 7")).toBeVisible();
		const first = [...added];
		expect(first.filter((fn) => fn === "addCommitment")).toHaveLength(3);
		expect(first.filter((fn) => fn === "addBucket")).toHaveLength(6);
		expect(first.filter((fn) => fn === "addPersonalAllowance")).toHaveLength(1);
		expect(first.filter((fn) => fn === "addGoal")).toHaveLength(1);

		// Back through the steps and on again: what was typed is kept and nothing is added twice.
		for (const step of [5, 4, 3]) {
			saved = savedBy(page, "saveSetup");
			await page.getByRole("button", { name: "Back", exact: true }).click();
			await saved;
			await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
		}
		await expect(page.getByRole("textbox", { name: "Piano lessons amount" })).toHaveValue(
			/^120(\.00)?$/,
		);
		await page.reload();
		await expect(page.getByRole("checkbox", { name: "Phone" })).toBeChecked();
		for (const step of [4, 5, 6]) {
			saved = savedBy(page, "saveSetup");
			await page.getByRole("button", { name: "Continue" }).click();
			await saved;
			await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
			if (step === 4) {
				await expect(page.getByRole("textbox", { name: "Fuel amount" })).toBeVisible();
				await expect(page.getByRole("button", { name: "Add back Fun" })).toBeVisible();
			}
		}
		expect(added).toEqual(first);

		// It's all on the Plan.
		await page.getByRole("link", { name: "Set up later" }).click();
		await expect(page).toHaveURL(/\/month\//);
		await page.goto("/plan");
		await expect(page.getByText("Piano lessons").first()).toBeVisible();
		await expect(page.getByText("Fuel").first()).toBeVisible();
		await expect(page.getByText("Emergency fund").first()).toBeVisible();
	} finally {
		await parent.remove();
	}
});

test("invite, Done, Continue setup, Run setup again, and the other Parent’s own screen", async ({
	browser,
}) => {
	test.slow();
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const page = await signedInPage(browser, first.email);
		await page.goto("/welcome");
		await page.getByLabel("Household name").fill("The Finishers");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();
		await expect(page).toHaveURL(/\/setup$/);
		const next = async (button: string, step: number) => {
			const saved = savedBy(page, "saveSetup");
			await page.getByRole("button", { name: button, exact: true }).click();
			await saved;
			await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
		};
		await page.getByRole("radio", { name: /I’ll add things by hand/ }).check();
		await next("Continue", 2);
		await page
			.getByRole("textbox", { name: "What lands in your account in a normal month, after tax?" })
			.fill("5,000");
		await next("Continue", 3);
		await page.getByRole("checkbox", { name: "Mortgage or rent" }).check();
		await page.getByRole("textbox", { name: "Mortgage or rent amount" }).fill("1500");
		// The due day can be emptied and typed again.
		const day = page.getByRole("textbox", { name: "Mortgage or rent due day" });
		await day.fill("");
		await expect(day).toHaveValue("");
		await day.fill("15");
		await next("Continue", 4);
		await next("Continue", 5);
		await next("Skip", 6);

		// Leaving now: This Month offers the way back, and it resumes on the same step.
		await page.getByRole("link", { name: "Set up later" }).click();
		await expect(page).toHaveURL(/\/month\//);
		await page.getByRole("link", { name: "Continue setup" }).click();
		await expect(page).toHaveURL(/\/setup$/);
		await expect(page.getByText("Step 6 of 7")).toBeVisible();

		// Step 6: the invite. Once someone is invited there is nothing to skip.
		await expect(page.getByRole("heading", { name: "Invite the other Parent" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Skip" })).toBeVisible();
		await page.getByLabel("Their email").fill(second.email);
		await page.getByRole("button", { name: "Invite", exact: true }).click();
		await expect(page.getByText(`Invited ${second.email}`)).toBeVisible();
		await expect(page.getByRole("button", { name: "Skip" })).toHaveCount(0);
		await next("Continue", 7);

		// Step 7: the Plan from take-home pay down to Free to Spend, as This Month then shows it.
		const summary = page.locator("dl");
		await expect(summary).toContainText("Take-home pay");
		await expect(summary).toContainText("$5,000");
		await expect(summary).toContainText("1 bill");
		await expect(summary).toContainText("$1,500");
		await expect(summary).toContainText("Personal Allowances");
		const free = (await page.locator('[data-summary="free-to-spend"] dd').innerText()).trim();
		expect(free).toMatch(/^\$[\d,]+/);
		await page.getByRole("button", { name: "Go to This Month" }).click();
		await expect(page).toHaveURL(/\/month\//);
		await expect(page.locator("[data-slot=page-header]")).toContainText("This Month");
		await expect(page.getByText(free).first()).toBeVisible();
		await expect(page.getByRole("link", { name: "Continue setup" })).toHaveCount(0);

		// Run setup again, from Household: every step shows what's there, and nothing is added twice.
		await page
			.getByRole("navigation", { name: "Main" })
			.getByRole("link", { name: "Household" })
			.click();
		const added: string[] = [];
		page.on("request", (request) => {
			if (request.method() !== "POST") return;
			const url = new URL(request.url());
			for (const fn of ["addCommitment", "addBucket", "addPersonalAllowance", "addGoal"]) {
				if (serverFn(fn)(url)) added.push(fn);
			}
		});
		await page.getByRole("button", { name: "Run setup again" }).click();
		await expect(page).toHaveURL(/\/setup$/);
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await expect(page.getByRole("radio", { name: /I’ll add things by hand/ })).toBeChecked();
		await next("Continue", 2);
		await next("Continue", 3);
		await expect(page.getByRole("textbox", { name: "Mortgage or rent due day" })).toHaveValue("15");
		await next("Continue", 4);
		await next("Continue", 5);
		await next("Skip", 6);
		await expect(page.getByText(`Invited ${second.email}`)).toBeVisible();
		await next("Continue", 7);
		await expect(page.locator('[data-summary="free-to-spend"] dd')).toHaveText(free);
		expect(added).toEqual([]);
		await page.getByRole("button", { name: "Go to This Month" }).click();
		await expect(page).toHaveURL(/\/month\//);

		// The other Parent joins and gets "Here's your Household", not the wizard.
		const sam = await signedInPage(browser, second.email);
		await sam.goto("/welcome");
		await sam.getByLabel("Your name").fill("Sam");
		await sam.getByRole("button", { name: "Join The Finishers" }).click();
		await expect(sam).toHaveURL(/\/joined$/);
		await expect(sam.getByRole("heading", { name: "Here’s your Household" })).toBeVisible();
		const household = sam.locator("dl");
		await expect(household).toContainText("Alex and Sam");
		await expect(household).toContainText("$5,000");
		await expect(household).toContainText("1 bill");
		await sam.getByRole("textbox", { name: "Your Personal Allowance each month" }).fill("100");
		const allowance = savedBy(sam, "addPersonalAllowance");
		await sam.getByRole("button", { name: "Add your Personal Allowance" }).click();
		await allowance;
		await expect(sam.getByText("Sam’s Personal Allowance")).toBeVisible();
		await enterJoinedHousehold(sam);
		await expect(sam.locator("[data-slot=page-header]")).toContainText("This Month");
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});
