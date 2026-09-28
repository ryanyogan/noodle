import { cn } from "#lib/utils";

/** Noodle's mark: a noodle ending in the marigold "today" dot. */
function LogoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 64 64"
			aria-hidden="true"
			className={cn("size-6 shrink-0 rounded-[7px]", className)}
		>
			<rect width="64" height="64" rx="16" className="fill-foreground" />
			<path
				d="M18 44V26a8 8 0 0 1 16 0v11a8 8 0 0 0 16 0V20"
				fill="none"
				strokeWidth="7"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="stroke-background"
			/>
			<circle cx="50" cy="20" r="5.5" fill="#f2a20c" />
		</svg>
	);
}

function Logo({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-2.5 text-base font-semibold tracking-[-0.02em]",
				className,
			)}
		>
			<LogoMark />
			Noodle
		</span>
	);
}

export { Logo, LogoMark };
