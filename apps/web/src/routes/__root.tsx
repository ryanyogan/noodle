/// <reference types="vite/client" />
import { ClerkProvider } from "@clerk/tanstack-react-start";
import { sidebarStateScript } from "@noodle/ui/components/sidebar";
import geistFont from "@noodle/ui/fonts/geist-latin-wght-normal.woff2?url";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
});

/** Sets data-standalone on <html> when the app runs installed (home screen). */
const standaloneScript =
	'if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) document.documentElement.dataset.standalone = "";';

function RootShell({ children }: { children: ReactNode }) {
	return (
		<ClerkProvider
			signInUrl="/sign-in"
			signUpUrl="/sign-up"
			// Only a development instance shows the orange "Development mode" band. Hidden, local and
			// E2E look and measure as production does.
			appearance={{ options: { unsafe_disableDevelopmentModeWarnings: true } }}
		>
			{/* The inline script below sets data-sidebar-state on it before React hydrates. */}
			<html lang="en" suppressHydrationWarning>
				<head>
					<HeadContent />
					{/* Rendered here, not in head(): head() keeps one meta per name, and there are two. */}
					<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3efe7" />
					<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#15120e" />
					{/* Before first paint, so a sidebar collapsed on this device renders collapsed. */}
					{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant from packages/ui, no user input. */}
					<script dangerouslySetInnerHTML={{ __html: sidebarStateScript }} />
					{/* Marks the installed app before first paint, for CSS that only applies there. */}
					{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant below, no user input. */}
					<script dangerouslySetInnerHTML={{ __html: standaloneScript }} />
				</head>
				<body>
					{children}
					<Scripts />
				</body>
			</html>
		</ClerkProvider>
	);
}
