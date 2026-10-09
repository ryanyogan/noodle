import type { MonthKey } from "@noodle/domain";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney, shortDay } from "./format";
import { monthQuery, monthsKey } from "./queries";
import {
	addPayToCome,
	changePayToCome,
	getPayToCome,
	getPayToComeChoices,
	type PayToComeArrived,
	type PayToComeLineChoice,
	type PayToComeWaiting,
	removePayToCome,
	sayPayToCome,
} from "./server/pay-to-come";

// Pay to come (issue 159, phase a), as Plan › Income says it: earned, not in yet.

/** Each Parent's Pay to come as `month` reads it. */
export const payToComeQuery = (month: MonthKey) =>
	queryOptions({
		// Under the month's key: Income landing refetches it, as it may be one arriving.
		queryKey: [...monthQuery(month).queryKey, "pay-to-come"],
		queryFn: () => getPayToCome({ data: { month } }),
	});

/** The lines of Income a Parent can say one arrived as. */
export const payToComeChoicesQuery = (id: string) =>
	queryOptions({
		queryKey: [...monthsKey, "pay-to-come-choices", id],
		queryFn: () => getPayToComeChoices({ data: { id } }),
	});

export type PayToComeDetails = { from: string; amountCents: number; expectedOn: string | null };

/** The new amount is less than what has already arrived of it. */
export class LessThanIn extends Error {}

/** Every month is read again after a change: one still waiting is listed in each. */
function usePayToComeChange<T>(change: (data: T) => Promise<{ ok: boolean; reason?: string }>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: T) => {
			const result = await change(data);
			if (!result.ok)
				throw result.reason === "less-than-in" ? new LessThanIn() : new Error("Refused");
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}

export const useAddPayToCome = () =>
	usePayToComeChange((data: PayToComeDetails & { id: string; memberId: string }) =>
		addPayToCome({ data }),
	);

export const useChangePayToCome = () =>
	usePayToComeChange((data: PayToComeDetails & { id: string }) => changePayToCome({ data }));

export const useRemovePayToCome = () =>
	usePayToComeChange((data: { id: string }) => removePayToCome({ data }));

/** "It's in" (all of it, or a part), or "not this". */
export const useSayPayToCome = () =>
	usePayToComeChange((data: { id: string; incomeId: string; is: "all" | "part" | "not-this" }) =>
		sayPayToCome({ data }),
	);

/** "Late by 12 days", "Late by 1 day". */
export const lateByText = (days: number) => `Late by ${days} ${days === 1 ? "day" : "days"}`;

/** Under who it is from: "Expected Oct 20", and what is in of it so far. */
export function waitingMeta(pay: PayToComeWaiting): string {
	const when = pay.expectedOn ? `Expected ${shortDay(pay.expectedOn)}` : "No day expected";
	return pay.left < pay.amount
		? `${when} · ${formatMoney(pay.amount - pay.left)} of ${formatMoney(pay.amount)} is in`
		: when;
}

/** "$1,775.00 came in Oct 9 (Larkspur wire)". */
export const cameInText = (line: Pick<PayToComeLineChoice, "amount" | "date" | "note">) =>
	`${formatMoney(line.amount)} came in ${shortDay(line.date)}${line.note?.trim() ? ` (${line.note.trim()})` : ""}`;

/** Under one that is in: "Posted Oct 9", with the Income's own amount when it differs. */
export const arrivedMeta = (arrival: PayToComeArrived) =>
	arrival.amount === arrival.covers
		? `Posted ${shortDay(arrival.date)}`
		: `Posted ${shortDay(arrival.date)} · ${formatMoney(arrival.amount)} of Income`;
