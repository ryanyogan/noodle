import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@noodle/ui/components/alert-dialog";
import { Button } from "@noodle/ui/components/button";
import { FormError } from "@noodle/ui/components/field";
import type { ReactNode } from "react";

/** Says a Plan change didn't save (and was rolled back), with a retry of the same change. */
export function SaveFailed<V>({
	change,
}: {
	change: { isError: boolean; variables: V | undefined; mutate: (variables: V) => void };
}) {
	if (!change.isError || change.variables === undefined) return null;
	const { variables } = change;
	return (
		<FormError className="items-center justify-between">
			We couldn’t save that change, so it’s been undone.
			<Button variant="outline" size="sm" type="button" onClick={() => change.mutate(variables)}>
				Try again
			</Button>
		</FormError>
	);
}

/**
 * Asks before a change that takes something out of the Plan, or can't be taken back: a modal
 * alert dialog (shadcn AlertDialog) that's open while it's rendered. `onCancel` only hides it. Focus starts on Cancel and
 * goes back to what opened it; Esc cancels.
 */
export function Confirm({
	children,
	confirmLabel,
	onConfirm,
	onCancel,
}: {
	children: ReactNode;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	// Confirming closes the dialog as well, so `onCancel` (which only hides it) runs after
	// `onConfirm` too.
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{confirmLabel}</AlertDialogTitle>
					<AlertDialogDescription>{children}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
