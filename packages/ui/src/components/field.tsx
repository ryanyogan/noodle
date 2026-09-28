import type * as React from "react";
import { cn } from "#lib/utils";
import { Label } from "./label";

/** A labelled form control with optional hint. */
function Field({
	label,
	htmlFor,
	hint,
	className,
	children,
}: {
	label: React.ReactNode;
	htmlFor: string;
	hint?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div data-slot="field" className={cn("grid gap-2", className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{hint ? <p className="text-xs text-subtle-foreground">{hint}</p> : null}
		</div>
	);
}

/** An error beneath a form, announced to screen readers. */
function FormError({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			role="alert"
			className={cn(
				"flex items-start gap-2 rounded-xl bg-over-soft px-3 py-2.5 text-[13px] text-over",
				className,
			)}
			{...props}
		/>
	);
}

export { Field, FormError };
