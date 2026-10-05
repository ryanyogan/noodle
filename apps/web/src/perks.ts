import type { PerkSourceItem } from "@noodle/db";
import { catalogEntryFor, type PerkRenewal, type PerkSourceKind } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import { insightsQuery, perkSourcesQuery } from "./queries";
import {
	addPerkSource,
	decidePerkSource,
	markPerkUsed,
	nameCard,
	removePerkUse,
	setPerkSourceFee,
	setPerkValue,
	updatePerkSource,
} from "./server/perks";

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

/** Says which card a linked card is, from its issuer's list or by name. */
export function useNameCard() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (change: { id: string; product: string }) => nameCard({ data: change }),
		onError: () => toast("Couldn’t save that. Try again.", { tone: "error" }),
		onSettled: refetch,
	});
}

/**
 * The confirmed credit-card Perk Sources with Perks that are this card Account's: the one Noodle
 * spotted in its name, or one the catalog knows as the same card.
 */
export function perkSourcesForAccount(
	account: { id?: string; name: string; kind: string },
	sources: PerkSourceItem[],
): PerkSourceItem[] {
	if (account.kind !== "credit-card") return [];
	const name = account.name.trim();
	const entry = catalogEntryFor(name);
	return sources.filter(
		(source) =>
			source.status === "confirmed" &&
			source.kind === "credit-card" &&
			source.perks.length > 0 &&
			(("id" in account && source.card?.accountId === account.id) ||
				source.seenIn === name ||
				source.name.trim().toLowerCase() === name.toLowerCase() ||
				(entry !== undefined && catalogEntryFor(source.name) === entry)),
	);
}

/** Takes back a use marked by hand. */
export function useRemovePerkUse() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (use: { id: string }) => removePerkUse({ data: use }),
		onError: () => toast("Couldn’t take that back. Try again.", { tone: "error" }),
		onSettled: refetch,
	});
}

export const newPerkUseId = () => ulid();

/** Marks a Perk used today, with a short note; the toast can take it back. */
export function useMarkPerkUsed() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (use: { id: string; perkId: string; name: string; note: string | null }) =>
			markPerkUsed({ data: { id: use.id, perkId: use.perkId, note: use.note } }),
		onError: (_error, use) => toast(`Couldn’t mark ${use.name} used.`, { tone: "error" }),
		onSuccess: (_data, use) =>
			toast(`${use.name} marked used`, { tone: "success", id: `perk-used-${use.perkId}` }),
		onSettled: refetch,
	});
}

/** Says what a card's annual fee is, or clears it. */
export function useSetAnnualFee() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (fee: { id: string; annualFeeCents: number | null }) =>
			setPerkSourceFee({ data: fee }),
		onError: () => toast("Couldn’t save the annual fee. Try again.", { tone: "error" }),
		onSettled: refetch,
	});
}

/** A Parent types a perk's value and how often it renews, when its page states none. */
export function useSetPerkValue() {
	const refetch = useRefetchPerks();
	return useMutation({
		mutationFn: (perk: {
			id: string;
			name: string;
			valueCents: number | null;
			renews: PerkRenewal | null;
		}) =>
			setPerkValue({
				data: { id: perk.id, valueCents: perk.valueCents, renews: perk.renews },
			}),
		onError: (_error, perk) => toast(`Couldn’t save the value of ${perk.name}.`, { tone: "error" }),
		onSettled: refetch,
	});
}
