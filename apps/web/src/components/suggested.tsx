import type { SuggestionItem } from "@noodle/db";
import { type DayKey, parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { formatMoney, formatMoneyInput, shortDay } from "../format";
import { suggestionsQuery } from "../queries";
import { decideSuggestion } from "../server/suggestions";
import { CommitmentFormErrors, readCommitment, ScheduleFields } from "./commitment-editor";

// The "Suggested" card (ADR-0027): what background AI spotted, with its evidence in plain words, to
// add with one tap or put away. Never on This Month (#76): each shows in context, only the kinds
// that page is about (Rules on Review, Commitments under Plan › Commitments, Buckets under
// the Buckets on the Plan's first page). Quiet, and gone when
// there's nothing. Add on a new Bucket or Commitment opens its terms first, filled in, so the Parent
// can change the name, amount or schedule before it goes in the Plan.

type Decision = {
	suggestionId: string;
	decision: "add" | "not-now";
	terms?: { name: string; amountCents: number; cadence?: Terms["cadence"]; dueDate?: string };
};

const every = { monthly: "a month", biweekly: "every two weeks", annual: "a year" } as const;

type Terms = {
	name: string;
	amountCents: number;
	fromCents?: number;
	cadence?: keyof typeof every;
	dueDate?: string;
	bucketName?: string;
	/** Why it looks like a bill, like "Verizon Wireless, $85 on the 12th, 3 months running" (#76). */
	reason?: string;
};

function words(item: SuggestionItem): { title: string; body: string; add: string } {
	const terms = item.payload as Terms;
	const { count, months } = item.evidence;
	const money = formatMoney(terms.amountCents);
	if (item.kind === "rule")
		return {
			title: `Always put ${terms.name} in ${terms.bucketName ?? "the same Bucket"}?`,
			body: `You've done it ${count} times. A Rule files it there from now on.`,
			add: "Add Rule",
		};
	if (item.kind === "new-bucket")
		return {
			title: `A Bucket for ${terms.name}`,
			body: `About ${money} a month across ${count} charges in the last ${months} months, with no Bucket of its own.`,
			add: "Add Bucket",
		};
	const often = every[terms.cadence ?? "monthly"];
	if (item.kind === "commitment-amount")
		return {
			title: `${terms.name} now costs ${money}`,
			body: `It's set to ${formatMoney(terms.fromCents ?? 0)}. The last ${count} charges were about ${money}.`,
			add: "Update",
		};
	return {
		title: `${terms.name} looks like a Commitment`,
		// Older suggestions, saved before the reason, fall back to the plain evidence.
		body: terms.reason
			? `${terms.reason}.${terms.dueDate ? ` Next due ${shortDay(terms.dueDate as never)}.` : ""}`
			: `${money} ${often}, seen ${count} times.${terms.dueDate ? ` Next due ${shortDay(terms.dueDate as never)}.` : ""}`,
		add: "Add Commitment",
	};
}

export function Suggested({
	className,
	kinds,
}: {
	className?: string;
	/** Only these kinds (all when left out). */
	kinds?: SuggestionItem["kind"][];
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const { data } = useQuery(suggestionsQuery());
	const [editing, setEditing] = useState<string | null>(null);
	// Every decision still on its way, not only the latest: each row stays hidden while its own
	// request is in flight (and until the list is read again), and comes back only if it failed.
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const decide = useMutation({
		mutationFn: (variables: Decision) => decideSuggestion({ data: variables }),
		onMutate: ({ suggestionId }) => setPending((ids) => new Set(ids).add(suggestionId)),
		onSettled: async (_data, _error, { suggestionId }) => {
			try {
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: ["suggestions"] }),
					queryClient.invalidateQueries({ queryKey: ["rules"] }),
				]);
			} finally {
				setPending((ids) => new Set([...ids].filter((id) => id !== suggestionId)));
			}
		},
	});
	const open = stillOpen(data ?? [], kinds, pending);
	if (open.length === 0) return null;
	return (
		<Card
			className={cn("grid gap-3 p-(--card-pad)", className)}
			aria-labelledby={id}
			data-testid="suggested"
		>
			<h2 id={id} className="font-semibold text-base">
				Suggested
			</h2>
			<ul className="grid gap-4">
				{open.map((item) => {
					const { title, body, add } = words(item);
					const name = (item.payload as Terms).name;
					return (
						<li key={item.id} className="grid gap-2">
							<div className="grid gap-1">
								<p className="font-medium">{title}</p>
								<p className="text-muted-foreground text-sm">{body}</p>
								{item.personal ? <Badge variant="default">Only you see this</Badge> : null}
							</div>
							<div className="flex flex-wrap gap-2">
								{/* Outline, not filled: a suggestion stays quiet beside the page's own actions. */}
								<Button
									size="sm"
									variant="outline"
									aria-label={`${add}: ${name}`}
									aria-expanded={editable(item) ? editing === item.id : undefined}
									onClick={() =>
										editable(item)
											? setEditing(editing === item.id ? null : item.id)
											: decide.mutate({ suggestionId: item.id, decision: "add" })
									}
								>
									{add}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									aria-label={`Not now: ${name}`}
									onClick={() => decide.mutate({ suggestionId: item.id, decision: "not-now" })}
								>
									Not now
								</Button>
							</div>
							{editing === item.id ? (
								<EditBeforeAdd
									item={item}
									add={add}
									onCancel={() => setEditing(null)}
									onSave={(terms) => {
										setEditing(null);
										decide.mutate({ suggestionId: item.id, decision: "add", terms });
									}}
								/>
							) : null}
						</li>
					);
				})}
			</ul>
		</Card>
	);
}

/** The suggestions a page shows: its kinds, less those with a decision on its way. */
export const stillOpen = <T extends Pick<SuggestionItem, "id" | "kind">>(
	items: T[],
	kinds: SuggestionItem["kind"][] | undefined,
	pending: ReadonlySet<string>,
): T[] => items.filter((item) => (!kinds || kinds.includes(item.kind)) && !pending.has(item.id));

const editable = (item: SuggestionItem) =>
	item.kind === "new-bucket" || item.kind === "new-commitment";

/** A new Bucket's or Commitment's terms as suggested, to change before adding. */
function EditBeforeAdd({
	item,
	add,
	onSave,
	onCancel,
}: {
	item: SuggestionItem;
	add: string;
	onSave: (terms: NonNullable<Decision["terms"]>) => void;
	onCancel: () => void;
}) {
	const id = useId();
	const terms = item.payload as Terms;
	const commitment = item.kind === "new-commitment";
	const [errors, setErrors] = useState<{ name?: boolean; amount?: boolean; dueDate?: boolean }>({});
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		if (commitment) {
			const read = readCommitment(form);
			setErrors(read.errors);
			if (read.ok) onSave(read.terms);
			return;
		}
		const values = new FormData(form);
		const name = String(values.get("name") ?? "").trim();
		const amountCents = parseDollars(String(values.get("amount") ?? ""));
		setErrors({ name: name === "", amount: amountCents === null });
		if (name !== "" && amountCents !== null) onSave({ name, amountCents });
	}
	return (
		<form
			onSubmit={onSubmit}
			noValidate
			aria-label={`${add}: ${terms.name}, before adding`}
			className="grid gap-3 rounded-xl bg-surface-2 p-3"
		>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						name="name"
						maxLength={40}
						autoComplete="off"
						defaultValue={terms.name}
						className="bg-card"
						aria-invalid={errors.name || undefined}
					/>
				</Field>
				<Field label={commitment ? "Amount due" : "A month"} htmlFor={`${id}-amount`}>
					<Input
						id={`${id}-amount`}
						name="amount"
						inputMode="decimal"
						autoComplete="off"
						defaultValue={formatMoneyInput(terms.amountCents)}
						className="bg-card tabular-nums"
						aria-invalid={errors.amount || undefined}
					/>
				</Field>
			</div>
			{commitment ? (
				<>
					<ScheduleFields
						id={id}
						cadence={terms.cadence ?? "monthly"}
						dueDate={terms.dueDate as DayKey}
						dueLabel="Next due"
						invalid={errors.dueDate}
					/>
					<CommitmentFormErrors errors={errors} />
				</>
			) : (
				<>
					{errors.name ? <FormError>Give the Bucket a name.</FormError> : null}
					{errors.amount ? <FormError>Type an amount, like 130.</FormError> : null}
				</>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="sm">
					{add}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
