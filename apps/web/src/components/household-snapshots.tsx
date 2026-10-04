import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Camera, History, Moon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { getSnapshots, type SnapshotSummary, takeSnapshotNow } from "../server/snapshots";

// Household → Your data → Snapshots (#78, ADR-0035): the history, and taking one by hand. A
// snapshot holds both Parents' data, so only when, who, the note, size and a few counts are shown.

export const snapshotsQuery = () =>
	queryOptions({ queryKey: ["snapshots"], queryFn: () => getSnapshots() });

const SHOWN = 8;

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

export function HouseholdSnapshots() {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const noteId = useId();
	const [note, setNote] = useState("");
	const [showAll, setShowAll] = useState(false);
	const snapshots = useQuery(snapshotsQuery());
	const take = useMutation({
		mutationFn: (data: { note?: string }) => takeSnapshotNow({ data }),
		onSuccess: (result) => {
			if (!result.ok) {
				toast(result.reason, { tone: "error" });
				return;
			}
			setNote("");
			toast("Snapshot taken.");
			void queryClient.invalidateQueries({ queryKey: snapshotsQuery().queryKey });
		},
		onError: () => toast("Couldn’t take a snapshot. Try again.", { tone: "error" }),
	});
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		take.mutate({ note: note.trim() || undefined });
	}
	const list = snapshots.data ?? [];
	const shown = showAll ? list : list.slice(0, SHOWN);

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
						<p className="text-muted-foreground">
							Snapshots hold both Parents’ data, so what’s in them is never shown or downloaded.
							Nightly ones are kept for 14 days, then one a week for 8 weeks; ones you take, for 90
							days.
						</p>
					</div>
				</div>
				<form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
					<div className="grid min-w-0 flex-1 gap-1">
						<label htmlFor={noteId} className="text-sm font-medium">
							Note <span className="font-normal text-muted-foreground">(optional)</span>
						</label>
						<Input
							id={noteId}
							value={note}
							maxLength={200}
							placeholder="Before we change the Plan"
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>
					<Button type="submit" variant="outline" disabled={!hydrated || take.isPending}>
						<Camera />
						{take.isPending ? "Taking…" : "Take a snapshot"}
					</Button>
				</form>
			</Card>
			{snapshots.data && list.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No snapshots yet. The first nightly one is taken tonight.
				</p>
			) : (
				<List aria-label="Snapshot history">
					{shown.map((snapshot) => (
						<ListRow
							key={snapshot.id}
							leading={<Tile>{snapshot.kind === "nightly" ? <Moon /> : <Camera />}</Tile>}
							title={kindLabel(snapshot)}
							meta={
								<span className="flex w-full min-w-0 flex-col">
									<span>
										{when(snapshot.createdAt)} · {sizeLabel(snapshot.bytes)}
									</span>
									<span>
										{plural(snapshot.counts.transactions, "Transaction")},{" "}
										{plural(snapshot.counts.buckets, "Bucket")},{" "}
										{plural(snapshot.counts.goals, "Goal")}
									</span>
									{snapshot.note ? <span className="truncate">“{snapshot.note}”</span> : null}
								</span>
							}
						/>
					))}
				</List>
			)}
			{list.length > SHOWN ? (
				<Button
					variant="ghost"
					className="justify-self-start"
					onClick={() => setShowAll((all) => !all)}
				>
					{showAll ? "Show fewer" : `Show all ${list.length}`}
				</Button>
			) : null}
		</Section>
	);
}
