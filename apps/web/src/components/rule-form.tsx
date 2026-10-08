import type { For, PlanBucket, PlanCommitment } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Combobox } from "@noodle/ui/components/combobox";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { SheetCancel, SheetFooter } from "@noodle/ui/components/sheet";
import { useHydrated } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import type { MemberSummary } from "../members";
import { type RuleRow, useApplyRule, useDeleteRule, useEditRule, useSaveRule } from "../review";
import { ForPicker } from "./for-picker";
import { BILLS, billChoice, bucketChoice } from "./place-choices";
import { Confirm } from "./plan-editing";

/**
 * Adds a Rule (`rule` null), or changes one's merchant words, Bucket or Commitment, and For; files
 * what it matches (saving any change first); or deletes it.
 */
/** A Commitment's choice value, told apart from a Bucket's ID. */
const AS_COMMITMENT = "commitment:";

export function RuleForm({
	rule,
	buckets,
	commitments = [],
	members,
	onDone,
	inline = false,
	start,
}: {
	rule: RuleRow | null;
	/** A new Rule's merchant words, Bucket and For to start from (Review's card). */
	start?: { pattern: string; bucketId?: string; commitmentId?: string; for?: For };
	buckets: PlanBucket[];
	/** The month's Commitments, which a Rule can file into instead of a Bucket. */
	commitments?: Pick<PlanCommitment, "id" | "name">[];
	members: MemberSummary[];
	onDone: () => void;
	/** In the pane beside the list, not a sheet: Cancel goes back to the list. */
	inline?: boolean;
}) {
	const hydrated = useHydrated();
	const edit = useEditRule();
	const remove = useDeleteRule();
	const apply = useApplyRule();
	const add = useSaveRule();
	const [pattern, setPattern] = useState(rule?.pattern ?? start?.pattern ?? "");
	const startCommitment = rule ? rule.commitmentId : start?.commitmentId;
	const [target, setTarget] = useState(
		startCommitment
			? AS_COMMITMENT + startCommitment
			: (rule?.bucketId ?? start?.bucketId ?? buckets[0]?.id ?? ""),
	);
	const commitmentId = target.startsWith(AS_COMMITMENT) ? target.slice(AS_COMMITMENT.length) : null;
	const bucketId = commitmentId ? null : target;
	const [forIds, setForIds] = useState<For>(rule?.for ?? start?.for ?? []);
	const [deleting, setDeleting] = useState(false);
	const [missing, setMissing] = useState(false);
	// Its Bucket or Commitment stays pickable after leaving the Plan.
	const options =
		!rule?.bucketId || buckets.some((b) => b.id === rule.bucketId)
			? buckets
			: [...buckets, { id: rule.bucketId, name: rule.bucketName }];
	const commitmentOptions =
		!rule?.commitmentId || commitments.some((c) => c.id === rule.commitmentId)
			? commitments
			: [...commitments, { id: rule.commitmentId, name: rule.bucketName }];
	const bucketName =
		(commitmentId
			? commitmentOptions.find((c) => c.id === commitmentId)?.name
			: options.find((b) => b.id === bucketId)?.name) ??
		rule?.bucketName ??
		"";
	const unchanged =
		rule !== null &&
		pattern.trim() === rule.pattern &&
		bucketId === rule.bucketId &&
		commitmentId === rule.commitmentId &&
		forIds.join() === rule.for.join();

	function save(event: FormEvent) {
		event.preventDefault();
		if (!pattern.trim()) {
			setMissing(true);
			return;
		}
		if (!rule) {
			// A new Rule also files what's still unassigned that it matches, as Review's does.
			add.mutate({
				ruleId: ulid(),
				pattern: pattern.trim(),
				bucketId,
				commitmentId,
				bucketName,
				forMemberIds: forIds,
			});
		} else if (!unchanged) {
			edit.mutate({
				ruleId: rule.id,
				pattern: pattern.trim(),
				bucketId,
				commitmentId,
				bucketName,
				forMemberIds: forIds,
			});
		}
		onDone();
	}

	/** Files what the Rule matches, saving any change to it first. */
	function fileNow() {
		if (!rule) return;
		if (!pattern.trim()) {
			setMissing(true);
			return;
		}
		const edited = {
			...rule,
			pattern: pattern.trim(),
			bucketId,
			commitmentId,
			bucketName,
			for: forIds,
		};
		if (unchanged) apply.mutate(rule);
		else {
			// The sheet closes at once, so this goes on after it's gone: by the promise, not by
			// mutate's own callbacks, which an unmounted form never hears.
			edit
				.mutateAsync({
					ruleId: rule.id,
					pattern: edited.pattern,
					bucketId,
					commitmentId,
					bucketName,
					forMemberIds: forIds,
				})
				.then(() => apply.mutate(edited))
				.catch(() => {});
		}
		onDone();
	}

	return (
		<form onSubmit={save} noValidate className="grid gap-4">
			<Field
				label="Merchant"
				htmlFor="rule-pattern"
				hint={
					missing && !pattern.trim() ? (
						<span className="text-over">Type a word from the merchant’s name.</span>
					) : (
						"Statement lines containing these words"
					)
				}
			>
				<Input
					id="rule-pattern"
					value={pattern}
					onChange={(event) => setPattern(event.target.value)}
					maxLength={64}
					autoComplete="off"
					aria-invalid={(missing && !pattern.trim()) || undefined}
					disabled={!hydrated}
				/>
			</Field>
			<Field label="Files to" htmlFor="rule-bucket">
				<Combobox
					id="rule-bucket"
					value={target}
					onValueChange={setTarget}
					disabled={!hydrated}
					searchPlaceholder="Find a Bucket or Commitment"
					choices={
						commitmentOptions.length === 0
							? options.map((b) => bucketChoice(b, b.id, members))
							: [
									{
										label: "Buckets",
										choices: options.map((b) => bucketChoice(b, b.id, members)),
									},
									{
										label: BILLS,
										choices: commitmentOptions.map((c) => billChoice(c, AS_COMMITMENT + c.id)),
									},
								]
					}
				/>
			</Field>
			<ForPicker members={members} value={forIds} onChange={setForIds} multiple />
			{inline ? (
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={onDone}>
						Cancel
					</Button>
					<Button type="submit" disabled={!hydrated}>
						Save
					</Button>
				</div>
			) : (
				<SheetFooter>
					<SheetCancel />
					<Button type="submit" disabled={!hydrated}>
						{rule ? "Save" : "Add Rule and file what matches"}
					</Button>
				</SheetFooter>
			)}
			{rule ? (
				<Button type="button" variant="outline" disabled={!hydrated} onClick={fileNow}>
					{unchanged ? "File what’s still unassigned now" : "Save and file what’s still unassigned"}
				</Button>
			) : null}
			{!rule ? null : deleting ? (
				<Confirm
					confirmLabel="Delete Rule"
					onConfirm={() => {
						remove.mutate(rule);
						onDone();
					}}
					onCancel={() => setDeleting(false)}
				>
					Delete the Rule for “{rule.pattern}”? What it already filed stays where it is.
				</Confirm>
			) : (
				<Button
					type="button"
					variant="ghost"
					className="text-over"
					disabled={!hydrated}
					onClick={() => setDeleting(true)}
				>
					Delete Rule
				</Button>
			)}
		</form>
	);
}
