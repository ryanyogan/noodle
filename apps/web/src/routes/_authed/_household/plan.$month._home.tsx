import {
	addMonths,
	freeToSpendParts,
	lumpsIn,
	type MonthKey,
	monthOfDay,
	parseDollars,
	whatChanged,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { SectionGrid } from "@noodle/ui/components/layout";
import { List } from "@noodle/ui/components/list";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, useHydrated } from "@tanstack/react-router";
import { Check, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { AddBucketsSheet } from "../../../components/add-buckets";
import { AddPersonalAllowance } from "../../../components/bucket-editor";
import { BucketTable, bucketsHaveHandles } from "../../../components/bucket-table";
import { LumpCallout } from "../../../components/coming-up";
import { AmountInput } from "../../../components/goals";
import { PlanDraftSection } from "../../../components/plan-draft";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanHealth } from "../../../components/plan-health";
import {
	describeGroup,
	groupMeta,
	groupTitle,
	HistoryStart,
} from "../../../components/plan-history";
import { PlanMasterDetail } from "../../../components/plan-page";
import { PlanSplit } from "../../../components/plan-split";
import { SectionPending } from "../../../components/section-layout";
import { Suggested } from "../../../components/suggested";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, monthName } from "../../../format";
import { useGoals } from "../../../goals";
import { usePlanChange, usePlanChanges, withTakeHomePay } from "../../../plan-changes";
import { PLAN_BUCKETS_HASH } from "../../../plan-pages";
import { withDraftAllowances } from "../../../plan-split";
import {
	goalsQuery,
	membersQuery,
	planDraftQuery,
	planHealthQuery,
	planHistoryQuery,
	suggestionsQuery,
	useAllowancesStillToSet,
	useMonthState,
} from "../../../queries";
import { setTakeHomePay } from "../../../server/plan";

// The Plan's first page (issue 109, ADR-0053): where take-home pay goes, in short, with the
// Buckets table directly under it in the same column, then Personal Allowances. One set of
// figures: the split is the summary (it follows an allowance as it is typed), the table is where
// it is changed and its last row is the Buckets' totals. It is a layout with no address of its
// own (`_home`): `/plan/$month` and a Bucket's `/plan/$month/buckets/$id` are both its children,
// so the page stays mounted, with its scroll and what was typed, while a Bucket opens over it (a
// panel from 1440, a drawer from 1024, a page of its own on a phone).
export const Route = createFileRoute("/_authed/_household/plan/$month/_home")({
	// Setting up the Plan ticks off its Goals step once there are Goals; Plan health shows on this
	// month's Plan. Setting up a Personal Allowance names it after its Parent; Suggested is in the
	// first paint.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(planHistoryQuery(context.month)),
			context.queryClient.ensureQueryData(planHealthQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(suggestionsQuery()),
		]),
	pendingComponent: SectionPending,
	component: PlanHome,
});

type PlanState = ReturnType<typeof useMonthState>;

function PlanHome() {
	const { month, parentId } = Route.useRouteContext();
	const state = useMonthState(month);
	const changes = usePlanChanges(month);
	const hydrated = useHydrated();
	const current = monthOfDay(state.asOf);
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const allowances = state.buckets.filter((b) => b.owner !== undefined);
	const settingUp = state.editable && (state.baseline === null || buckets.length === 0);
	// Until take-home pay is set, the split is all zeros: setting up comes first.
	const unpaid = settingUp && state.baseline === null;
	// What the Buckets take, as the split counts it: the heading says the split's own figure, and
	// the table's last row adds up the same Buckets.
	const shared = freeToSpendParts(state).find(({ part }) => part === "buckets")?.amount ?? 0;
	const members = useSuspenseQuery(membersQuery()).data;
	const nameOf = (id: string) => members.find((m) => m.id === id)?.name;
	// Another Parent's Personal Allowance isn't in this Plan (ADR-0003); only whether one exists is.
	const stillToSet = useAllowancesStillToSet(parentId);
	// Amounts being typed in a Bucket's sheet: the split is drawn as if they were saved, so its bar,
	// its Buckets figure and Free to Spend follow the typing. Put away with the sheet.
	const [drafts, setDrafts] = useState<Record<string, number>>({});
	const onDraft = (bucketId: string, cents: number | null) =>
		setDrafts(({ [bucketId]: _, ...rest }) =>
			cents === null ? rest : { ...rest, [bucketId]: cents },
		);
	const typed = withDraftAllowances(state, drafts);
	// One Add Buckets sheet for the page, whichever control opens it.
	const [adding, setAdding] = useState(false);
	const addBuckets = (label: string, look: "heading" | "step" | "under") => (
		<Button
			type="button"
			variant={look === "heading" ? undefined : "outline"}
			size={look === "under" ? undefined : "sm"}
			// Beside the heading on a phone there is room for the words only, at any text size.
			className={cn("justify-self-start", look === "heading" && "max-sm:[&>svg]:hidden")}
			disabled={!hydrated}
			onClick={() => setAdding(true)}
		>
			<Plus />
			{label}
		</Button>
	);
	return (
		<PlanMasterDetail
			noun="Bucket"
			listLabel="The Plan"
			railLabel="What changed in the Plan"
			// A Bucket opens in a panel from the right; the page keeps its width and the table every
			// column. The page has the whole width up to 1440, with what changed under it; from there
			// that is beside it and the panel covers it. Closing leaves the page where it is scrolled,
			// so the address has no hash.
			panel={{
				size: "wide",
				besideFrom: "late",
				close: linkOptions({ to: "/plan/$month", params: { month } }),
			}}
			editable={state.editable}
			// The rail is what changed, and nothing else: the Plan's figures are the split's, and the
			// Buckets' totals are the table's last row.
			aside={unpaid ? undefined : <WhatChanged month={month} first={state.firstMonth} />}
		>
			{state.editable && month === current ? (
				<PlanDraftSection planned={state.buckets.map((b) => b.name)} />
			) : null}
			{settingUp ? (
				<SetUp
					state={state}
					current={month === current}
					// With no Buckets yet there is no Buckets section below: this is the one Add Buckets.
					addBuckets={buckets.length === 0 ? addBuckets("Add Buckets", "step") : undefined}
				/>
			) : null}
			{state.editable ? (
				<AddBucketsSheet
					month={month}
					buckets={state.buckets}
					freeToSpend={state.freeToSpend}
					parentId={parentId}
					parentName={nameOf(parentId)}
					open={adding}
					onOpenChange={setAdding}
				/>
			) : null}
			{/* Where take-home pay goes, on top. From 1920 the column has room for two: what to check
			    sits beside it rather than two blocks a metre wide (#73). Narrower, it is under it. */}
			<SectionGrid className="empty:hidden xl:grid-cols-[minmax(0,1fr)] min-[120rem]:grid-cols-2">
				{unpaid ? null : (
					<div className="grid gap-3 only:col-span-full">
						<PlanSplit state={typed} current={month === current} />
						<LumpCallout lumps={lumpsIn(state)} month={month} />
					</div>
				)}
				{month === current ? <PlanHealth folded /> : null}
			</SectionGrid>
			{/* The Buckets, where the split's Buckets figure is changed, then Personal Allowances. */}
			<div className="grid min-w-0 gap-3">
				{buckets.length > 0 || !state.editable ? (
					<>
						<SectionHeader
							id={PLAN_BUCKETS_HASH}
							title="Buckets"
							count={buckets.length}
							action={
								<div className="flex min-w-0 items-center gap-3">
									{buckets.length > 0 ? (
										// The split's Buckets figure again, and the table's last row. A phone has no
										// room for it beside the button; both of the others are on its page.
										<p
											data-slot="buckets-total"
											className="min-w-0 text-end text-[13px] text-muted-foreground tabular-nums max-sm:hidden"
										>
											<Money cents={shared} /> in Buckets
										</p>
									) : null}
									{state.editable ? addBuckets("Add Buckets", "heading") : null}
								</div>
							}
						/>
						{buckets.length > 0 ? (
							<BucketTable
								month={month}
								label="Buckets"
								buckets={buckets}
								editable={state.editable}
								reorder
								was={changes.allowances}
								onDraft={onDraft}
								freeToSpend={state.freeToSpend}
								foot={
									state.editable ? (
										// Under the table: Add without scrolling back up a long list. Its own words,
										// so the heading's Add Buckets stays the one of that name.
										<div className="px-1">{addBuckets("Add another Bucket", "under")}</div>
									) : null
								}
							/>
						) : (
							<Card className="p-(--card-pad) text-sm text-muted-foreground">
								No Buckets in this month’s Plan.
							</Card>
						)}
					</>
				) : null}
				{/* Under the list (#76), on this month only: adding one writes this month's Plan. */}
				{state.editable && month === current ? <Suggested kinds={["new-bucket"]} /> : null}
				{allowances.length > 0 || state.editable ? (
					<Section
						id="personal-allowances"
						aria-labelledby="plan-personal-allowances"
						className="mt-5 first:mt-0"
					>
						<SectionHeader
							id="plan-personal-allowances"
							title="Personal Allowances"
							count={allowances.length}
							help={<TermHelp term="personal-allowance" />}
						/>
						{allowances.length > 0 ? (
							<BucketTable
								month={month}
								label="Personal Allowances"
								buckets={allowances}
								editable={state.editable}
								// Room where the Buckets' handles are, so the figures of the two tables line up.
								indent={bucketsHaveHandles(buckets, state.editable)}
								// Each Parent sets their own; the other's shows its figures.
								canEdit={(bucket) => bucket.owner === parentId}
								setBy={(bucket) =>
									state.editable && bucket.owner !== parentId && bucket.owner
										? nameOf(bucket.owner)
										: undefined
								}
								was={changes.allowances}
								onDraft={onDraft}
								freeToSpend={state.freeToSpend}
							/>
						) : null}
						{state.editable && stillToSet.length > 0 ? (
							<p data-slot="still-to-set" className="px-1 text-[13px] text-muted-foreground">
								{stillToSet.map((name) => `Still to set: ${name}’s Personal Allowance`).join(" · ")}
							</p>
						) : null}
						{state.editable && !allowances.some((b) => b.owner === parentId) ? (
							<AddPersonalAllowance month={month} parentId={parentId} buckets={state.buckets} />
						) : null}
					</Section>
				) : null}
			</div>
		</PlanMasterDetail>
	);
}

/**
 * Setting up a month's Plan, step by step: take-home pay right here, Buckets in the sheet this
 * page opens, Commitments and Goals on their own pages. Each step says when it's done.
 */
function SetUp({
	state,
	current,
	addBuckets,
}: {
	state: PlanState;
	current: boolean;
	/** What opens the Add Buckets sheet, while there are no Buckets. */
	addBuckets?: ReactNode;
}) {
	const { month } = state;
	// With no draft yet, statements are the quickest start: the Plan is drafted from them.
	const { data: draft } = useQuery({ ...planDraftQuery(), enabled: current });
	const { goals, accounts } = useGoals();
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const activeGoals = goals.filter((g) => g.state === "active");
	return (
		<Section aria-labelledby="plan-set-up">
			<SectionHeader id="plan-set-up" title="Set up the Plan" />
			<Card>
				<ol className="[&>li+li]:border-t">
					<Step
						number={1}
						title="Take-home pay"
						done={state.baseline !== null}
						description={
							state.baseline === null
								? "Your usual monthly pay after taxes and deductions. The Plan divides it up."
								: `${formatMoney(state.baseline)} a month`
						}
					>
						{state.baseline === null ? (
							<TakeHomePayForm month={month} />
						) : (
							<p className="text-[13px] text-muted-foreground">
								Change it any time on{" "}
								<Link
									to="/plan/$month/income"
									params={{ month }}
									className="font-medium text-foreground underline underline-offset-2"
								>
									Income
								</Link>
								.
							</p>
						)}
					</Step>
					<Step
						number={2}
						title="Commitments"
						optional
						done={state.commitments.length > 0}
						description={
							state.commitments.length > 0
								? `${count(state.commitments.length, "Commitment")} · ${formatMoney(state.committed)} this month`
								: "The mortgage, insurance, subscriptions: what’s due every period."
						}
						action={
							<StepLink to="/plan/$month/commitments" month={month} label="Add Commitments" />
						}
					/>
					<Step
						number={3}
						// Until there are Buckets this step is where links to the Plan's Buckets land.
						id={buckets.length === 0 ? PLAN_BUCKETS_HASH : undefined}
						title="Buckets"
						done={buckets.length > 0}
						description={
							buckets.length > 0
								? `${count(buckets.length, "Bucket")} · ${formatMoney(
										buckets.reduce((sum, b) => sum + b.allowance, 0),
									)} a month`
								: "An allowance for each kind of everyday spending, like Groceries or Fun."
						}
						action={addBuckets}
					/>
					<Step
						number={4}
						title="Goals"
						optional
						done={activeGoals.length > 0}
						description={
							activeGoals.length > 0
								? count(activeGoals.length, "Goal")
								: "Save for something ahead, or pay down a card or loan, funded from Free to Spend."
						}
						action={
							// Goals are set aside in an Account, so one comes first.
							accounts.length === 0 ? (
								<Button variant="outline" size="sm" className="justify-self-start" asChild>
									<Link to="/accounts">Add an Account first</Link>
								</Button>
							) : (
								<Button variant="outline" size="sm" className="justify-self-start" asChild>
									<Link to="/goals" search={{ add: "save" }}>
										Add a Goal
									</Link>
								</Button>
							)
						}
					/>
				</ol>
			</Card>
			{current && draft === null ? (
				<p className="text-[13px] text-muted-foreground">
					Have bank or card statements? Upload about three months of them to{" "}
					<Link to="/accounts" className="font-medium text-foreground underline underline-offset-2">
						an Account
					</Link>{" "}
					and the Plan is drafted from them.
				</p>
			) : null}
		</Section>
	);
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function Step({
	number,
	id,
	title,
	description,
	done,
	optional = false,
	action,
	children,
}: {
	number: number;
	id?: string;
	title: string;
	description: string;
	done: boolean;
	optional?: boolean;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<li
			id={id}
			className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-(--card-pad) py-3.5"
		>
			<span
				aria-hidden="true"
				className={cn(
					"mt-px grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
					done ? "bg-foreground text-background" : "bg-surface-2 text-muted-foreground",
				)}
			>
				{done ? <Check className="size-3.5" strokeWidth={2.5} /> : number}
			</span>
			<div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div className="grid min-w-0 gap-0.5">
					<span className="text-sm font-medium">
						<span className="sr-only">Step {number}: </span>
						{title}
						{optional ? (
							<span className="font-normal text-muted-foreground"> (optional)</span>
						) : null}
						{done ? <span className="sr-only"> (done)</span> : null}
					</span>
					<span className="text-[13px] text-muted-foreground">{description}</span>
				</div>
				{action}
			</div>
			{children ? <div className="col-start-2">{children}</div> : null}
		</li>
	);
}

function StepLink({
	to,
	month,
	label,
}: {
	to: "/plan/$month/commitments" | "/plan/$month/goals";
	month: MonthKey;
	label: string;
}) {
	return (
		<Button variant="outline" size="sm" className="justify-self-start" asChild>
			<Link to={to} params={{ month }}>
				{label}
			</Link>
		</Button>
	);
}

/** The first step of setting up: take-home pay, which applies from this month on. */
function TakeHomePayForm({ month }: { month: MonthKey }) {
	const hydrated = useHydrated();
	const id = useId();
	const [amount, setAmount] = useState("");
	const cents = parseDollars(amount);
	const change = usePlanChange(month, {
		save: (data: { month: MonthKey; amountCents: number }) => setTakeHomePay({ data }),
		apply: withTakeHomePay,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (cents !== null) change.mutate({ month, amountCents: cents });
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-3">
			{/* The step's title shows what it is; the label names the field for assistive tech. */}
			<label htmlFor={`${id}-baseline`} className="sr-only">
				Take-home pay
			</label>
			<div className="flex gap-2">
				<AmountInput
					id={`${id}-baseline`}
					className="w-40"
					placeholder="0"
					enterKeyHint="done"
					value={amount}
					disabled={!hydrated}
					aria-invalid={(amount !== "" && cents === null) || undefined}
					onChange={(event) => setAmount(event.currentTarget.value)}
				/>
				<Button type="submit" variant="secondary" disabled={!hydrated || cents === null}>
					Set take-home pay
				</Button>
			</div>
			<SaveFailed change={change} />
		</form>
	);
}

/** How many changes What changed shows before "Show all". */
const CHANGES_FOLDED = 3;
/** How many the rail shows at lg, where the Plan beside it is taller (#73). */
const CHANGES_FOLDED_WIDE = 6;

/**
 * What changed in this month's Plan since the month before, item by item, and who changed it.
 * This Month's first week links here.
 */
function WhatChanged({ month, first }: { month: MonthKey; first: MonthKey | null }) {
	const { data } = useSuspenseQuery(planHistoryQuery(month));
	const groups = whatChanged(data.changes, month);
	// Folded to the first few (#73), so the rail stays about as tall as the Plan beside it.
	const [all, setAll] = useState(false);
	const shown = all ? groups : groups.slice(0, CHANGES_FOLDED_WIDE);
	// Nothing to compare with yet: the Household's first month, or no Plan changes at all.
	const fresh = data.historyStart === null || first === null || month <= first;
	return (
		<Section aria-labelledby="what-changed">
			<SectionHeader id="what-changed" title="What changed" count={groups.length || undefined} />
			{groups.length === 0 ? (
				<p className="rounded-xl border border-dashed px-(--card-pad) py-4 text-[13px] text-muted-foreground">
					{fresh
						? "Changes to the Plan will show here."
						: `No Plan changes since ${monthName(addMonths(month, -1))}.`}
				</p>
			) : (
				<List>
					{shown.map((group, index) => (
						<li
							key={group.key}
							className={cn(
								"grid gap-0.5 px-(--card-pad) py-3",
								// A phone folds to the first three; the rail has room for six.
								!all && index >= CHANGES_FOLDED && "max-lg:hidden",
							)}
						>
							<p className="text-sm font-medium">{groupTitle(group)}</p>
							{group.kind === "personal-allowance" ? null : (
								<p className="text-sm">{describeGroup(group)}</p>
							)}
							<p className="text-[13px] text-muted-foreground">{groupMeta(group)}</p>
						</li>
					))}
				</List>
			)}
			{groups.length > CHANGES_FOLDED ? (
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"self-start justify-self-start",
						groups.length <= CHANGES_FOLDED_WIDE && "lg:hidden",
					)}
					aria-expanded={all}
					onClick={() => setAll(!all)}
				>
					{all ? "Show fewer" : `Show all ${groups.length}`}
				</Button>
			) : null}
			{/* Only where the log's start cuts this month's comparison short. */}
			{data.historyStart === null ||
			fresh ||
			monthOfDay(data.historyStart) < addMonths(month, -1) ? null : (
				<HistoryStart day={data.historyStart} />
			)}
		</Section>
	);
}
