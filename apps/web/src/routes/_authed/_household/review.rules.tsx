import { canAssign, type For, monthKeyAt, type PlanBucket } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { ChevronLeft, Lock, WandSparkles } from "lucide-react";
import { type FormEvent, useState } from "react";
import { asBucketColor, monogram } from "../../../buckets";
import { ForPicker } from "../../../components/for-picker";
import { NativeSelect } from "../../../components/native-select";
import { Confirm } from "../../../components/plan-editing";
import { forLabel, type MemberSummary } from "../../../members";
import { membersQuery, monthQuery, rulesQuery } from "../../../queries";
import { type RuleRow, useApplyRule, useDeleteRule, useEditRule } from "../../../review";

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
	const [editing, setEditing] = useState<string | null>(null);
	const open = rules.find((rule) => rule.id === editing) ?? null;

	return (
		<>
			<PageHeader
				className="max-w-2xl"
				eyebrow="Review"
				title="Rules"
				actions={
					<Button variant="outline" size="sm" asChild>
						<Link to="/review">
							<ChevronLeft />
							Review
						</Link>
					</Button>
				}
			/>
			<div className="grid max-w-2xl gap-4">
				{rules.length === 0 ? (
					<Card className="p-0">
						<EmptyState
							icon={<WandSparkles />}
							title="No Rules yet"
							description="When you confirm or change a card in Review, you can have Noodle always file that merchant the same way."
						/>
					</Card>
				) : (
					<Card className="p-0">
						<List>
							{rules.map((rule) => (
								<RuleListRow
									key={rule.id}
									rule={rule}
									bucket={buckets.find((b) => b.id === rule.bucketId)}
									members={members}
									onEdit={() => setEditing(rule.id)}
								/>
							))}
						</List>
					</Card>
				)}
				<p className="text-xs text-subtle-foreground">
					A Rule files each new statement line whose merchant contains its words. What it filed
					stays put when you change or delete it.
				</p>
			</div>
			<Sheet open={open !== null} onOpenChange={(next) => (next ? undefined : setEditing(null))}>
				<SheetContent>
					{open ? (
						<>
							<SheetHeader
								title="Edit Rule"
								description={open.private ? "Only you see this Rule." : undefined}
							/>
							<RuleForm
								key={open.id}
								rule={open}
								buckets={buckets}
								members={members}
								onDone={() => setEditing(null)}
							/>
						</>
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
	onEdit,
}: {
	rule: RuleRow;
	bucket: PlanBucket | undefined;
	members: MemberSummary[];
	onEdit: () => void;
}) {
	const hydrated = useHydrated();
	const who = forLabel(members, rule.for);
	const filed = rule.matched === 1 ? "Filed 1" : `Filed ${rule.matched}`;
	const detail = [
		rule.bucketName,
		`For ${who}`,
		rule.createdBy ? `by ${rule.createdBy}` : null,
		filed,
	].filter(Boolean);
	return (
		<li data-slot="list-row">
			<button
				type="button"
				aria-label={`${rule.pattern}, ${rule.bucketName}, For ${who}${rule.private ? ", only you" : ""}, ${filed}`}
				onClick={onEdit}
				disabled={!hydrated}
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
					<span className="truncate text-[13px] text-muted-foreground">{detail.join(" · ")}</span>
				</span>
			</button>
		</li>
	);
}

/** Changes a Rule's merchant words, Bucket and For; files what it matches; or deletes it. */
function RuleForm({
	rule,
	buckets,
	members,
	onDone,
}: {
	rule: RuleRow;
	buckets: PlanBucket[];
	members: MemberSummary[];
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	const edit = useEditRule();
	const remove = useDeleteRule();
	const apply = useApplyRule();
	const [pattern, setPattern] = useState(rule.pattern);
	const [bucketId, setBucketId] = useState(rule.bucketId);
	const [forIds, setForIds] = useState<For>(rule.for);
	const [deleting, setDeleting] = useState(false);
	// Its Bucket stays pickable after leaving the Plan.
	const options = buckets.some((b) => b.id === rule.bucketId)
		? buckets
		: [...buckets, { id: rule.bucketId, name: rule.bucketName }];
	const unchanged =
		pattern.trim() === rule.pattern &&
		bucketId === rule.bucketId &&
		forIds.join() === rule.for.join();

	function save(event: FormEvent) {
		event.preventDefault();
		if (!pattern.trim()) return;
		if (!unchanged) {
			edit.mutate({
				ruleId: rule.id,
				pattern: pattern.trim(),
				bucketId,
				bucketName: options.find((b) => b.id === bucketId)?.name ?? rule.bucketName,
				forMemberIds: forIds,
			});
		}
		onDone();
	}

	return (
		<form onSubmit={save} className="grid gap-4">
			<Field label="Merchant" htmlFor="rule-pattern" hint="Statement lines containing these words">
				<Input
					id="rule-pattern"
					value={pattern}
					onChange={(event) => setPattern(event.target.value)}
					maxLength={64}
					autoComplete="off"
					required
					disabled={!hydrated}
				/>
			</Field>
			<Field label="Bucket" htmlFor="rule-bucket">
				<NativeSelect
					id="rule-bucket"
					value={bucketId}
					onChange={(event) => setBucketId(event.target.value)}
					disabled={!hydrated}
				>
					{options.map((b) => (
						<option key={b.id} value={b.id}>
							{b.name}
						</option>
					))}
				</NativeSelect>
			</Field>
			<ForPicker members={members} value={forIds} onChange={setForIds} multiple />
			<Button type="submit" disabled={!hydrated || !pattern.trim()}>
				Save
			</Button>
			<Button
				type="button"
				variant="outline"
				disabled={!hydrated || !unchanged}
				onClick={() => {
					apply.mutate(rule);
					onDone();
				}}
			>
				File unassigned matches now
			</Button>
			{deleting ? (
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
