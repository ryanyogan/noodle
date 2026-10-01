import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, serverFn, signedInPage } from "./session";

/**
 * Headless Chromium denies notifications and can't reach a real push service, so this stands in
 * for the browser's permission prompt (the Parent allows) and PushManager: a subscription that
 * lasts across reloads, as a real one would.
 */
function fakePushManager() {
	const KEY = "e2e-push-subscription";
	const PERMISSION = "e2e-notification-permission";
	Object.defineProperty(Notification, "permission", {
		get: () => localStorage.getItem(PERMISSION) ?? "default",
	});
	Notification.requestPermission = async () => {
		localStorage.setItem(PERMISSION, "granted");
		return "granted";
	};
	const fake = (applicationServerKey: number[]) => ({
		endpoint: "https://push.invalid/e2e-device",
		options: { applicationServerKey: new Uint8Array(applicationServerKey).buffer },
		toJSON: () => ({
			endpoint: "https://push.invalid/e2e-device",
			expirationTime: null,
			keys: {
				p256dh:
					"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
				auth: "tBHItJI5svbpez7KI4CCXg",
			},
		}),
		unsubscribe: async () => {
			localStorage.removeItem(KEY);
			return true;
		},
	});
	PushManager.prototype.getSubscription = async () => {
		const saved = localStorage.getItem(KEY);
		return saved ? (fake(JSON.parse(saved)) as unknown as PushSubscription) : null;
	};
	PushManager.prototype.subscribe = async (options) => {
		const key = [...new Uint8Array(options?.applicationServerKey as ArrayBuffer)];
		localStorage.setItem(KEY, JSON.stringify(key));
		return fake(key) as unknown as PushSubscription;
	};
}

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
		await nudges.getByRole("button", { name: "Save" }).click();
		await expect(page.getByText("Nudge settings saved")).toBeVisible();

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

		// No quiet hours: the times can't be changed and aren't kept.
		await quiet.uncheck();
		await expect(nudges.getByLabel("From")).toBeDisabled();
		await nudges.getByRole("button", { name: "Save" }).click();
		await expect(page.getByText("Nudge settings saved")).toBeVisible();
		await page.reload();
		await expect(quiet).not.toBeChecked();

		await nudges.getByRole("button", { name: "Turn off" }).click();
		await expect(nudges.getByText("Nudges are off on this device.")).toBeVisible();
	} finally {
		await parent.remove();
	}
});
