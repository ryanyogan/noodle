// What Noodle puts around Plaid Link while it's open (#70). Link draws itself in Plaid's own
// frame, fixed over the whole window; on a narrow screen it fills that frame. Noodle is installed
// on the phone and draws under the notch (viewport-fit=cover), so Link's header and its close (X)
// ended up under the notch, out of reach. Link can't be put inside an element of ours, so its
// frame is held inside the safe area instead, and on a phone a bar of Noodle's own sits above it
// with a Close that always works. Back and Escape close it too. When Link is gone the page is as
// it was: it scrolls, and the button that opened Link has the focus again.
import type { LinkFrame } from "./bank-link-run";

const FRAME_ID = "noodle-bank-link-frame";
/** Plaid's frames, however many it made: `plaid-link-iframe-1`, `-2`… at the top of the body. */
export const PLAID_FRAME = 'iframe[id^="plaid-link-iframe"]';
const HISTORY_MARK = "noodleBankLink";

// The safe-area tokens are globals.css's (--safe-top is env(safe-area-inset-top), and so on).
// Plaid sizes its frame with inline styles, hence !important. Above Plaid's own frame nothing can
// be drawn (it takes the highest z-index there is), so the bar sits beside it, not over it.
const BAR = "2.75rem";
const TOP = "var(--safe-top, 0px)";
const BOTTOM = "var(--safe-bottom, 0px)";
const LEFT = "var(--safe-left, 0px)";
const RIGHT = "var(--safe-right, 0px)";
const STYLES = `
${PLAID_FRAME} {
	top: ${TOP} !important;
	bottom: auto !important;
	left: ${LEFT} !important;
	right: auto !important;
	width: calc(100% - ${LEFT} - ${RIGHT}) !important;
	height: calc(100% - ${TOP} - ${BOTTOM}) !important;
}
#${FRAME_ID} { display: none; }
@media (max-width: 640px) {
	${PLAID_FRAME} {
		top: calc(${TOP} + ${BAR}) !important;
		height: calc(100% - ${TOP} - ${BAR} - ${BOTTOM}) !important;
	}
	#${FRAME_ID} {
		display: block;
		position: fixed;
		inset: 0;
		z-index: 2147483646;
		background: var(--background);
		color: var(--foreground);
	}
	#${FRAME_ID} > div {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: calc(${TOP} + ${BAR});
		padding: ${TOP} max(0.5rem, ${RIGHT}) 0 max(1rem, ${LEFT});
		/* A line drawn inside the bar, so Close keeps its full height. */
		box-shadow: inset 0 -1px 0 var(--border);
		font-size: 0.875rem;
		font-weight: 500;
	}
	#${FRAME_ID} button {
		min-width: ${BAR};
		height: ${BAR};
		padding: 0 0.75rem;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
}
`;

type FrameOptions = {
	/** False on /bank/return, which leaves for the page the Parent started on as soon as Link ends. */
	back?: boolean;
};

let lastOpener: HTMLElement | null = null;

/**
 * Notes what the Parent pressed to open Link, at the moment they pressed it: by the time Link
 * opens the button is disabled while it waits, and a browser takes the focus off a disabled button.
 */
export function rememberLinkOpener() {
	const active = document.activeElement;
	lastOpener = active instanceof HTMLElement && active !== document.body ? active : null;
}

/** The frame for one run of Link. */
export function bankLinkFrame({ back = true }: FrameOptions = {}): LinkFrame {
	let host: HTMLElement | null = null;
	let opener: HTMLElement | null = null;
	let overflow = "";
	let close: (() => void) | null = null;
	const onBack = () => close?.();
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape") close?.();
	};

	return {
		show(closeLink) {
			close = closeLink;
			const active = document.activeElement;
			// What the Parent pressed comes first: when a sheet asked a question in between (how far
			// back, #89), the focus is on something of that sheet's, which is about to go.
			opener = lastOpener?.isConnected
				? lastOpener
				: active instanceof HTMLElement && active !== document.body
					? active
					: null;
			overflow = document.body.style.overflow;

			host = document.createElement("div");
			host.id = FRAME_ID;
			const style = document.createElement("style");
			style.textContent = STYLES;
			const bar = document.createElement("div");
			const title = document.createElement("span");
			title.textContent = "Connecting a bank";
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = "Close";
			button.addEventListener("click", () => close?.());
			bar.appendChild(title);
			bar.appendChild(button);
			host.appendChild(style);
			host.appendChild(bar);
			document.body.appendChild(host);

			window.addEventListener("keydown", onKey);
			if (back) {
				// One step of history, so Back (or the phone's swipe back) closes Link rather than
				// leaving the page under it. The router's own state is kept, so it sees no new page.
				try {
					window.history.pushState({ ...window.history.state, [HISTORY_MARK]: true }, "");
					window.addEventListener("popstate", onBack);
				} catch {
					// No history to add to: Close and Escape still work.
				}
			}
		},
		hide(closed) {
			close = null;
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("popstate", onBack);
			host?.remove();
			host = null;
			// Whatever Link left behind: its frames, and the scroll lock it puts on the page.
			for (const frame of document.querySelectorAll(PLAID_FRAME)) frame.remove();
			document.body.style.overflow = overflow;
			if (back && window.history.state?.[HISTORY_MARK]) window.history.back();
			if (closed) refocus(opener);
			opener = null;
		},
	};
}

/**
 * Puts the focus back on what opened Link. The button is disabled until the page hears Link has
 * closed, so this tries for a moment, and stops as soon as the Parent has moved on to something.
 */
function refocus(target: HTMLElement | null, tries = 10) {
	if (!target?.isConnected) return;
	const active = document.activeElement;
	if (active && active !== document.body && active !== target) return;
	target.focus({ preventScroll: true });
	if (document.activeElement !== target && tries > 0) {
		window.setTimeout(() => refocus(target, tries - 1), 50);
	}
}
