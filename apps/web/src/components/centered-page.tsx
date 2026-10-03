import { Logo } from "@noodle/ui/components/logo";
import type { ReactNode } from "react";

/** The frame for pages outside the app shell: creating or joining a Household. */
export function CenteredPage({ children }: { children: ReactNode }) {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-(--gutter) pt-[calc(var(--safe-top)+24px)] pb-[calc(var(--safe-bottom)+24px)]">
			<Logo className="mb-10 self-start lg:mb-16" />
			<div className="grid animate-enter gap-6">{children}</div>
		</main>
	);
}

export function CenteredHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
	return (
		<div className="grid gap-2">
			<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
			{children ? <p className="text-[15px] text-muted-foreground">{children}</p> : null}
		</div>
	);
}
