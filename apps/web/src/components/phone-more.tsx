import { Button } from "@noodle/ui/components/button";
import { cn } from "@noodle/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/**
 * On a phone (below 640), the longer explanation waits behind a "More about …" button so the page
 * stays short (#74). From 640 the button is gone and the text is simply there: the wrapper is
 * `contents`, so it lays out exactly as if it weren't wrapped.
 */
export function PhoneMore({ label, children }: { label: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	return (
		<>
			<Button
				type="button"
				variant="link"
				className="h-auto min-h-11 justify-self-start px-0! text-left whitespace-normal sm:hidden"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((was) => !was)}
			>
				{label}
				<ChevronDown className={cn("transition-transform", open && "rotate-180")} />
			</Button>
			<div id={id} className={cn("contents", !open && "max-sm:hidden")}>
				{children}
			</div>
		</>
	);
}
