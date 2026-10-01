import type * as React from "react";
import { cn } from "#lib/utils";
import { Label } from "./label";

/**
 * A labelled form control with optional hint, and the error that stops its form saving: shown
 * under it once the Parent tries to save (`${htmlFor}-error`, for the control's
 * aria-describedby), in place of the browser's own required-field bubble.
 */
function Field({
	label,
	htmlFor,
	hint,
	error,
	className,
	children,
}: {
	label: React.ReactNode;
	htmlFor: string;
	hint?: React.ReactNode;
	error?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div data-slot="field" className={cn("grid gap-2", className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{error ? (
				<p id={`${htmlFor}-error`} role="alert" className="text-xs font-medium text-over">
					{error}
				</p>
			) : hint ? (
				<p className="text-xs text-subtle-foreground">{hint}</p>
			) : null}
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
