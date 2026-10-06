import {
	type Cadence,
	type DraftBucket,
	type DraftCommitment,
	type PayCadence,
	type PlanDraft,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, formatMoneyInput, shortDay } from "../format";
import { monthChangeKey } from "../plan-changes";
import { monthsKey, planDraftQuery, suggestionsQuery } from "../queries";
import { acceptDraft, finishDraft, skipDraft } from "../server/plan-draft";
import { AmountInput } from "./goals";
import { SaveFailed } from "./plan-editing";

// The first Plan, drafted from the Household's history: take-home pay from the paychecks, the
// Commitments found, and a Bucket for each kind of everyday spending. Nothing is in the Plan until
// a Parent adds it, as it is or changed; each can be skipped, and "Done" puts the rest away.

const payWords: Record<PayCadence, string> = {
	weekly: "every week",
	biweekly: "every two weeks",
	monthly: "every month",
};

const cadenceWords: Record<Cadence, string> = {
	monthly: "a month",
	biweekly: "every two weeks",
	annual: "a year",
};

type Accepted = {
	baselineCents?: number;
	commitments?: ReturnType<typeof commitmentToAdd>[];
	buckets?: ReturnType<typeof bucketToAdd>[];
};
type Decision = { accept: Accepted } | { skip: string[] };

const keysOf = (decision: Decision) =>
	"skip" in decision
		? decision.skip
		: [
				...(decision.accept.baselineCents != null ? ["baseline"] : []),
				...(decision.accept.commitments ?? []).map((c) => c.key),
				...(decision.accept.buckets ?? []).map((b) => b.key),
			];

/** The draft without the suggestions just decided. */
const without = (draft: PlanDraft, keys: string[]): PlanDraft => ({
	...draft,
	baseline: draft.baseline && keys.includes("baseline") ? null : draft.baseline,
	commitments: draft.commitments.filter((c) => !keys.includes(c.key)),
	buckets: draft.buckets.filter((b) => !keys.includes(b.key)),
});

/** Adds or skips suggestions, taking them out of the draft at once. */
function useDecide() {
	const queryClient = useQueryClient();
	const { queryKey } = planDraftQuery();
	return useMutation({
		// A decision changes the Plan, so live updates and other changes wait for it (ADR-0006).
		mutationKey: monthChangeKey,
		mutationFn: (decision: Decision) =>
			"skip" in decision
				? skipDraft({ data: { keys: decision.skip } })
				: acceptDraft({ data: decision.accept }),
		onMutate: async (decision) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, without(previous, keysOf(decision)));
			return { previous };
		},
		onError: (_error, _decision, context) => {
			if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
		},
		// The Plan changed too, and the draft is under every month's key.
		// Only after the last of several quick decisions, so each one doesn't start a round.
		onSettled: () => {
			// What was added or skipped here is no longer suggested on the Plan's other pages.
			void queryClient.invalidateQueries({ queryKey: suggestionsQuery().queryKey });
			if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
				return queryClient.invalidateQueries({ queryKey: monthsKey });
			}
		},
	});
}

const commitmentToAdd = (c: DraftCommitment, name = c.name, amountCents = c.amount) => ({
	key: c.key,
	commitmentId: ulid(),
	name,
	amountCents,
	cadence: c.cadence,
	dueDate: c.dueDate,
	// A utility is added as an "about" amount: it varies (issue 135).
	...(c.about ? { about: true } : {}),
});

const bucketToAdd = (b: DraftBucket, name = b.name, allowanceCents = b.allowance) => ({
	key: b.key,
	bucketId: ulid(),
	name,
	allowanceCents,
});

/** The first Plan's draft, while there's anything left in it. */
export function PlanDraftSection({ planned = [] }: { planned?: string[] }) {
	const { data: draft } = useQuery(planDraftQuery());
	const decide = useDecide();
	const queryClient = useQueryClient();
	const finish = useMutation({
		mutationFn: () => finishDraft(),
		onMutate: () => queryClient.setQueryData(planDraftQuery().queryKey, null),
		onSettled: () => queryClient.invalidateQueries({ queryKey: planDraftQuery().queryKey }),
	});
	if (!draft) return null;
	const { baseline, commitments } = draft;
	// A Bucket added another way (the Add Buckets sheet) isn't offered again.
	const named = new Set(planned.map((name) => name.trim().toLowerCase()));
	const buckets = draft.buckets.filter((b) => !named.has(b.name.trim().toLowerCase()));
	if (!baseline && commitments.length === 0 && buckets.length === 0) return null;
	return (
		<Section aria-labelledby="plan-draft">
			<SectionHeader id="plan-draft" title="Drafted from your history" />
			<p className="-mt-1 text-[13px] text-muted-foreground">
				From your statements, {shortDay(draft.from)} to {shortDay(draft.through)}. Nothing is in the
				Plan until you add it.
			</p>
			{baseline ? (
				<Group title="Take-home pay">
					<List>
						<Suggestion
							name="Take-home pay"
							meta={baseline.paychecks
								.map((p) => `${p.name} · ${formatMoney(p.amount)} ${payWords[p.cadence]}`)
								.join("; ")}
							amount={baseline.amount}
							per="a month"
							onAdd={(_name, amountCents) =>
								decide.mutate({ accept: { baselineCents: amountCents } })
							}
							onSkip={() => decide.mutate({ skip: ["baseline"] })}
						/>
					</List>
				</Group>
			) : null}
			{commitments.length > 0 ? (
				<Group
					title="Commitments"
					onAddAll={() =>
						decide.mutate({ accept: { commitments: commitments.map((c) => commitmentToAdd(c)) } })
					}
				>
					<List>
						{commitments.map((c) => (
							<Suggestion
								key={c.key}
								name={c.name}
								renamable
								meta={`Last charged ${shortDay(c.dueDate)}${c.about ? " · it varies, so it’s added as About" : ""}`}
								amount={c.amount}
								per={cadenceWords[c.cadence]}
								onAdd={(name, amountCents) =>
									decide.mutate({
										accept: { commitments: [commitmentToAdd(c, name, amountCents)] },
									})
								}
								onSkip={() => decide.mutate({ skip: [c.key] })}
							/>
						))}
					</List>
				</Group>
			) : null}
			{buckets.length > 0 ? (
				<Group
					title="Buckets"
					onAddAll={() =>
						decide.mutate({ accept: { buckets: buckets.map((b) => bucketToAdd(b)) } })
					}
				>
					<List>
						{buckets.map((b) => (
							<Suggestion
								key={b.key}
								name={b.name}
								renamable
								meta={`${b.merchants.slice(0, 3).join(", ")} · about ${formatMoney(Math.round(b.monthly / 100) * 100)} a month`}
								amount={b.allowance}
								per="a month"
								onAdd={(name, amountCents) =>
									decide.mutate({ accept: { buckets: [bucketToAdd(b, name, amountCents)] } })
								}
								onSkip={() => decide.mutate({ skip: [b.key] })}
							/>
						))}
					</List>
				</Group>
			) : null}
			<SaveFailed change={decide} />
			<div className="flex items-center justify-between gap-3">
				<p className="text-[13px] text-muted-foreground">
					Anything you don’t add stays out of the Plan.
				</p>
				<Button variant="secondary" size="sm" onClick={() => finish.mutate()}>
					Done
				</Button>
			</div>
		</Section>
	);
}

function Group({
	title,
	onAddAll,
	children,
}: {
	title: string;
	onAddAll?: () => void;
	children: ReactNode;
}) {
	const hydrated = useHydrated();
	const id = useId();
	return (
		<section aria-labelledby={id} className="grid gap-2">
			<div className="flex min-h-7 items-center justify-between gap-3">
				<h3 id={id} className="text-[13px] font-medium text-muted-foreground">
					{title}
				</h3>
				{onAddAll ? (
					<Button
						variant="ghost"
						size="sm"
						className="-me-2.5"
						disabled={!hydrated}
						onClick={onAddAll}
					>
						Add all {title}
					</Button>
				) : null}
			</div>
			{children}
		</section>
	);
}

/** One suggestion: add it as it is, change it first, or skip it. */
function Suggestion({
	name,
	renamable = false,
	meta,
	amount,
	per,
	onAdd,
	onSkip,
}: {
	name: string;
	renamable?: boolean;
	meta: string;
	amount: number;
	per: string;
	onAdd: (name: string, amountCents: number) => void;
	onSkip: () => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [changing, setChanging] = useState(false);
	const [invalid, setInvalid] = useState(false);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const amountCents = parseDollars(String(form.get("amount")));
		const newName = renamable ? String(form.get("name")).trim() : name;
		const ok = amountCents !== null && newName.length > 0 && newName.length <= 40;
		setInvalid(!ok);
		if (ok) onAdd(newName, amountCents);
	}

	return (
		<ListRow
			aria-label={name}
			title={name}
			meta={<span className="min-w-0 break-words">{meta}</span>}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">{formatMoney(amount)}</span>
					<span className="text-xs text-subtle-foreground">{per}</span>
				</>
			}
			below={
				changing ? (
					<form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
						{renamable ? (
							<>
								<label htmlFor={`${id}-name`} className="sr-only">
									Name
								</label>
								<Input
									id={`${id}-name`}
									name="name"
									autoComplete="off"
									defaultValue={name}
									maxLength={40}
									className="w-full sm:w-48"
									aria-invalid={invalid || undefined}
								/>
							</>
						) : null}
						<label htmlFor={`${id}-amount`} className="sr-only">
							Amount
						</label>
						<AmountInput
							id={`${id}-amount`}
							name="amount"
							className="w-32"
							enterKeyHint="done"
							autoFocus={!renamable}
							defaultValue={formatMoneyInput(amount)}
							aria-invalid={invalid || undefined}
						/>
						<Button type="submit" size="sm">
							Add
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={() => setChanging(false)}>
							Cancel
						</Button>
					</form>
				) : (
					<div className="-ms-2.5 flex flex-wrap gap-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={!hydrated}
							onClick={() => onAdd(name, amount)}
						>
							Add
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={!hydrated}
							onClick={() => setChanging(true)}
						>
							Change
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-muted-foreground"
							disabled={!hydrated}
							onClick={onSkip}
						>
							Skip
						</Button>
					</div>
				)
			}
		/>
	);
}
