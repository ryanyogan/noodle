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
import { Input } from "@noodle/ui/components/input";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { ScenarioView, useKeptScenarios } from "../../../components/scenario-view";
import { useDeleteScenario, useSaveScenario } from "../../../scenarios";

/**
 * A kept Scenario beside the Scenarios list (#67): read here (its Changes and its outcome against
 * the Plan), changed in Explore. A page with Back on a phone. `?compare=` is the list's, and is
 * kept while moving between Scenarios.
 */
export const Route = createFileRoute("/_authed/_household/explore/scenarios/$id")({
	ssr: "data-only",
	pendingComponent: DetailPending,
	component: ScenarioPane,
});

function ScenarioPane() {
	const { id } = Route.useParams();
	const { parentId } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const { years } = Route.useSearch();
	const kept = useKeptScenarios(parentId, years);
	const save = useSaveScenario();
	const remove = useDeleteScenario();
	const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
	const [name, setName] = useState("");
	const trimmed = name.trim();
	const found = kept.projected.find((p) => p.scenario.id === id);
	const back = (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/explore/scenarios" search aria-label="Back to Scenarios">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
	if (!found) {
		return (
			<>
				<DetailHeader title="Scenario" leading={back} />
				<p className="text-sm text-muted-foreground">This Scenario isn’t here any more.</p>
			</>
		);
	}
	const { scenario } = found;
	// Rename and Delete: in the header from lg; below that they come after the Scenario, and on a
	// phone they are outlined and share the row so they aren't missed (#74).
	const manage = (
		<>
			<Button
				variant="ghost"
				size="sm"
				className="max-sm:border-border-strong"
				onClick={() => {
					setName(scenario.name);
					setDialog("rename");
				}}
			>
				Rename
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="max-sm:border-border-strong"
				onClick={() => setDialog("delete")}
			>
				Delete
			</Button>
		</>
	);
	const openInExplore = (
		<Link to="/explore" search={{ scenario: scenario.id, years }}>
			Open in Explore
		</Link>
	);
	return (
		<>
			<DetailHeader
				eyebrow={scenario.appliedAt ? "Scenario · applied to the Plan" : "Scenario"}
				title={scenario.name}
				leading={back}
				actions={
					<>
						<div className="flex items-center gap-1 max-lg:hidden">{manage}</div>
						<Button asChild size="sm" className="max-sm:hidden">
							{openInExplore}
						</Button>
					</>
				}
				pager={
					<DetailPager
						ids={kept.projected.map((p) => p.scenario.id)}
						id={scenario.id}
						noun="Scenario"
						link={(to) => ({ to: "/explore/scenarios/$id", params: { id: to }, search: true })}
					/>
				}
			/>
			{/* A phone's header has no room for it beside the title and the pager: there it is the
			    page's one full-width action, under the header (#74). */}
			<Button asChild size="sm" className="mb-4 w-full sm:hidden">
				{openInExplore}
			</Button>
			<ScenarioView key={scenario.id} projected={found} kept={kept} />
			<div className="mt-6 flex justify-end gap-1 max-sm:grid max-sm:grid-cols-2 max-sm:gap-2 lg:hidden">
				{manage}
			</div>
			<AlertDialog open={dialog === "rename"} onOpenChange={(open) => !open && setDialog(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Rename Scenario</AlertDialogTitle>
						<AlertDialogDescription>The Plan doesn’t change.</AlertDialogDescription>
					</AlertDialogHeader>
					<Input
						aria-label="Scenario name"
						value={name}
						maxLength={40}
						onChange={(event) => setName(event.currentTarget.value)}
					/>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="default"
							disabled={trimmed === ""}
							onClick={() => {
								if (trimmed !== "") {
									save.mutate({ scenarioId: scenario.id, name: trimmed, levers: scenario.levers });
								}
							}}
						>
							Rename
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog open={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Scenario</AlertDialogTitle>
						<AlertDialogDescription>
							Delete “{scenario.name}”? The Plan doesn’t change.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								remove.mutate({ scenarioId: scenario.id, name: scenario.name });
								void navigate({ to: "/explore/scenarios", search: true });
							}}
						>
							Delete Scenario
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
