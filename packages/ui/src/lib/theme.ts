import * as React from "react";

// The theme a Parent picks for this device: Light, Dark, or Device (follow the device's own
// setting, which is what the app does until they pick). It is remembered the way the Sidebar's
// state is: per device in localStorage, and on `<html data-theme>`, which `themeScript`, inline
// in `<head>`, sets before first paint so a page never shows in the wrong theme first. Styles
// follow that attribute (globals.css: the dark tokens and the `dark:` variant); with no attribute
// they follow `prefers-color-scheme`, as they always have.

type Theme = "light" | "dark" | "device";

const THEME_STORAGE_KEY = "theme";

const chosen = (value: string | null | undefined): Theme =>
	value === "light" || value === "dark" ? value : "device";

/** Puts the theme on `<html>` and points the browser's own bars (theme-color) at it. */
function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === "device") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
	for (const meta of document.querySelectorAll("meta[data-theme-color]")) {
		const scheme = meta.getAttribute("data-theme-color");
		meta.setAttribute(
			"media",
			theme === "device"
				? `(prefers-color-scheme: ${scheme})`
				: scheme === theme
					? "all"
					: "not all",
		);
	}
}

/** Inline in `<head>`, after the theme-color metas: applyTheme, before first paint. */
const themeScript = `try{(function(t){var r=document.documentElement,f=t==="light"||t==="dark";if(f)r.setAttribute("data-theme",t);document.querySelectorAll("meta[data-theme-color]").forEach(function(m){var s=m.getAttribute("data-theme-color");if(f)m.setAttribute("media",s===t?"all":"not all")})})(localStorage.getItem("${THEME_STORAGE_KEY}"))}catch(e){}`;

const listeners = new Set<() => void>();
const notify = () => {
	for (const listener of listeners) listener();
};
// Another tab or window of this device changed it: follow.
const onStorage = (event: StorageEvent) => {
	if (event.key !== THEME_STORAGE_KEY) return;
	applyTheme(chosen(event.newValue));
	notify();
};
const subscribe = (listener: () => void) => {
	if (listeners.size === 0) window.addEventListener("storage", onStorage);
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) window.removeEventListener("storage", onStorage);
	};
};
const readTheme = () => chosen(document.documentElement.getAttribute("data-theme"));

/** Applies at once, with no reload, and is remembered on this device. */
function setTheme(theme: Theme) {
	applyTheme(theme);
	try {
		if (theme === "device") localStorage.removeItem(THEME_STORAGE_KEY);
		else localStorage.setItem(THEME_STORAGE_KEY, theme);
	} catch {
		// Private mode or blocked storage: it still works for this visit.
	}
	notify();
}

/** The theme chosen on this device ("device" until one is), and how to choose another. */
function useTheme() {
	const theme = React.useSyncExternalStore(subscribe, readTheme, () => "device" as const);
	return [theme, setTheme] as const;
}

export { setTheme, type Theme, themeScript, useTheme };
