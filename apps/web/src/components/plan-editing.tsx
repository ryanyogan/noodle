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

/** Asks before a change that takes something out of the Plan. */
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
	return (
		<div role="alertdialog" aria-label={confirmLabel} className="grid gap-3 rounded-xl bg-card p-3">
			<p className="text-sm">{children}</p>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="button" variant="destructive" size="sm" onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</div>
		</div>
	);
}
