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
import { useBlocker } from "@tanstack/react-router";

// One rule for Back with a sheet open (#47): sheets aren't history entries (Quick Add's, which
// is in the URL as `?sheet=`, is the one exception, so Back closes it). Leaving the page throws a
// sheet away, so when something was typed or picked in one (Sheet marks it `data-dirty`), Back or
// a link asks first. A sheet nobody typed in just goes with the page.

const dirtySheet = () =>
	typeof document !== "undefined" &&
	document.querySelector("[data-slot=sheet-content][data-state=open][data-dirty]") !== null;

export function LeaveGuard() {
	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) => current.pathname !== next.pathname && dirtySheet(),
		enableBeforeUnload: dirtySheet,
		withResolver: true,
	});
	if (blocker.status !== "blocked") return null;
	return (
		<AlertDialog open onOpenChange={(open) => (open ? null : blocker.reset())}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Leave without saving?</AlertDialogTitle>
					<AlertDialogDescription>
						What you typed in the open sheet hasn’t been saved, and leaving this page throws it
						away.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Stay</AlertDialogCancel>
					<AlertDialogAction onClick={() => blocker.proceed()}>Leave</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
