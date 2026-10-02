import { canAssign, type For, monthKeyAt, type PlanBucket } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Combobox } from "@noodle/ui/components/combobox";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List } from "@noodle/ui/components/list";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated, useParams } from "@tanstack/react-router";
import { ChevronRight, Lock, Plus, WandSparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../../../buckets";
import { ForPicker } from "../../../components/for-picker";
import { ListBesideDetail, masterDetailItem } from "../../../components/master-detail";
import { Confirm } from "../../../components/plan-editing";
import { SectionPending } from "../../../components/section-layout";
import { forLabel, type MemberSummary } from "../../../members";
import { membersQuery, monthQuery, rulesQuery } from "../../../queries";
import {
	type RuleRow,
	useApplyRule,
	useDeleteRule,
	useEditRule,
	useSaveRule,
} from "../../../review";

export const Route = createFileRoute("/_authed/_household/review/rules")({
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(rulesQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(monthQuery(context.current)),
		]),
	pendingComponent: SectionPending,
	component: RulesPage,
});

/**
 * The Rules this Parent may see: the Household's, and their own private ones into their
 * Personal Allowance, which the other Parent never sees. Each can be changed, deleted, or used
 * to file what's still unassigned.
 */
function RulesPage() {
	const { current, parentId } = Route.useRouteContext();
	const rules = useSuspenseQuery(rulesQuery()).data;
	const members = useSuspenseQuery(membersQuery()).data;
	// Rules file into this month's Buckets onward, so they're picked from this month's Plan.
	const buckets = useSuspenseQuery(monthQuery(current)).data.plan.buckets.filter((b) =>
		canAssign(b, parentId),
	);
	const hydrated = useHydrated();
	const [adding, setAdding] = useState(false);
	// The Rule open beside the list (its route is this one's child).
	const picked = useParams({ strict: false, select: (params) => params.ruleId });

	return (
		<>
			<ListBesideDetail
				picked={picked !== undefined}
				noun="Rule"
				listLabel="Rules"
				hint="Pick a Rule to change it here."
				list={
					<div className="grid gap-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<p className="max-w-prose text-sm text-muted-foreground">
								A Rule files each new statement line whose merchant contains its words. What it
								filed stays put when you change or delete it.
							</p>
							<Button
								size="sm"
								disabled={!hydrated || buckets.length === 0}
								onClick={() => setAdding(true)}
							>
								<Plus />
								Add Rule
							</Button>
						</div>
						<Card className="p-0">
							{rules.length === 0 ? (
								<EmptyState
									icon={<WandSparkles />}
									title="No Rules yet"
									description="A Rule files a merchant’s charges in the same Bucket every time, so they skip Review. Add one here, or press “Always file” after you file a card in Review."
								/>
							) : (
								<List>
									{rules.map((rule) => (
										<RuleListRow
											key={rule.id}
											rule={rule}
											bucket={buckets.find((b) => b.id === rule.bucketId)}
											members={members}
										/>
									))}
								</List>
							)}
						</Card>
					</div>
				}
			/>
			<Sheet open={adding} onOpenChange={setAdding}>
				<SheetContent>
					<SheetHeader
						title="Add a Rule"
						description="New statement lines whose merchant contains these words are filed on their own."
					/>
					{adding ? (
						<RuleForm
							key="new"
							rule={null}
							buckets={buckets}
							members={members}
							onDone={() => setAdding(false)}
						/>
					) : null}
				</SheetContent>
			</Sheet>
		</>
	);
}

function RuleListRow({
	rule,
	bucket,
	members,
}: {
	rule: RuleRow;
	bucket: PlanBucket | undefined;
	members: MemberSummary[];
}) {
	const who = forLabel(members, rule.for);
	const filed = `Filed ${rule.matched} so far`;
	const detail = [
		rule.bucketName,
		`For ${who}`,
		rule.createdBy ? `by ${rule.createdBy}` : null,
		filed,
	].filter(Boolean);
	return (
		<li data-slot="list-row">
			<Link
				to="/review/rules/$ruleId"
				params={{ ruleId: rule.id }}
				{...masterDetailItem}
				aria-label={`${rule.pattern}, ${rule.bucketName}, For ${who}${rule.private ? ", only you" : ""}, ${filed}`}
				className={cn(
					"grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-(--card-pad) py-3.5 text-start",
					"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
					"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
				)}
			>
				<Tile aria-hidden="true" bucket={bucket ? asBucketColor(bucket.color) : undefined}>
					{monogram(rule.bucketName)}
				</Tile>
				<span className="grid min-w-0 gap-0.5">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-medium">“{rule.pattern}”</span>
						{rule.private ? (
							<Badge aria-hidden="true" className="h-4.5 px-1.5 text-[11px]">
								<Lock />
								Only you
							</Badge>
						) : null}
					</span>
					<span className="line-clamp-2 text-[13px] text-muted-foreground">
						{detail.join(" · ")}
					</span>
				</span>
				<ChevronRight aria-hidden="true" className="size-4 text-subtle-foreground" />
			</Link>
		</li>
	);
}

/**
 * Adds a Rule (`rule` null), or changes one's merchant words, Bucket and For; files what it
 * matches (saving any change first); or deletes it.
 */
export function RuleForm({
	rule,
	buckets,
	members,
	onDone,
	inline = false,
}: {
	rule: RuleRow | null;
	buckets: PlanBucket[];
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
	const [pattern, setPattern] = useState(rule?.pattern ?? "");
	const [bucketId, setBucketId] = useState(rule?.bucketId ?? buckets[0]?.id ?? "");
	const [forIds, setForIds] = useState<For>(rule?.for ?? []);
	const [deleting, setDeleting] = useState(false);
	const [missing, setMissing] = useState(false);
	// Its Bucket stays pickable after leaving the Plan.
	const options =
		!rule || buckets.some((b) => b.id === rule.bucketId)
			? buckets
			: [...buckets, { id: rule.bucketId, name: rule.bucketName }];
	const bucketName = options.find((b) => b.id === bucketId)?.name ?? rule?.bucketName ?? "";
	const unchanged =
		rule !== null &&
		pattern.trim() === rule.pattern &&
		bucketId === rule.bucketId &&
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
				bucketName,
				forMemberIds: forIds,
			});
		} else if (!unchanged) {
			edit.mutate({
				ruleId: rule.id,
				pattern: pattern.trim(),
				bucketId,
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
		const edited = { ...rule, pattern: pattern.trim(), bucketId, bucketName, for: forIds };
		if (unchanged) apply.mutate(rule);
		else {
			// The sheet closes at once, so this goes on after it's gone: by the promise, not by
			// mutate's own callbacks, which an unmounted form never hears.
			edit
				.mutateAsync({
					ruleId: rule.id,
					pattern: edited.pattern,
					bucketId,
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
			<Field label="Bucket" htmlFor="rule-bucket">
				<Combobox
					id="rule-bucket"
					value={bucketId}
					onValueChange={setBucketId}
					disabled={!hydrated}
					searchPlaceholder="Find a Bucket"
					choices={options.map((b) => ({ value: b.id, label: b.name }))}
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
