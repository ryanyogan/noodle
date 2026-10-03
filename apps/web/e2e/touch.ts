import type { Locator, Page } from "@playwright/test";

/**
 * A finger drag of `dy` px down (negative is up), starting at the middle of `from`.
 *
 * Chromium gets real touches through CDP, so the browser decides between scrolling and the app's
 * pointer handlers as a phone would. Playwright's WebKit can only tap, so there the same drag is
 * dispatched as pointer events (and touch events, where the browser can make them) on the element
 * under the finger: enough for the sheet's
 * drag-to-close, but WebKit won't scroll for it.
 */
export async function swipe(page: Page, from: Locator, dy: number, steps = 10) {
	// Let a sheet finish rising first, or the finger lands where the element was mid-way.
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
				.map((a) => a.finished.catch(() => {})),
		),
	);
	const box = await from.boundingBox();
	if (!box) throw new Error("swipe: the element isn't on screen");
	const x = box.x + box.width / 2;
	const y = box.y + Math.min(box.height / 2, 12);

	if (page.context().browser()?.browserType().name() === "chromium") {
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: "touchStart" | "touchMove" | "touchEnd", ty: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type,
				touchPoints: type === "touchEnd" ? [] : [{ x, y: ty, id: 1 }],
			});
		await touch("touchStart", y);
		for (let i = 1; i <= steps; i++) await touch("touchMove", y + (dy * i) / steps);
		await touch("touchEnd", y + dy);
		await cdp.detach();
		return;
	}

	await page.evaluate(
		({ x, y, dy, steps }) => {
			const target = document.elementFromPoint(x, y);
			if (!target) throw new Error("swipe: nothing under the finger");
			const fire = (kind: "start" | "move" | "end", at: number) => {
				const type = { start: "pointerdown", move: "pointermove", end: "pointerup" }[kind];
				target.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						cancelable: true,
						composed: true,
						pointerId: 1,
						pointerType: "touch",
						isPrimary: true,
						button: kind === "move" ? -1 : 0,
						buttons: kind === "end" ? 0 : 1,
						clientX: x,
						clientY: at,
					}),
				);
				// Desktop WebKit (Playwright's) has a Touch function that throws "Illegal constructor",
				// having no touch support. The sheet listens for pointer events anyway.
				let t: Touch | undefined;
				try {
					t = new Touch({ identifier: 1, target, clientX: x, clientY: at });
				} catch {}
				if (t) {
					target.dispatchEvent(
						new TouchEvent(`touch${kind}`, {
							bubbles: true,
							cancelable: true,
							composed: true,
							touches: kind === "end" ? [] : [t],
							targetTouches: kind === "end" ? [] : [t],
							changedTouches: [t],
						}),
					);
				}
			};
			fire("start", y);
			for (let i = 1; i <= steps; i++) fire("move", y + (dy * i) / steps);
			fire("end", y + dy);
		},
		{ x, y, dy, steps },
	);
}

/** True when the page runs in Chromium, where `swipe` is a real touch that can scroll. */
export const realTouch = (page: Page) =>
	page.context().browser()?.browserType().name() === "chromium";
