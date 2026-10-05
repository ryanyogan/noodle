import { Logo } from "@noodle/ui/components/logo";
import { CalendarDays, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";

// Clerk's card, themed through `appearance` to look like packages/ui: Geist, our radii, Button,
// Input and Card. Colours are our tokens (CSS variables), so it follows light and dark by itself.
// Clerk's own colour variables are set from the same tokens in styles.css.

// Below lg our controls are 44 px tall (COMPONENTS.md); from lg they're 36 px.
const phone = "@media (max-width: 63.99rem)";
const controlHeight = {
	height: "2.25rem",
	minHeight: "2.25rem",
	[phone]: { height: "2.75rem", minHeight: "2.75rem" },
};
// Clerk's fields are 13 px, and iOS zooms the page into any field under 16 px when it gets focus.
// So on phones they're 16 px, as our own Input is (text-base md:text-sm).
const phoneSized = { fontSize: "1rem", "@media (min-width: 48rem)": { fontSize: "0.875rem" } };
// Our focus ring: a 2 px outline in --ring, 2 px off the control.
const focusRing = {
	"&:focus-visible": { outline: "2px solid var(--ring)", outlineOffset: "2px", boxShadow: "none" },
};
// A link inside the card: on phones its tap area reaches 44 px tall, as TermHelp's does, without
// moving the text around it.
const tappable = {
	...focusRing,
	[phone]: {
		position: "relative",
		"&::after": {
			content: '""',
			position: "absolute",
			insetBlock: "-0.75rem",
			insetInline: "-0.25rem",
		},
	},
};
// Clerk's own styles for some elements (borders as box-shadows, for one) are more specific than a
// plain class. Doubling the class ("&&") puts ours on top.
const over = <T extends object>(style: T) => ({ "&&": style });
const buttonBase = {
	...controlHeight,
	...focusRing,
	borderRadius: "0.75rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	textTransform: "none" as const,
	backgroundImage: "none",
	boxShadow: "none",
	"&::after": { display: "none" },
};

/** What Clerk's sign-in and sign-up cards share. */
export const clerkAppearance = {
	options: { shimmer: false, socialButtonsVariant: "blockButton" as const },
	variables: { fontSize: "0.875rem", borderRadius: "0.75rem", colorShadow: "transparent" },
	elements: {
		rootBox: { width: "100%", maxWidth: "25rem" },
		// Our Card: 1 px border, rounded-2xl, the card shadow. The footer sits on --surface-2 below it.
		cardBox: over({
			width: "100%",
			borderRadius: "1rem",
			border: "1px solid var(--border)",
			boxShadow: "var(--shadow-card)",
			background: "var(--surface-2)",
		}),
		card: over({
			background: "var(--card)",
			boxShadow: "0 1px 0 var(--border)",
			border: "none",
			borderRadius: "0",
		}),
		headerTitle: { fontSize: "1.125rem", fontWeight: 600, letterSpacing: "-0.02em" },
		headerSubtitle: { color: "var(--muted-foreground)" },
		// Our Button, default variant.
		formButtonPrimary: over({
			...buttonBase,
			background: "var(--primary)",
			color: "var(--primary-foreground)",
			border: "1px solid transparent",
			"&:hover": { background: "var(--primary-hover)" },
			"&:active": { transform: "scale(0.98)" },
		}),
		buttonArrowIcon: { display: "none" },
		// Our Button, outline variant.
		socialButtonsBlockButton: over({
			...buttonBase,
			background: "var(--card)",
			color: "var(--foreground)",
			border: "1px solid var(--border-strong)",
			"&:hover": { background: "var(--surface-2)" },
		}),
		socialButtonsBlockButtonText: { fontWeight: 500 },
		dividerLine: { background: "var(--border)" },
		dividerText: { color: "var(--muted-foreground)", fontSize: "0.8125rem" },
		formFieldLabel: { fontSize: "0.875rem", fontWeight: 500, color: "var(--foreground)" },
		// Our Input.
		formFieldInput: over({
			...controlHeight,
			...phoneSized,
			borderRadius: "0.75rem",
			// --input, the border our own Input has, in light and dark (#73).
			border: "1px solid var(--input)",
			background: "var(--surface-2)",
			color: "var(--foreground)",
			boxShadow: "none",
			paddingInline: "0.75rem",
			"&:focus, &:focus-visible": {
				outline: "none",
				borderColor: "var(--ring)",
				background: "var(--card)",
				boxShadow: "0 0 0 3px var(--brand-soft)",
			},
			'&[aria-invalid="true"]': {
				borderColor: "var(--over)",
				boxShadow: "0 0 0 3px var(--over-soft)",
			},
		}),
		formFieldInputShowPasswordButton: { ...focusRing, [phone]: { minWidth: "2.75rem" } },
		otpCodeFieldInput: phoneSized,
		footerActionLink: {
			...tappable,
			color: "var(--foreground)",
			fontWeight: 500,
			textDecoration: "underline",
			textUnderlineOffset: "2px",
			"&:hover": { color: "var(--brand)" },
		},
		footerActionText: { color: "var(--muted-foreground)" },
		formFieldAction: { ...tappable, color: "var(--muted-foreground)", fontWeight: 500 },
		formResendCodeLink: { ...tappable, color: "var(--foreground)" },
		identityPreviewEditButton: { ...tappable, color: "var(--foreground)" },
		headerBackLink: tappable,
		footer: { background: "transparent", backgroundImage: "none" },
		// "Secured by Clerk", kept quiet: muted text on --surface-2 is over 4.5:1 in both themes.
		// Removing it is a paid Clerk setting, not something to hide here.
		footerItem: {
			color: "var(--muted-foreground)",
			"& p, & a, & svg": { color: "var(--muted-foreground)" },
			"& a": { ...tappable, borderRadius: "0.25rem" },
		},
	},
};

const points = [
	{
		icon: CalendarDays,
		title: "A Plan for each month",
		text: "Decide once a month where your take-home pay goes.",
	},
	{
		icon: Sparkles,
		title: "AI files your spending",
		text: "Each purchase lands in its Bucket. You check the few it isn't sure about.",
	},
	{
		icon: Users,
		title: "Made for two Parents",
		text: "You both see the same numbers, on your phones and at your desk.",
	},
];

/**
 * The frame for sign-in and sign-up. On desktop, what Noodle does sits beside Clerk's card; on a
 * phone, the logo and one line sit above it. `intro` goes under them: the intro video's button.
 */
export function AuthPage({ children, intro }: { children: ReactNode; intro?: ReactNode }) {
	return (
		<main className="flex min-h-dvh flex-col lg:grid lg:grid-cols-2">
			<div className="flex flex-col gap-3 px-(--gutter) pt-[calc(var(--safe-top)+24px)] lg:justify-center lg:border-r lg:border-border lg:bg-[color-mix(in_oklab,var(--brand)_7%,var(--background))] lg:px-16 lg:py-16">
				<Logo />
				<p className="max-w-md text-[1.25rem] font-semibold leading-tight tracking-[-0.03em] lg:mt-8 lg:text-[2rem]">
					Know what you can spend, every day.
				</p>
				<ul className="mt-8 hidden max-w-md gap-6 lg:grid">
					{points.map(({ icon: Icon, title, text }) => (
						<li key={title} className="flex gap-3">
							<span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-brand">
								<Icon className="size-4" aria-hidden="true" />
							</span>
							<span className="grid gap-0.5">
								<span className="font-medium">{title}</span>
								<span className="text-[15px] text-muted-foreground">{text}</span>
							</span>
						</li>
					))}
				</ul>
				{/* Sign-in's "Watch the 1-minute intro" (#54); nothing until the video's files exist. */}
				{intro}
			</div>
			<div className="flex flex-1 animate-enter justify-center px-(--gutter) pt-6 pb-[calc(var(--safe-bottom)+24px)] lg:items-center lg:py-16">
				{children}
			</div>
		</main>
	);
}

const description =
	"Noodle is a calm monthly Plan for your Household. Know what you can spend, every day.";

/**
 * A page's title and description, for sign-in and sign-up, now Noodle's public face, with the
 * Open Graph and Twitter tags a shared link shows. No og:image yet: there's no good still of the
 * app or the intro video (#54) to use.
 */
export const authHead = (title: string) => () => ({
	meta: [
		{ title: `${title} · Noodle` },
		{ name: "description", content: description },
		{ property: "og:type", content: "website" },
		{ property: "og:site_name", content: "Noodle" },
		{ property: "og:title", content: `${title} · Noodle` },
		{ property: "og:description", content: description },
		{ name: "twitter:card", content: "summary" },
		{ name: "twitter:title", content: `${title} · Noodle` },
		{ name: "twitter:description", content: description },
	],
});
