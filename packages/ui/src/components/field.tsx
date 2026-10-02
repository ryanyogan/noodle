import type * as React from "react";
import { cn } from "#lib/utils";
import { Alert } from "./alert";
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

/**
 * An error beneath a form, announced to screen readers: the destructive Alert, so every error in
 * the app is the same box and the same ink (`text-over-foreground`, which is 4.5:1 on the soft
 * ground; `text-over` isn't in the light theme). A row, so a "Try again" Button can sit beside
 * the words.
 */
function FormError({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<Alert
			variant="destructive"
			role="alert"
			className={cn("flex items-start gap-2 text-[13px]", className)}
			{...props}
		/>
	);
}

export { Field, FormError };
