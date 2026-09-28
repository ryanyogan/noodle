import type { MemberSummary } from "@noodle/db";
import { type For, type ForTotals, forTotals, type MonthKey } from "@noodle/domain";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { forTotalsEarlierQuery, membersQuery, monthQuery } from "./queries";
import type { ForTotalsEarlier } from "./server/members";

export type { MemberSummary };

/**
 * The Members For can name, in picker order: Children, then Parents. Removed Children are left
 * out unless `keep` already names them, so an old Transaction still shows who it was For.
 */
export function pickableMembers(members: MemberSummary[], keep: For = []): MemberSummary[] {
	const shown = members.filter((m) => !m.removed || keep.includes(m.id));
	return [...shown.filter((m) => m.kind === "child"), ...shown.filter((m) => m.kind === "parent")];
}

/** "Everyone", "Maya", "Maya & Leo", or "Maya, Leo & Alex". */
export function forLabel(members: MemberSummary[], value: For): string {
	if (value.length === 0) return "Everyone";
	const names = pickableMembers(members, value)
		.filter((m) => value.includes(m.id))
		.map((m) => m.name);
	if (names.length === 0) return "Someone";
	return names.length === 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/** The Household's Children still in it, in the order they were added. */
export const childrenOf = (members: MemberSummary[]) =>
	members.filter((m) => m.kind === "child" && !m.removed);

/**
 * What was spent For each Member in `month` and in its year so far. The month's part comes from
 * its cached inputs, so a Quick Add or an edit moves these at once too (ADR-0006).
 */
export function useForTotals(month: MonthKey): {
	month: ForTotals;
	yearToDate: ForTotals;
	/** Every Bucket either can name, archived ones included. */
	buckets: ForTotalsEarlier["buckets"];
} {
	const { spending } = useSuspenseQuery(monthQuery(month)).data;
	const earlier = useSuspenseQuery(forTotalsEarlierQuery(month)).data;
	return {
		month: forTotals(spending),
		yearToDate: forTotals(spending, earlier.totals),
		buckets: earlier.buckets,
	};
}

/**
 * A change to the Household's Members, applied to the cached list at once and rolled back if
 * it fails; the returned mutation's `isError` and `variables` let the caller offer a retry.
 */
export function useMemberChange<TVariables>({
	save,
	apply,
}: {
	save: (variables: TVariables) => Promise<unknown>;
	apply: (members: MemberSummary[], variables: TVariables) => MemberSummary[];
}) {
	const queryClient = useQueryClient();
	const { queryKey } = membersQuery();
	return useMutation({
		mutationKey: ["member-change"],
		mutationFn: save,
		onMutate: async (variables) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, apply(previous, variables));
			return { previous };
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
		},
		onSettled: () => {
			if (queryClient.isMutating({ mutationKey: ["member-change"] }) === 1) {
				return queryClient.invalidateQueries({ queryKey });
			}
		},
	});
}

// The optimistic edits, mirroring what each server function records.

export const withChild = (
	members: MemberSummary[],
	{ memberId, name, color }: { memberId: string; name: string; color: number },
) =>
	members.some((m) => m.id === memberId)
		? members
		: [...members, { id: memberId, name, kind: "child" as const, color, removed: false }];

export const withChildDetails = (
	members: MemberSummary[],
	{ memberId, name, color }: { memberId: string; name?: string; color?: number },
) =>
	members.map((m) =>
		m.id === memberId ? { ...m, name: name ?? m.name, color: color ?? m.color } : m,
	);

export const withoutChild = (members: MemberSummary[], { memberId }: { memberId: string }) =>
	members.map((m) => (m.id === memberId ? { ...m, removed: true } : m));
