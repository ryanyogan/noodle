import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/** A toast Sonner is taking away: still in the page while it fades, no longer something a Parent reads. */
export const leavingToast = '[data-sonner-toast][data-removed="true"]';

/**
 * The axe run every spec starts from, in place of `new AxeBuilder({ page })`.
 *
 * Issue 125: Sonner keeps a dismissed toast in the page for its exit animation (about 200 ms),
 * marked `data-removed="true"`. Half faded, its words fail colour contrast, so a check that
 * happened to land in that window failed for a toast nobody could read any more. So this waits
 * (briefly, and only when there is one) for leaving toasts to go, then leaves any that are still
 * leaving out of the run — one may also start to leave between the wait and the run. A toast that
 * is showing (`data-removed="false"`) does not match and is checked like the rest of the page.
 */
export async function settledAxe(page: Page): Promise<AxeBuilder> {
	await page
		.waitForFunction((gone) => !document.querySelector(gone), leavingToast, { timeout: 1_500 })
		.catch(() => {});
	return new AxeBuilder({ page }).exclude(leavingToast);
}
