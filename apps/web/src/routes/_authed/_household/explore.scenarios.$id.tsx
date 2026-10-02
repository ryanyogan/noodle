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
	const kept = useKeptScenarios(parentId);
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
	return (
		<>
			<DetailHeader
				eyebrow={scenario.appliedAt ? "Scenario · applied to the Plan" : "Scenario"}
				title={scenario.name}
				leading={back}
				actions={
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setName(scenario.name);
								setDialog("rename");
							}}
						>
							Rename
						</Button>
						<Button variant="ghost" size="sm" onClick={() => setDialog("delete")}>
							Delete
						</Button>
						<Button asChild size="sm">
							<Link to="/explore" search={{ scenario: scenario.id }}>
								Open in Explore
							</Link>
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
			<ScenarioView key={scenario.id} projected={found} kept={kept} />
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
