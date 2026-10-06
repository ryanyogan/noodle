import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { fakePushManager } from "./push";
import { createHousehold, serverFn, signedInPage } from "./session";

test("a Parent turns on Nudges for their device and chooses which they get", async ({
	browser,
}) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await page.context().addInitScript(fakePushManager);
		await createHousehold(page, "The Nudges", "Alex");
		await page.getByRole("link", { name: "Household" }).click();

		const nudges = page.getByRole("region", { name: "Nudges" });
		await expect(nudges.getByText("Nudges are off on this device.")).toBeVisible();
		const saved = page.waitForRequest((request) =>
			serverFn("savePushSubscription")(new URL(request.url())),
		);
		await nudges.getByRole("button", { name: "Turn on" }).click();
		await saved;
		await expect(nudges.getByText("Nudges are on for this device.")).toBeVisible();

		// Defaults: Buckets passing Pace and Extra income on, the other Parent's Quick Adds off, quiet
		// 9pm to 7am.
		const pace = nudges.getByRole("switch", {
			name: "A Bucket is being spent faster than the month is going",
		});
		const quickAdds = nudges.getByRole("switch", { name: "The other Parent’s Quick Adds" });
		const extraIncomes = nudges.getByRole("switch", { name: "Extra income arrives" });
		const quiet = nudges.getByRole("switch", { name: "Quiet hours" });
		await expect(pace).toBeChecked();
		await expect(quickAdds).not.toBeChecked();
		await expect(extraIncomes).toBeChecked();
		await expect(quiet).toBeChecked();
		await expect(nudges.getByLabel("From")).toHaveValue("21:00");

		await pace.uncheck();
		await quickAdds.check();
		await extraIncomes.uncheck();
		await nudges.getByLabel("From").fill("22:30");
		await nudges.getByLabel("Until").fill("06:15");
		// Each change saves as it's made: there's no Save to forget.
		await expect(nudges.getByRole("button", { name: "Save" })).toHaveCount(0);
		await expect(nudges.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

		await nudges.getByRole("button", { name: "Send a test" }).click();
		await expect(page.getByText("Test Nudge sent")).toBeVisible();

		// Saved for this Parent, and the device is still on.
		await page.reload();
		await expect(nudges.getByText("Nudges are on for this device.")).toBeVisible();
		await expect(pace).not.toBeChecked();
		await expect(quickAdds).toBeChecked();
		await expect(extraIncomes).not.toBeChecked();
		await expect(nudges.getByLabel("From")).toHaveValue("22:30");
		await expect(nudges.getByLabel("Until")).toHaveValue("06:15");

		// No quiet hours: the times aren't shown or kept.
		await quiet.uncheck();
		await expect(nudges.getByLabel("From")).toHaveCount(0);
		await expect(nudges.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
		await page.reload();
		await expect(quiet).not.toBeChecked();

		await nudges.getByRole("button", { name: "Turn off" }).click();
		await expect(nudges.getByText("Nudges are off on this device.")).toBeVisible();
	} finally {
		await parent.remove();
	}
});
