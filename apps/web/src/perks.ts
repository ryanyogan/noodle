import type { PerkSourceItem } from "@noodle/db";
import type { PerkSourceKind } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import { insightsQuery, perkSourcesQuery } from "./queries";
import { addPerkSource, decidePerkSource, updatePerkSource } from "./server/perks";

// Acting on Perk Sources from the screen. Each change that researches a Perk Source waits for
// the server, which starts the research (or, with the fakes, does it at once); the page then
// shows where it stands, and its Perks once they're read.

export type { PerkSourceItem };

/** Where reading a confirmed Perk Source's Perks stands, in a few words. */
export function researchStatus(source: Pick<PerkSourceItem, "research">): string | null {
	switch (source.research) {
		case "researching":
			return "Checking its Perks…";
		case "needs-plan":
			return "Which plan is it? Its Perks depend on the plan.";
		case "needs-link":
			return "Link its benefits page so Noodle can read its Perks.";
		case "unreadable":
			return "Couldn’t read its benefits page. Link another, or check again later.";
		default:
			return null;
	}
}

function useRefetchPerks() {
	const queryClient = useQueryClient();
	return () => {
		void queryClient.invalidateQueries({ queryKey: perkSourcesQuery().queryKey });
		// New Perks may make new Perk Overlaps; a removed one takes its own.
		void queryClient.invalidateQueries({ queryKey: insightsQuery().queryKey });
	};
}

type Decision = { source: PerkSourceItem; status: "confirmed" | "dismissed" };

/** Confirms a suggested Perk Source, or dismisses or removes one. */
export function useDecidePerkSource() {
	const refetch = useRefetchPerks();
	const decide = useMutation({
		mutationFn: ({ source, status }: Decision) =>
			decidePerkSource({ data: { id: source.id, status } }),
		onError: (_error, decision) =>
			toast(
				`Couldn’t ${decision.status === "confirmed" ? "confirm" : "remove"} ${decision.source.name}.`,
				{
					tone: "error",
					action: { label: "Retry", onClick: () => decide.mutate(decision) },
				},
			),
		onSuccess: (_data, { source, status }) =>
			toast(
				status === "confirmed"
					? `${source.name} added to Perk Sources`
					: source.status === "suggested"
						? `${source.name} won’t be suggested again`
						: `${source.name} removed`,
			),
		onSettled: refetch,
	});
	return decide;
}

export type NewPerkSource = {
	name: string;
	kind: PerkSourceKind;
	plan: string | null;
	pageUrl: string | null;
};

/** Adds a Perk Source for the Household. The ID is made once, so a retry doesn't add it twice. */
export function useAddPerkSource() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (source: NewPerkSource & { id: string }) => addPerkSource({ data: source }),
		onError: (_error, source) => toast(`Couldn’t add ${source.name}.`, { tone: "error" }),
		onSettled: refetch,
	});
}

export const newPerkSourceId = () => ulid();

/** Says which plan a Perk Source is, links its page, or checks it again. */
export function useUpdatePerkSource() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (change: { id: string; plan?: string; pageUrl?: string }) =>
			updatePerkSource({ data: change }),
		onError: () => toast("Couldn’t save that. Try again.", { tone: "error" }),
		onSettled: refetch,
	});
}
