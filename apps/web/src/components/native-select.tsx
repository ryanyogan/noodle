import { cn } from "@noodle/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

/** The platform's own select (the phone's picker wheel), styled like an Input. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
	return (
		<span className={cn("relative grid", className)}>
			<select
				className={cn(
					"h-10 w-full min-w-0 appearance-none rounded-xl border border-border bg-surface-2 ps-3 pe-9 text-base text-foreground md:text-sm",
					"transition-[border-color,background-color,box-shadow] duration-(--duration-fast) ease-standard",
					"focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-soft",
					"aria-invalid:border-over aria-invalid:ring-3 aria-invalid:ring-over-soft",
				)}
				{...props}
			/>
			<ChevronDown
				aria-hidden="true"
				className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
			/>
		</span>
	);
}
