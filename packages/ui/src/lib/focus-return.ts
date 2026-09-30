import * as React from "react";

// Shared by Sheet and AlertDialog (packages/ui).

/** Desktop, where a sheet's first field takes focus when it opens (phones keep the keyboard down). */
const FIRST_FIELD_QUERY = "(min-width: 64rem)";

/** The first field a Parent would type in or choose from, skipping the header's Close. */
const firstField = (content: HTMLElement) =>
	content.querySelector<HTMLElement>(
		"[data-autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])",
	);

/**
 * Focus in and out, as the APG dialog pattern has it: on desktop the first field takes focus when
 * a sheet or dialog opens (otherwise Radix focuses its first tabbable: a sheet's Close button, an
 * alert dialog's Cancel); on closing, focus goes back to what had it when it opened, the control
 * that opened it. Sheets and dialogs here
 * open from state rather than a Radix Trigger, so Radix itself has nothing to return focus to and
 * leaves it on <body>. When that control is gone (its row was removed or re-rendered), focus goes
 * to the page's main region, so Tab carries on from the page.
 */
export function useFocusReturn({
	onOpenAutoFocus,
	onCloseAutoFocus,
}: {
	onOpenAutoFocus?: (event: Event) => void;
	onCloseAutoFocus?: (event: Event) => void;
}) {
	const opener = React.useRef<HTMLElement | null>(null);
	return {
		onOpenAutoFocus: (event: Event) => {
			const active = document.activeElement;
			opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
			onOpenAutoFocus?.(event);
			if (event.defaultPrevented || !window.matchMedia(FIRST_FIELD_QUERY).matches) return;
			const field = event.currentTarget instanceof HTMLElement && firstField(event.currentTarget);
			if (field) {
				event.preventDefault();
				field.focus();
			}
		},
		onCloseAutoFocus: (event: Event) => {
			onCloseAutoFocus?.(event);
			if (event.defaultPrevented) return;
			event.preventDefault();
			const target = opener.current;
			opener.current = null;
			if (target?.isConnected && !target.matches(":disabled")) {
				target.focus({ preventScroll: true });
				if (document.activeElement === target) return;
			}
			const main = document.querySelector<HTMLElement>("main");
			if (!main) return;
			if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
			main.focus({ preventScroll: true });
		},
	};
}
