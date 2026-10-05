import { Alert, AlertDescription, AlertTitle } from "@noodle/ui/components/alert";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { setFreshStartProgress, useFreshStartProgress } from "../fresh-start-live";
import { freshStartCountsQuery, freshStartQuery, setupQuery } from "../queries";
import {
	cancelFreshStart,
	type FreshStartStatus,
	getFreshStartStatus,
	startFreshStart,
} from "../server/fresh-start";
import { restartSetup } from "../server/setup";
import { PhoneMore } from "./phone-more";

type Level = "fresh-start" | "delete";

// ADR-0035's numbers (SNAPSHOT_RETENTION.byHandDays and FINAL_SNAPSHOT_DAYS in @noodle/db, which
// the browser's copy doesn't load).
const SNAPSHOT_KEPT_DAYS = 90;
const FINAL_SNAPSHOT_DAYS = 30;

/** "tomorrow 3:12 PM": when a scheduled fresh start runs, in the Parent's own time. */
export function whenItRuns(runAt: number, now: Date = new Date()): string {
	const at = new Date(runAt);
	const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
	const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((dayOf(at) - dayOf(now)) / 86_400_000);
	return days === 0
		? `today ${time}`
		: days === 1
			? `tomorrow ${time}`
			: at.toLocaleString("en-US");
}

/** "Chase", "Chase and Ally", "Chase, Ally and Amex". */
const joined = (names: string[]) =>
	names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Scheduled and waiting out its grace period (one about to run at once isn't). */
const isWaiting = (status: FreshStartStatus | undefined): status is NonNullable<FreshStartStatus> =>
	status?.status === "scheduled" && status.runAt > Date.now();

/** "Fresh start scheduled for tomorrow 3:12 PM · Cancel": either Parent can cancel it. */
function Scheduled({ status }: { status: NonNullable<FreshStartStatus> }) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const cancel = useMutation({
		mutationFn: () => cancelFreshStart(),
		onSuccess: () => queryClient.setQueryData(freshStartQuery().queryKey, null),
		onError: () => toast("Couldn’t cancel. Please try again.", { tone: "error" }),
	});
	const what = status.level === "delete" ? "Deleting the Household" : "Fresh start";
	return (
		<p className="flex flex-wrap items-center gap-x-2 text-sm">
			<span>
				{what} scheduled for {whenItRuns(status.runAt)}
			</span>
			<span aria-hidden>·</span>
			<Button
				variant="link"
				size="sm"
				className="px-0"
				disabled={!hydrated || cancel.isPending}
				onClick={() => cancel.mutate()}
			>
				Cancel
			</Button>
		</p>
	);
}

/** A quiet banner on every page while a fresh start waits out its grace period. */
export function FreshStartBanner() {
	const { data } = useQuery(freshStartQuery());
	if (!isWaiting(data)) return null;
	return (
		<Alert role="status" className="mx-4 mt-3 w-auto lg:mx-6" aria-label="Fresh start scheduled">
			<TriangleAlert />
			<AlertDescription className="text-foreground">
				<Scheduled status={data} />
			</AlertDescription>
		</Alert>
	);
}

/** Household settings' last group: Start fresh and Delete Household (#63, ADR-0029). */
export function DangerZone({ householdName }: { householdName: string }) {
	const hydrated = useHydrated();
	const { data } = useQuery(freshStartQuery());
	const [level, setLevel] = useState<Level | null>(null);
	return (
		<Alert
			role="group"
			variant="destructive"
			className="grid gap-3 rounded-(--radius-card) p-(--card-pad)"
		>
			<AlertTitle>Start fresh can be put back. Deleting can’t.</AlertTitle>
			<AlertDescription className="grid gap-3">
				<PhoneMore label="More about these two">
					<p>
						Start fresh clears every Transaction, bank connection, Bucket and Goal, and keeps your
						Household, its Parents and Children. Noodle takes a snapshot first: for up to{" "}
						{SNAPSHOT_KEPT_DAYS} days you can put your Household back from Snapshots, statement and
						Receipt files included. Banks need connecting again.
					</p>
					<p>
						Delete Household removes all of it, and that can’t be undone. Noodle keeps one last
						snapshot for {FINAL_SNAPSHOT_DAYS} days, then deletes it.
					</p>
				</PhoneMore>
				{isWaiting(data) ? (
					<Scheduled status={data} />
				) : (
					<div className="grid gap-2 sm:flex sm:flex-wrap">
						<Button
							variant="outline"
							disabled={!hydrated || Boolean(data)}
							onClick={() => setLevel("fresh-start")}
						>
							Start fresh
						</Button>
						<Button
							variant="destructive"
							disabled={!hydrated || Boolean(data)}
							onClick={() => setLevel("delete")}
						>
							Delete Household
						</Button>
					</div>
				)}
			</AlertDescription>
			{level ? (
				<FreshStartSheet
					level={level}
					householdName={householdName}
					onClose={() => setLevel(null)}
				/>
			) : null}
		</Alert>
	);
}

function FreshStartSheet({
	level,
	householdName,
	onClose,
}: {
	level: Level;
	householdName: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const nameId = useId();
	const banksId = useId();
	const backupsId = useId();
	const [step, setStep] = useState<1 | 2>(1);
	const [typed, setTyped] = useState("");
	const [disconnect, setDisconnect] = useState(false);
	const [deleteBackups, setDeleteBackups] = useState(false);
	const counts = useQuery(freshStartCountsQuery());
	const banks = counts.data?.banks ?? [];
	const others = counts.data?.otherParents ?? [];
	const start = useMutation({
		mutationFn: () =>
			startFreshStart({ data: { level, deleteBackups: level === "delete" && deleteBackups } }),
		onSuccess: (status) => {
			if (!status) return;
			queryClient.setQueryData(freshStartQuery().queryKey, status);
			if (status.runAt > Date.now() + 60_000) {
				toast(`Scheduled for ${whenItRuns(status.runAt)}. The other Parent can cancel it.`);
			} else {
				setFreshStartProgress({
					id: status.id,
					level,
					state: "running",
					step: 0,
					steps: status.steps || 6,
					label: "Starting",
				});
			}
			onClose();
		},
	});
	const confirmed = typed.trim() === householdName.trim() && (banks.length === 0 || disconnect);
	const title = level === "delete" ? "Delete Household?" : "Start fresh?";

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (confirmed) start.mutate();
	}

	const c = counts.data?.counts;
	// Only what's there: "0 Receipts" isn't something that will be cleared. The Plan's own line
	// below is always said, so the list is never empty.
	const items = c
		? (
				[
					[c.transactions, "Transaction"],
					[c.bankConnections, "bank connection"],
					[c.accounts, "Account"],
					[c.buckets, "Bucket"],
					[c.commitments, "Commitment"],
					[c.goals, "Goal"],
					[c.rules, "Rule"],
					[c.insights, "Insight"],
					[c.receipts, "Receipt"],
					[c.statementFiles, "statement file"],
				] as const
			)
				.filter(([n]) => n > 0)
				.map(([n, one]) => plural(n, one))
		: [];

	return (
		<Sheet open onOpenChange={(open) => (open ? null : onClose())}>
			{/* Step 1 can be taller than a small phone: its body scrolls and the buttons sit under it,
			    not over its last lines (#74). */}
			<SheetContent className={step === 1 ? "flex flex-col overflow-hidden" : undefined}>
				{step === 1 ? (
					<>
						<SheetHeader
							title={title}
							description={
								level === "delete"
									? "Everything below goes, and so do the Household, its Parents and Children."
									: "Everything below goes. Your Household, its Parents and Children stay."
							}
						/>
						<div className="-mx-1 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-1 text-sm">
							{/* What matters most is said first, where it's read before anything scrolls. */}
							{level === "delete" ? (
								<p>
									<span className="font-medium">This can’t be undone.</span> Noodle keeps one last
									snapshot for {FINAL_SNAPSHOT_DAYS} days, then deletes it. You can’t put it back
									yourself.
								</p>
							) : (
								<p>
									<span className="font-medium">Noodle takes a snapshot first.</span> For up to{" "}
									{SNAPSHOT_KEPT_DAYS} days you can put your Household back from Snapshots in
									Household settings.
								</p>
							)}
							{counts.isPending ? (
								<p className="text-muted-foreground">Counting what’s there…</p>
							) : counts.isError ? (
								<FormError>We couldn’t count what’s there. Please try again.</FormError>
							) : (
								<ul aria-label="What will be cleared" className="grid list-disc gap-1 ps-5">
									{items.map((item) => (
										<li key={item}>{item}</li>
									))}
									{level === "delete" ? <li>Every snapshot in Snapshots</li> : null}
									<li>Every month’s Plan, its changes, and Noodle’s notes on your spending</li>
								</ul>
							)}
							<p>
								<Link
									to="/household"
									hash="your-data"
									className="underline underline-offset-2"
									onClick={onClose}
								>
									Download everything first
								</Link>{" "}
								to keep a copy.{" "}
								{level === "delete"
									? "Save it to your phone or computer: a download left in Noodle is deleted too."
									: "Save it to your phone or computer: a download left in Noodle is cleared too, and doesn’t come back with a snapshot."}
							</p>
							<p>
								{level === "delete"
									? "On the next step you can choose to delete that last snapshot too."
									: "Statement and Receipt files come back with a snapshot: Noodle keeps them for as long as a snapshot needs them. Banks need connecting again."}
							</p>
						</div>
						<SheetFooter className="max-lg:grid-cols-2">
							<Button type="button" variant="outline" onClick={onClose}>
								Cancel
							</Button>
							<Button
								type="button"
								variant="destructive"
								disabled={!hydrated || !counts.data}
								onClick={() => setStep(2)}
							>
								Continue
							</Button>
						</SheetFooter>
					</>
				) : (
					<form onSubmit={onSubmit} className="grid gap-4">
						<SheetHeader title={title} description="Type the Household’s name to confirm." />
						{/* When it happens, said before it's confirmed and not only in the toast after
						    (issue 88): a day's wait with two Parents, at once with one. */}
						<p className="text-sm">
							{others.length > 0
								? `This happens in 24 hours. ${joined(others)} is told now, and either of you can cancel it until then.`
								: level === "delete"
									? "This happens as soon as you confirm, and can’t be stopped once it starts."
									: "This happens as soon as you confirm."}
						</p>
						<Field label={`Type “${householdName}”`} htmlFor={nameId}>
							<Input
								id={nameId}
								autoComplete="off"
								value={typed}
								onChange={(event) => setTyped(event.currentTarget.value)}
							/>
						</Field>
						{banks.length > 0 ? (
							// The whole row is the target, not just the box.
							<label
								htmlFor={banksId}
								className="flex cursor-pointer items-start gap-2 py-1 text-sm"
							>
								<Checkbox
									id={banksId}
									checked={disconnect}
									onCheckedChange={(checked) => setDisconnect(checked === true)}
								/>
								<span>Disconnect {joined(banks)} from Noodle</span>
							</label>
						) : null}
						{level === "delete" ? (
							<label
								htmlFor={backupsId}
								className="flex cursor-pointer items-start gap-2 py-1 text-sm"
							>
								<Checkbox
									id={backupsId}
									checked={deleteBackups}
									onCheckedChange={(checked) => setDeleteBackups(checked === true)}
								/>
								<span>
									Also delete the last snapshot
									<span className="block text-muted-foreground">
										{deleteBackups
											? "Nothing is kept."
											: `One last snapshot is kept for ${FINAL_SNAPSHOT_DAYS} days, then deleted.`}
									</span>
								</span>
							</label>
						) : null}
						{start.isError ? <FormError>We couldn’t start it. Please try again.</FormError> : null}
						<SheetFooter className="max-lg:grid-cols-2">
							<Button type="button" variant="outline" onClick={() => setStep(1)}>
								Back
							</Button>
							<Button
								type="submit"
								variant="destructive"
								disabled={!hydrated || !confirmed || start.isPending}
							>
								{level === "delete" ? "Delete Household" : "Start fresh"}
							</Button>
						</SheetFooter>
					</form>
				)}
			</SheetContent>
		</Sheet>
	);
}

/**
 * Over every page while a fresh start runs: its progress, then "All cleared" with the way into
 * the get-started wizard. Delete Household ends on /welcome instead.
 */
export function FreshStartScreen() {
	const progress = useFreshStartProgress();
	const router = useRouter();
	const queryClient = useQueryClient();
	const finished = progress?.state === "cleared" || progress?.state === "done";

	// If the Agent's messages are missed, ask the server; gone (or no Household) means finished.
	useEffect(() => {
		if (!progress || finished) return;
		const timer = setInterval(async () => {
			let status: FreshStartStatus | undefined;
			try {
				status = await getFreshStartStatus();
			} catch {
				status = null;
			}
			if (status === null) setFreshStartProgress({ ...progress, state: "done" });
		}, 4000);
		return () => clearInterval(timer);
	}, [progress, finished]);

	useEffect(() => {
		if (finished && progress?.level === "delete") window.location.assign("/welcome");
	}, [finished, progress?.level]);

	const setup = useMutation({
		// A cleared Household has no setup progress left; restarting writes a fresh row at Hello.
		mutationFn: () => restartSetup(),
		onSuccess: async () => {
			queryClient.removeQueries({ queryKey: setupQuery().queryKey });
			setFreshStartProgress(null);
			await router.navigate({ to: "/setup" });
		},
	});

	if (!progress) return null;
	const what = progress.level === "delete" ? "Deleting the Household" : "Starting fresh";
	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-background p-4">
			<Card className="grid w-full max-w-sm gap-3 p-(--card-pad)" role="status">
				{finished && progress.level === "fresh-start" ? (
					<>
						<h1 className="text-lg font-semibold">All cleared</h1>
						<p className="text-sm text-muted-foreground">
							Your Household is empty and ready to set up again.
						</p>
						<Button disabled={setup.isPending} onClick={() => setup.mutate()}>
							Set up your Household
						</Button>
						{setup.isError ? (
							<FormError>We couldn’t start setup. Please try again.</FormError>
						) : null}
					</>
				) : (
					<>
						<h1 className="text-lg font-semibold">{what}</h1>
						<p className="text-sm text-muted-foreground">
							{finished
								? "Done."
								: `${progress.label ?? "Working"}… ${progress.step} of ${progress.steps}`}
						</p>
					</>
				)}
			</Card>
		</div>
	);
}
