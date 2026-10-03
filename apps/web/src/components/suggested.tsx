import type { SuggestionItem } from "@noodle/db";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { formatMoney, shortDay } from "../format";
import { suggestionsQuery } from "../queries";
import { decideSuggestion } from "../server/suggestions";

// The "Suggested" card on This Month (ADR-0027): what background AI spotted, with its evidence in
// plain words, to add with one tap or put away. Quiet, and gone when there's nothing.

const every = { monthly: "a month", biweekly: "every two weeks", annual: "a year" } as const;

type Terms = {
	name: string;
	amountCents: number;
	fromCents?: number;
	cadence?: keyof typeof every;
	dueDate?: string;
};

function words(item: SuggestionItem): { title: string; body: string; add: string } {
	const terms = item.payload as Terms;
	const { count, months } = item.evidence;
	const money = formatMoney(terms.amountCents);
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
		body: `${money} ${often}, seen ${count} times.${terms.dueDate ? ` Next due ${shortDay(terms.dueDate as never)}.` : ""}`,
		add: "Add Commitment",
	};
}

export function Suggested({ className }: { className?: string }) {
	const id = useId();
	const queryClient = useQueryClient();
	const { data } = useQuery(suggestionsQuery());
	const decide = useMutation({
		mutationFn: (variables: { suggestionId: string; decision: "add" | "not-now" }) =>
			decideSuggestion({ data: variables }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["suggestions"] }),
	});
	const open = (data ?? []).filter(
		(item) => !(decide.isPending && decide.variables?.suggestionId === item.id),
	);
	if (open.length === 0) return null;
	return (
		<Card className={cn("grid gap-3 p-4", className)} aria-labelledby={id} data-testid="suggested">
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
									onClick={() => decide.mutate({ suggestionId: item.id, decision: "add" })}
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
						</li>
					);
				})}
			</ul>
		</Card>
	);
}
