import { Logo } from "@noodle/ui/components/logo";
import { CalendarDays, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";

// Clerk's fields are 13 px, and iOS zooms the page into any field under 16 px when it gets focus.
// So on phones they're 16 px, as our own Input is (text-base md:text-sm).
const phoneSized = { fontSize: "1rem", "@media (min-width: 48rem)": { fontSize: "0.8125rem" } };
// And below lg its buttons and fields are 44 px tall, as our own controls are (COMPONENTS.md).
const phoneTall = { "@media (max-width: 63.99rem)": { minHeight: "2.75rem" } };

/** What Clerk's sign-in and sign-up cards share. Full theming to match packages/ui comes next (#59). */
export const clerkAppearance = {
	elements: {
		formFieldInput: { ...phoneSized, ...phoneTall },
		otpCodeFieldInput: phoneSized,
		formButtonPrimary: phoneTall,
		socialButtonsBlockButton: phoneTall,
		// "Secured by" is muted grey on the footer's tinted band, under 4.5:1 in both themes.
		footerItem: { '& p[data-color="inherit"]': { color: "var(--foreground)" } },
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
 * phone, the logo and one line sit above it.
 */
export function AuthPage({ children }: { children: ReactNode }) {
	return (
		<main className="flex min-h-dvh flex-col lg:grid lg:grid-cols-2">
			<div className="flex flex-col gap-3 px-(--gutter) pt-[calc(env(safe-area-inset-top)+24px)] lg:justify-center lg:border-r lg:border-border lg:bg-muted/40 lg:px-16 lg:py-16">
				<Logo />
				<p className="max-w-md text-[1.25rem] font-semibold leading-tight tracking-[-0.03em] lg:mt-8 lg:text-[2rem]">
					Know what you can spend, every day.
				</p>
				<ul className="mt-8 hidden max-w-md gap-6 lg:grid">
					{points.map(({ icon: Icon, title, text }) => (
						<li key={title} className="flex gap-3">
							<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-foreground">
								<Icon className="size-4" aria-hidden="true" />
							</span>
							<span className="grid gap-0.5">
								<span className="font-medium">{title}</span>
								<span className="text-[15px] text-muted-foreground">{text}</span>
							</span>
						</li>
					))}
				</ul>
				{/* "Watch the 1-minute intro" goes here once the video exists (#54). */}
			</div>
			<div className="flex flex-1 animate-enter justify-center px-(--gutter) pt-6 pb-[calc(env(safe-area-inset-bottom)+24px)] lg:items-center lg:py-16">
				{children}
			</div>
		</main>
	);
}

/** A page's title and description, for sign-in and sign-up, now Noodle's public face. */
export const authHead = (title: string) => () => ({
	meta: [
		{ title: `${title} · Noodle` },
		{
			name: "description",
			content:
				"Noodle is a calm monthly Plan for your Household. Know what you can spend, every day.",
		},
	],
});
