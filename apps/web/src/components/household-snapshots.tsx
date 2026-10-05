import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Camera, ChevronDown, History, Moon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
	getRestoreStatus,
	getSnapshots,
	restoreSnapshot,
	type SnapshotSummary,
	takeSnapshotNow,
} from "../server/snapshots";
import { foldSnapshots } from "../snapshot-fold";
import { PhoneMore } from "./phone-more";

// Household → Your data → Snapshots (#78, ADR-0035): the history, and taking one by hand. A
// snapshot holds both Parents' data, so only when, who, the note, size and a few counts are shown.
// Restore sits behind a typed confirmation, like Fresh start. At rest only the newest snapshot
// shows, at every width; the rest are behind "Show all N snapshots" (#88, at the Parent's request).

export const snapshotsQuery = () =>
	queryOptions({ queryKey: ["snapshots"], queryFn: () => getSnapshots() });

export function kindLabel(snapshot: Pick<SnapshotSummary, "kind" | "takenBy">): string {
	switch (snapshot.kind) {
		case "nightly":
			return "Nightly";
		case "manual":
			return snapshot.takenBy ? `Taken by ${snapshot.takenBy}` : "Taken by hand";
		case "before-restore":
			return "Before a restore";
		case "before-fresh-start":
			return "Before Fresh start";
		case "before-delete":
			return "Before Delete Household";
		case "before-rule-apply":
			return "Before applying a Rule";
	}
}

export function sizeLabel(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const when = (ms: number) =>
	new Date(ms).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});

const plural = (n: number, one: string) =>
	`${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

/** The typed confirmation before a restore: what it does, then the Household's name. */
function RestoreSheet({
	snapshot,
	householdName,
	onClose,
	onStarted,
}: {
	snapshot: SnapshotSummary;
	householdName: string;
	onClose: () => void;
	onStarted: (restoreId: string) => void;
}) {
	const hydrated = useHydrated();
	const nameId = useId();
	const [typed, setTyped] = useState("");
	const start = useMutation({
		mutationFn: () => restoreSnapshot({ data: { id: snapshot.id, typedName: typed } }),
		onSuccess: (result) => {
			if (result.ok) onStarted(result.restoreId);
		},
	});
	const confirmed = typed.trim() === householdName.trim();
	const refused = start.data && !start.data.ok ? start.data.reason : null;
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (confirmed) start.mutate();
	}
	return (
		<Sheet open onOpenChange={(open) => (open ? null : onClose())}>
			<SheetContent>
				<form onSubmit={onSubmit} className="grid gap-4">
					<SheetHeader
						title="Restore this snapshot?"
						description={`${kindLabel(snapshot)}, ${when(snapshot.createdAt)}`}
					/>
					<ul aria-label="What a restore does" className="grid list-disc gap-1 ps-5 text-sm">
						<li>
							Everything in your Household now is replaced with what was there then:{" "}
							{plural(snapshot.counts.transactions, "Transaction")},{" "}
							{plural(snapshot.counts.buckets, "Bucket")} and{" "}
							{plural(snapshot.counts.goals, "Goal")}.
						</li>
						<li>Noodle takes a snapshot of how things are now first, so you can come back.</li>
						<li>A bank linked since then is disconnected.</li>
						<li>The other Parent is told.</li>
					</ul>
					<Field label={`Type “${householdName}”`} htmlFor={nameId}>
						<Input
							id={nameId}
							autoComplete="off"
							value={typed}
							onChange={(event) => setTyped(event.currentTarget.value)}
						/>
					</Field>
					{refused ? <FormError>{refused}</FormError> : null}
					{start.isError ? <FormError>We couldn’t start it. Please try again.</FormError> : null}
					<SheetFooter className="max-lg:grid-cols-2">
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="destructive"
							disabled={!hydrated || !confirmed || start.isPending}
						>
							{start.isPending ? "Starting…" : "Restore"}
						</Button>
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	);
}

export function HouseholdSnapshots({ householdName }: { householdName: string }) {
	const queryClient = useQueryClient();
	const [restoring, setRestoring] = useState<SnapshotSummary | null>(null);
	const [restoreId, setRestoreId] = useState<string | null>(null);
	const restore = useQuery({
		queryKey: ["snapshot-restore", restoreId],
		queryFn: () => getRestoreStatus({ data: { id: restoreId ?? "" } }),
		enabled: restoreId !== null,
		refetchInterval: (query) => (query.state.data?.state === "running" ? 2000 : false),
	});
	const restoreState = restoreId ? (restore.data?.state ?? "running") : null;
	useEffect(() => {
		if (restoreState !== "done") return;
		toast("Restored. Your Household is back to how it was.");
		setRestoreId(null);
		// Everything on every screen may have changed.
		void queryClient.invalidateQueries();
	}, [restoreState, queryClient]);
	const hydrated = useHydrated();
	const noteId = useId();
	// The note is read from the form when it is sent, not kept in state: what a Parent types
	// before the page has finished loading would otherwise be wiped.
	const formRef = useRef<HTMLFormElement>(null);
	// Not remembered: every visit starts folded.
	const [showAll, setShowAll] = useState(false);
	const earlierId = useId();
	const snapshots = useQuery(snapshotsQuery());
	const take = useMutation({
		mutationFn: (data: { note?: string }) => takeSnapshotNow({ data }),
		onSuccess: (result) => {
			if (!result.ok) {
				toast(result.reason, { tone: "error" });
				return;
			}
			formRef.current?.reset();
			toast("Snapshot taken.");
			void queryClient.invalidateQueries({ queryKey: snapshotsQuery().queryKey });
		},
		onError: () => toast("Couldn’t take a snapshot. Try again.", { tone: "error" }),
	});
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
		take.mutate({ note: note || undefined });
	}
	const list = snapshots.data ?? [];
	const { latest, earlier, label: foldLabel } = foldSnapshots(list, showAll);
	const row = (snapshot: SnapshotSummary) => (
		<ListRow
			key={snapshot.id}
			leading={<Tile>{snapshot.kind === "nightly" ? <Moon /> : <Camera />}</Tile>}
			title={kindLabel(snapshot)}
			trailing={
				snapshot.restorable ? (
					<Button
						variant="ghost"
						aria-label={`Restore the snapshot from ${when(snapshot.createdAt)}`}
						disabled={!hydrated || restoreState === "running"}
						onClick={() => setRestoring(snapshot)}
					>
						Restore
					</Button>
				) : (
					<span className="text-sm text-muted-foreground">Can’t be restored</span>
				)
			}
			meta={
				<span className="flex w-full min-w-0 flex-col">
					<span>
						{when(snapshot.createdAt)} · {sizeLabel(snapshot.bytes)}
					</span>
					<span>
						{plural(snapshot.counts.transactions, "Transaction")},{" "}
						{plural(snapshot.counts.buckets, "Bucket")}, {plural(snapshot.counts.goals, "Goal")}
					</span>
					{snapshot.note ? <span className="truncate">“{snapshot.note}”</span> : null}
				</span>
			}
		/>
	);

	return (
		<Section aria-labelledby="snapshots">
			<SectionHeader
				id="snapshots"
				title="Snapshots"
				count={snapshots.data ? list.length : undefined}
			/>
			<Card className="grid gap-3 p-(--card-pad)">
				<div className="flex items-start gap-3 text-sm">
					<Tile>
						<History />
					</Tile>
					<div className="grid gap-1">
						<p>
							A copy of everything in your Household, kept so it can be put back. Noodle takes one
							every night; take one yourself before a big change.
						</p>
						<PhoneMore label="More about snapshots">
							<p className="text-muted-foreground">
								Snapshots hold both Parents’ data, so what’s in them is never shown or downloaded.
								Nightly ones are kept for 14 days, then one a week for 8 weeks; ones you take, for
								90 days.
							</p>
						</PhoneMore>
					</div>
				</div>
				<form
					ref={formRef}
					onSubmit={onSubmit}
					className="flex flex-col gap-2 sm:flex-row sm:items-end"
				>
					<div className="grid min-w-0 flex-1 gap-1">
						<label htmlFor={noteId} className="text-sm font-medium">
							Note <span className="font-normal text-muted-foreground">(optional)</span>
						</label>
						<Input
							id={noteId}
							name="note"
							maxLength={200}
							placeholder="Before we change the Plan"
						/>
					</div>
					<Button type="submit" variant="outline" disabled={!hydrated || take.isPending}>
						<Camera />
						{take.isPending ? "Taking…" : "Take a snapshot"}
					</Button>
				</form>
			</Card>
			{restoreState === "running" ? (
				<p role="status" className="text-sm font-medium">
					Restoring… This takes a minute. You can keep this page open.
				</p>
			) : null}
			{restoreState === "failed" && restore.data?.state === "failed" ? (
				<FormError>{restore.data.reason}</FormError>
			) : null}
			{snapshots.data && list.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No snapshots yet. The first nightly one is taken tonight.
				</p>
			) : (
				<List aria-label="Snapshot history">{latest ? row(latest) : null}</List>
			)}
			{foldLabel ? (
				<>
					<Button
						type="button"
						variant="link"
						className="min-h-11 justify-self-start px-0!"
						aria-expanded={showAll}
						aria-controls={showAll ? earlierId : undefined}
						onClick={() => setShowAll((all) => !all)}
					>
						{foldLabel}
						<ChevronDown className={cn("transition-transform", showAll && "rotate-180")} />
					</Button>
					{/* The rest follow the button, so a screen reader meets them straight after it. */}
					{showAll ? (
						<div id={earlierId} className="contents">
							<List aria-label="Earlier snapshots">{earlier.map(row)}</List>
						</div>
					) : null}
				</>
			) : null}
			{[latest, ...earlier].some((snapshot) => snapshot && !snapshot.restorable) ? (
				<p className="text-sm text-muted-foreground">
					A snapshot taken before Noodle’s last update changed how data is stored can’t be restored.
				</p>
			) : null}
			{restoring ? (
				<RestoreSheet
					snapshot={restoring}
					householdName={householdName}
					onClose={() => setRestoring(null)}
					onStarted={(id) => {
						setRestoring(null);
						setRestoreId(id);
						void queryClient.invalidateQueries({ queryKey: snapshotsQuery().queryKey });
					}}
				/>
			) : null}
		</Section>
	);
}
