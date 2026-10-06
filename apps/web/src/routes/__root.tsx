/// <reference types="vite/client" />
import { ClerkProvider } from "@clerk/tanstack-react-start";
import { sidebarStateScript } from "@noodle/ui/components/sidebar";
import geistFont from "@noodle/ui/fonts/geist-latin-wght-normal.woff2?url";
import { themeScript } from "@noodle/ui/lib/theme";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { CenteredPage } from "../components/centered-page";
import { PageNotFound } from "../components/route-states";
import { isDocsPath } from "../docs-path";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
			{ title: "Noodle" },
			{ name: "description", content: "A calm monthly Plan for your Household." },
			{ name: "color-scheme", content: "light dark" },
			// Installed to the iPhone home screen, Noodle opens full-screen under a translucent status bar.
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{ name: "mobile-web-app-capable", content: "yes" },
			{ name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
			{ name: "apple-mobile-web-app-title", content: "Noodle" },
		],
		links: [
			{ rel: "preload", href: geistFont, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: "/manifest.webmanifest" },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
		],
	}),
	shellComponent: RootShell,
	notFoundComponent: RootNotFound,
});

/**
 * An address nothing answers to. It is outside the app's frame, so it brings its own: the logo,
 * the page's gutter and a phone's safe areas (issue 74: the card sat against the screen's edges).
 */
function RootNotFound() {
	return (
		<CenteredPage>
			<h1 className="sr-only">Page not found</h1>
			<PageNotFound />
		</CenteredPage>
	);
}

/** Sets data-standalone on <html> when the app runs installed (home screen). */
const standaloneScript =
	'if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) document.documentElement.dataset.standalone = "";';

function RootShell({ children }: { children: ReactNode }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	// A page of the Docs opened at its own address is plain HTML built ahead of time, the same for
	// everyone, so it comes without Clerk (issue 126; docs-path.ts). Decided once, by the address
	// the page was loaded at, so the server and the browser agree: the app keeps Clerk around it
	// when a Parent goes on to the Docs from the account menu.
	const [bare] = useState(() => isDocsPath(pathname));
	// The Docs' links into the app are plain links, a fresh page load. Should one ever not be, the
	// app is not drawn without Clerk: the address is loaded afresh instead.
	const strayed = bare && !isDocsPath(pathname);
	useEffect(() => {
		if (strayed) window.location.reload();
	}, [strayed]);
	// The inline scripts below set data-theme and data-sidebar-state on <html> before React hydrates.
	const page = (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
				{/* Rendered here, not in head(): head() keeps one meta per name, and there are two. */}
				<meta
					name="theme-color"
					media="(prefers-color-scheme: light)"
					content="#f7f7f8"
					data-theme-color="light"
					suppressHydrationWarning
				/>
				<meta
					name="theme-color"
					media="(prefers-color-scheme: dark)"
					content="#080a0f"
					data-theme-color="dark"
					suppressHydrationWarning
				/>
				{/* Before first paint, so a theme chosen on this device (the account menu) never shows the
				    other one first. After the metas above: it points them at the chosen theme. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from packages/ui, no user input. */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				{/* Before first paint, so a sidebar collapsed on this device renders collapsed. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from packages/ui, no user input. */}
				<script dangerouslySetInnerHTML={{ __html: sidebarStateScript }} />
				{/* Marks the installed app before first paint, for CSS that only applies there. */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant below, no user input. */}
				<script dangerouslySetInnerHTML={{ __html: standaloneScript }} />
			</head>
			<body>
				{strayed ? null : children}
				<Scripts />
			</body>
		</html>
	);
	if (bare) return page;
	return (
		<ClerkProvider
			signInUrl="/sign-in"
			signUpUrl="/sign-up"
			// Only a development instance shows the orange "Development mode" band. Hidden, local and
			// E2E look and measure as production does.
			appearance={{ options: { unsafe_disableDevelopmentModeWarnings: true } }}
		>
			{page}
		</ClerkProvider>
	);
}
