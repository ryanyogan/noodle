import {
	addMonths,
	CADENCES,
	type Cadence,
	type Cents,
	canAssign,
	type DayKey,
	lastDayOf,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	monthOfDay,
	type Plan,
	type ProjectionGoal,
	type ScenarioChange,
	type ScenarioChangeKind,
	type ScenarioChangeOf,
	type ScenarioChangeRange,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Slider } from "@noodle/ui/components/slider";
import { Switch } from "@noodle/ui/components/switch";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
	createContext,
	memo,
	type ReactNode,
	use,
	useEffect,
	useId,
	useState,
	useSyncExternalStore,
} from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, fullDay, shortMonth } from "../format";
import { changeTarget, withChange, withoutChange } from "../scenarios";
import { MoneyInput } from "./money-input";

// The Plan as an editable outline: Income, Commitments, Buckets, Goals, One-offs and growth. Each
// line shows the Plan's value and the Scenario's; every change is a Change, set at once, and the
// projection catches up in a deferred render, so a slider never waits for the chart. Editing is
// inline on desktop and in a sheet on phones; each change carries the months it holds for.

const cadenceWords = { monthly: "a month", biweekly: "every two weeks", annual: "a year" } as const;
const cadenceLabels: Record<Cadence, string> = {
	monthly: "Monthly",
	biweekly: "Every two weeks",
	annual: "Yearly",
};

/** Where an amount's slider goes up to: well past the amount, in round $50s. */
const sliderMax = (amount: Cents) => Math.ceil(Math.max(amount * 2, 50_000) / 5_000) * 5_000;
/**
 * A step that suits the slider's size: $10 up to $1,000, $50 up to $10,000, $500 beyond, so an
 * arrow key moves a mortgage or a down payment a useful amount (Page Up/Down moves ten).
 */
const sliderStep = (max: Cents) => (max <= 100_000 ? 1_000 : max <= 1_000_000 ? 5_000 : 50_000);

/** Every month a change can start in: the whole horizon. */
const horizonMonths = (month: MonthKey) =>
	Array.from({ length: MAX_PROJECTION_MONTHS }, (_, i) => addMonths(month, i));

const wideQuery = "(min-width: 64rem)";

/** Desktop edits inline; phones edit in a sheet. */
function useWide() {
	return useSyncExternalStore(
		(onChange) => {
			const query = window.matchMedia(wideQuery);
			query.addEventListener("change", onChange);
			return () => query.removeEventListener("change", onChange);
		},
		() => window.matchMedia(wideQuery).matches,
		() => true,
	);
}

/**
 * The Scenario's outcome as it stands ("Frees $9,600 over 2 years"), shown in a phone's sheet so
 * a change's effect stays in view while the sheet covers the page.
 */
export const ScenarioOutcome = createContext<ReactNode>(null);

function SheetOutcome() {
	const outcome = use(ScenarioOutcome);
	return outcome ? <div className="rounded-xl bg-surface-2 px-3 py-2">{outcome}</div> : null;
}

type Changes = (change: (changes: ScenarioChange[]) => ScenarioChange[]) => void;

/** What every line needs to change the Scenario. */
type Editing = {
	month: MonthKey;
	wide: boolean;
	/** Sets a Change (counted, even if it was muted). */
	set: (scenarioChange: ScenarioChange) => void;
	unset: (target: string) => void;
};

export const ScenarioOutline = memo(function ScenarioOutline({
	month,
	plan,
	goals,
	accounts,
	levers,
	parentId,
	onChange,
}: {
	/** The Household's current month: the Scenario's first. */
	month: MonthKey;
	/** This month's Plan. */
	plan: Plan;
	goals: (ProjectionGoal & { name: string })[];
	/** Where a new Goal can be kept. */
	accounts: { id: string; name: string }[];
	levers: ScenarioChange[];
	parentId: string;
	onChange: Changes;
}) {
	const wide = useWide();
	const byTarget = new Map(levers.map((l) => [changeTarget(l), l]));
	const edit: Editing = {
		month,
		wide,
		set: (scenarioChange) => {
			const { muted: _, ...counted } = scenarioChange;
			onChange((current) => withChange(current, counted as ScenarioChange));
		},
		unset: (target) => onChange((current) => withoutChange(current, target)),
	};
	const added = <K extends ScenarioChangeKind>(kind: K) =>
		levers.filter((l): l is ScenarioChangeOf<K> => l.kind === kind);
	const addNew = (scenarioChange: ScenarioChange) =>
		onChange((current) => [...current, scenarioChange]);

	return (
		<div className="grid gap-8">
			<Group id="outline-income" title="Income" wide={wide}>
				<List>
					<TakeHomePayLine plan={plan} lever={byTarget.get("baseline")} edit={edit} />
				</List>
			</Group>

			<Group
				id="outline-commitments"
				title="Commitments"
				wide={wide}
				add={{
					noun: "Commitment",
					fresh: () => ({
						kind: "add-commitment",
						commitmentId: ulid(),
						name: "",
						amount: 10_000,
						cadence: "monthly",
						dueDay: 1,
						months: null,
						fromMonth: month,
					}),
					fields: (scenarioChange, change) =>
						scenarioChange.kind === "add-commitment" ? (
							<AddedCommitmentFields lever={scenarioChange} month={month} onChange={change} />
						) : null,
					onAdd: addNew,
				}}
			>
				{plan.commitments.length > 0 || added("add-commitment").length > 0 ? (
					<List>
						{plan.commitments.map((commitment) => (
							<CommitmentLine
								key={commitment.id}
								commitment={commitment}
								terms={byTarget.get(`terms:${commitment.id}`)}
								ended={byTarget.get(`commitment:${commitment.id}`)}
								edit={edit}
							/>
						))}
						{added("add-commitment").map((scenarioChange) => (
							<AddedLine
								key={scenarioChange.commitmentId}
								lever={scenarioChange}
								edit={edit}
								meta={`${scenarioChange.months === null ? "Ongoing" : `For ${scenarioChange.months} months`}`}
								value={`${formatMoney(scenarioChange.amount)} ${cadenceWords[scenarioChange.cadence]}`}
								fields={(change) => (
									<AddedCommitmentFields
										lever={scenarioChange}
										prefix={scenarioChange.name}
										month={month}
										onChange={change}
									/>
								)}
							/>
						))}
					</List>
				) : (
					<Empty>No Commitments in the Plan yet.</Empty>
				)}
			</Group>

			<Group
				id="outline-buckets"
				title="Buckets"
				wide={wide}
				add={{
					noun: "Bucket",
					fresh: () => ({
						kind: "add-bucket",
						bucketId: ulid(),
						name: "",
						amount: 10_000,
						fromMonth: month,
					}),
					fields: (scenarioChange, change) =>
						scenarioChange.kind === "add-bucket" ? (
							<AddedBucketFields lever={scenarioChange} month={month} onChange={change} />
						) : null,
					onAdd: addNew,
				}}
			>
				{plan.buckets.length > 0 || added("add-bucket").length > 0 ? (
					<List>
						{plan.buckets.map((bucket) => (
							<BucketLine
								key={bucket.id}
								bucket={bucket}
								mine={canAssign(bucket, parentId)}
								allowance={byTarget.get(`bucket:${bucket.id}`)}
								archived={byTarget.get(`archive-bucket:${bucket.id}`)}
								edit={edit}
							/>
						))}
						{added("add-bucket").map((scenarioChange) => (
							<AddedLine
								key={scenarioChange.bucketId}
								lever={scenarioChange}
								edit={edit}
								meta="New Bucket"
								value={`${formatMoney(scenarioChange.amount)} a month`}
								fields={(change) => (
									<AddedBucketFields
										lever={scenarioChange}
										prefix={scenarioChange.name}
										month={month}
										onChange={change}
									/>
								)}
							/>
						))}
					</List>
				) : (
					<Empty>No Buckets in the Plan yet.</Empty>
				)}
			</Group>

			<Group
				id="outline-goals"
				title="Goals"
				wide={wide}
				add={{
					noun: "Goal",
					fresh: () => ({
						kind: "add-goal",
						goalId: ulid(),
						name: "",
						target: 100_000,
						targetDate: null,
						fromMonth: month,
						...(accounts[0] ? { accountId: accounts[0].id } : {}),
					}),
					fields: (scenarioChange, change) =>
						scenarioChange.kind === "add-goal" ? (
							<AddedGoalFields
								lever={scenarioChange}
								month={month}
								accounts={accounts}
								onChange={change}
							/>
						) : null,
					onAdd: addNew,
				}}
			>
				{goals.length > 0 || added("add-goal").length > 0 ? (
					<List>
						{goals.map((goal) => (
							<GoalLine
								key={goal.id}
								goal={goal}
								lever={byTarget.get(`goal:${goal.id}`)}
								edit={edit}
							/>
						))}
						{added("add-goal").map((scenarioChange) => (
							<AddedLine
								key={scenarioChange.goalId}
								lever={scenarioChange}
								edit={edit}
								meta="New Goal"
								value={goalValue(scenarioChange.target, scenarioChange.targetDate)}
								fields={(change) => (
									<AddedGoalFields
										lever={scenarioChange}
										prefix={scenarioChange.name}
										month={month}
										accounts={accounts}
										onChange={change}
									/>
								)}
							/>
						))}
					</List>
				) : (
					<Empty>No Goals yet.</Empty>
				)}
			</Group>

			<Group
				id="outline-one-offs"
				title="One-offs"
				wide={wide}
				add={{
					noun: "one-off",
					fresh: () => ({
						kind: "one-off",
						oneOffId: ulid(),
						name: "",
						amount: 50_000,
						flow: "expense",
						fromMonth: month,
					}),
					fields: (scenarioChange, change) =>
						scenarioChange.kind === "one-off" ? (
							<OneOffFields lever={scenarioChange} month={month} onChange={change} />
						) : null,
					onAdd: addNew,
				}}
			>
				{added("one-off").length > 0 ? (
					<List>
						{added("one-off").map((scenarioChange) => (
							<AddedLine
								key={scenarioChange.oneOffId}
								lever={scenarioChange}
								edit={edit}
								meta={`${scenarioChange.flow === "expense" ? "Expense" : "Income"} in ${shortMonth(scenarioChange.fromMonth)}`}
								value={`${scenarioChange.flow === "expense" ? "−" : "+"}${formatMoney(scenarioChange.amount)}`}
								fields={(change) => (
									<OneOffFields
										lever={scenarioChange}
										prefix={scenarioChange.name}
										month={month}
										onChange={change}
									/>
								)}
							/>
						))}
					</List>
				) : (
					<Empty>No one-offs yet.</Empty>
				)}
			</Group>

			<Group id="outline-assumptions" title="Assumptions" wide={wide}>
				<List>
					<GrowthLine lever={byTarget.get("growth")} edit={edit} />
				</List>
			</Group>
		</div>
	);
});

// ---------------------------------------------------------------------------------------------
// Groups and lines

/** Adding something to a group: a fresh Change for the form, and its fields. */
type Adding = {
	noun: string;
	fresh: () => ScenarioChange;
	fields: (
		scenarioChange: ScenarioChange,
		change: (scenarioChange: ScenarioChange) => void,
	) => ReactNode;
	onAdd: (scenarioChange: ScenarioChange) => void;
};

/** A group of the outline, with its Add button and the form for a new one. */
function Group({
	id,
	title,
	wide,
	add,
	children,
}: {
	id: string;
	title: string;
	wide: boolean;
	add?: Adding;
	children: ReactNode;
}) {
	const [draft, setDraft] = useState<ScenarioChange | null>(null);
	const name = draft && "name" in draft ? draft.name.trim() : "";
	const label = `New ${add?.noun ?? ""}`;
	const form =
		add && draft ? (
			<form
				aria-label={label}
				className="grid gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (name === "") return;
					add.onAdd({ ...draft, name } as ScenarioChange);
					setDraft(null);
				}}
			>
				{add.fields(draft, setDraft)}
				<div className="flex items-center justify-end gap-2">
					{name === "" ? (
						<p id={`${id}-add-hint`} className="mr-auto text-[13px] text-muted-foreground">
							Name it to add it.
						</p>
					) : null}
					<Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						disabled={name === ""}
						aria-describedby={name === "" ? `${id}-add-hint` : undefined}
					>
						Add
					</Button>
				</div>
			</form>
		) : null;

	return (
		<Section aria-labelledby={id}>
			<SectionHeader
				id={id}
				title={title}
				action={
					add ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={draft !== null && wide}
							onClick={() => setDraft(add.fresh())}
						>
							<Plus />
							Add<span className="sr-only"> {add.noun}</span>
						</Button>
					) : null
				}
			/>
			{form && wide ? (
				<Card className="grid gap-3 p-(--card-pad)">
					<h3 className="text-sm font-semibold">{label}</h3>
					{form}
				</Card>
			) : null}
			{add && !wide ? (
				<Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
					<SheetContent aria-describedby={undefined}>
						<SheetHeader title={label} />
						<SheetOutcome />
						{form}
					</SheetContent>
				</Sheet>
			) : null}
			{children}
		</Section>
	);
}

/**
 * One line of the outline: its name, the Plan's value, the Scenario's (marked when changed), and
 * its editor: inline on desktop, in a sheet on phones. No editor: read-only.
 */
function Line({
	title,
	leading,
	badge,
	meta,
	restatesValue = false,
	value,
	changed,
	wide,
	editor,
}: {
	title: string;
	leading?: ReactNode;
	badge?: ReactNode;
	meta: ReactNode;
	/** The meta says the Plan's value: unchanged, it repeats `value`, so a phone's row leaves it out. */
	restatesValue?: boolean;
	value: string;
	changed: boolean;
	wide: boolean;
	editor: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const rowMeta = restatesValue && !changed ? <span className="max-sm:hidden">{meta}</span> : meta;
	const shown = (
		<span
			className={cn(
				"text-sm tabular-nums",
				changed ? "font-semibold text-foreground" : "text-muted-foreground",
			)}
		>
			{value}
			{changed ? <span className="sr-only"> (changed)</span> : null}
		</span>
	);
	// On desktop a line is one compact row; its editor opens below it, and opens by itself once
	// the line is changed, so every changed line shows how it changed.
	const [expanded, setExpanded] = useState(changed);
	useEffect(() => {
		if (changed) setExpanded(true);
	}, [changed]);
	if (!editor) {
		return (
			<ListRow leading={leading} title={title} badge={badge} meta={rowMeta} trailing={shown} />
		);
	}
	if (wide) {
		return (
			<ListRow
				leading={leading}
				title={title}
				badge={badge}
				meta={rowMeta}
				trailing={
					<RowButton
						variant="value"
						aria-label={`Edit ${title}`}
						aria-expanded={expanded}
						className="-me-2"
						onClick={() => setExpanded((open) => !open)}
					>
						{shown}
						<ChevronDown
							aria-hidden="true"
							className={cn(
								"size-4 text-subtle-foreground transition-transform",
								expanded && "rotate-180",
							)}
						/>
					</RowButton>
				}
				below={expanded ? editor : undefined}
			/>
		);
	}
	return (
		<ListRow
			leading={leading}
			title={title}
			badge={badge}
			meta={rowMeta}
			trailing={
				<>
					<RowButton
						variant="value"
						aria-label={`Edit ${title}`}
						className="-me-2"
						onClick={() => setOpen(true)}
					>
						{shown}
						<ChevronRight aria-hidden="true" className="size-4 text-subtle-foreground" />
					</RowButton>
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetContent>
							<SheetHeader title={title} description={meta} />
							<SheetOutcome />
							{editor}
						</SheetContent>
					</Sheet>
				</>
			}
		/>
	);
}

/** "Changed", "New" or "Left out" beside a line's name. */
function Mark({ lever, added }: { lever: ScenarioChange | undefined; added?: boolean }) {
	if (!lever) return null;
	return (
		<Badge dot={!lever.muted} className="font-normal">
			{lever.muted ? "Left out" : added ? "New" : "Changed"}
		</Badge>
	);
}

function TakeHomePayLine({
	plan,
	lever,
	edit,
}: {
	plan: Plan;
	lever: ScenarioChange | undefined;
	edit: Editing;
}) {
	const planned = plan.baseline ?? 0;
	const current = lever?.kind === "baseline" ? lever : null;
	const amount = current?.amount ?? planned;
	const set = (value: Cents) =>
		value === planned
			? edit.unset("baseline")
			: edit.set({
					kind: "baseline",
					amount: value,
					fromMonth: current?.fromMonth ?? edit.month,
					...(current?.untilMonth ? { untilMonth: current.untilMonth } : {}),
				});
	return (
		<Line
			title="Take-home pay"
			badge={<Mark lever={lever} />}
			meta={`Plan ${formatMoney(planned)} a month`}
			value={formatMoney(amount)}
			changed={current !== null}
			wide={edit.wide}
			editor={
				<div className="grid gap-2.5">
					<AmountField label="Take-home pay" value={amount} reference={planned} onChange={set} />
					{current ? (
						<ChangeRange
							name="Take-home pay"
							lever={current}
							month={edit.month}
							onChange={(range) => edit.set({ ...current, ...range })}
							onUndo={() => edit.unset("baseline")}
							undoing="Take-home pay change"
						/>
					) : null}
				</div>
			}
		/>
	);
}

function CommitmentLine({
	commitment,
	terms: termsChange,
	ended: endedChange,
	edit,
}: {
	commitment: Plan["commitments"][number];
	terms: ScenarioChange | undefined;
	ended: ScenarioChange | undefined;
	edit: Editing;
}) {
	const { id, name } = commitment;
	const terms = termsChange?.kind === "commitment-terms" ? termsChange : null;
	const ended = endedChange?.kind === "end-commitment" ? endedChange : null;
	const amount = terms?.amount ?? commitment.amount;
	const cadence = terms?.cadence ?? commitment.cadence;
	const setTerms = (next: { amount: Cents; cadence: Cadence }) =>
		next.amount === commitment.amount && next.cadence === commitment.cadence
			? edit.unset(`terms:${id}`)
			: edit.set({
					kind: "commitment-terms",
					commitmentId: id,
					amount: next.amount,
					cadence: next.cadence,
					fromMonth: terms?.fromMonth ?? edit.month,
					...(terms?.untilMonth ? { untilMonth: terms.untilMonth } : {}),
				});
	return (
		<Line
			title={name}
			badge={<Mark lever={ended ?? terms ?? undefined} />}
			meta={`Plan ${formatMoney(commitment.amount)} ${cadenceWords[commitment.cadence]}`}
			restatesValue
			value={
				ended && ended.fromMonth <= edit.month && !ended.untilMonth
					? "Ended"
					: `${formatMoney(amount)} ${cadenceWords[cadence]}`
			}
			changed={terms !== null || ended !== null}
			wide={edit.wide}
			editor={
				<div className="grid gap-2.5">
					<AmountField
						label={`${name} amount`}
						value={amount}
						reference={commitment.amount}
						min={1_000}
						onChange={(value) => setTerms({ amount: value, cadence })}
					/>
					<div className="flex flex-wrap items-center gap-2">
						<ChipSelect
							aria-label={`${name} cadence`}
							value={cadence}
							onValueChange={(value) => setTerms({ amount, cadence: value as Cadence })}
							options={CADENCES.map((c) => ({ value: c, label: cadenceLabels[c] }))}
						/>
						{terms ? (
							<RangeChips
								name={name}
								lever={terms}
								month={edit.month}
								onChange={(range) => edit.set({ ...terms, ...range })}
							/>
						) : null}
						<LineActions>
							{terms ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => edit.unset(`terms:${id}`)}
								>
									Undo<span className="sr-only"> {name} change</span>
								</Button>
							) : null}
							{ended ? null : (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() =>
										edit.set({ kind: "end-commitment", commitmentId: id, fromMonth: edit.month })
									}
								>
									End<span className="sr-only"> {name}</span>
								</Button>
							)}
						</LineActions>
					</div>
					{ended ? (
						<ChangeRange
							label="Ended"
							name={`${name} ended`}
							lever={ended}
							month={edit.month}
							onChange={(range) => edit.set({ ...ended, ...range })}
							onUndo={() => edit.unset(`commitment:${id}`)}
							undoing={`ending ${name}`}
						/>
					) : null}
				</div>
			}
		/>
	);
}

function BucketLine({
	bucket,
	mine,
	allowance: allowanceChange,
	archived: archivedChange,
	edit,
}: {
	bucket: Plan["buckets"][number];
	/** Not the other Parent's Personal Allowance, which only they change (ADR-0003). */
	mine: boolean;
	allowance: ScenarioChange | undefined;
	archived: ScenarioChange | undefined;
	edit: Editing;
}) {
	const { id, name } = bucket;
	const allowance = allowanceChange?.kind === "allowance" ? allowanceChange : null;
	const archived = archivedChange?.kind === "archive-bucket" ? archivedChange : null;
	const amount = allowance?.amount ?? bucket.allowance;
	const archive =
		archived || bucket.owner ? null : (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => edit.set({ kind: "archive-bucket", bucketId: id, fromMonth: edit.month })}
			>
				Archive<span className="sr-only"> {name}</span>
			</Button>
		);
	const set = (value: Cents) =>
		value === bucket.allowance
			? edit.unset(`bucket:${id}`)
			: edit.set({
					kind: "allowance",
					bucketId: id,
					amount: value,
					fromMonth: allowance?.fromMonth ?? edit.month,
					...(allowance?.untilMonth ? { untilMonth: allowance.untilMonth } : {}),
				});
	const leading = (
		<Tile bucket={asBucketColor(bucket.color)} aria-hidden="true">
			{monogram(name)}
		</Tile>
	);
	if (!mine) {
		// The other Parent's Personal Allowance: its total only, and not to change.
		return (
			<Line
				title={name}
				leading={leading}
				// The name already says Personal Allowance: a phone's row keeps only the rest (#74).
				meta={
					<span>
						<span className="max-sm:hidden">Personal Allowance · </span>only its Parent changes it
					</span>
				}
				value={`${formatMoney(bucket.allowance)} a month`}
				changed={false}
				wide={edit.wide}
				editor={null}
			/>
		);
	}
	return (
		<Line
			title={name}
			leading={leading}
			badge={<Mark lever={archived ?? allowance ?? undefined} />}
			meta={`Plan ${formatMoney(bucket.allowance)} a month`}
			restatesValue
			value={
				archived && archived.fromMonth <= edit.month && !archived.untilMonth
					? "Archived"
					: formatMoney(amount)
			}
			changed={allowance !== null || archived !== null}
			wide={edit.wide}
			editor={
				<div className="grid gap-2.5">
					<AmountField
						label={`${name} allowance`}
						value={amount}
						reference={bucket.allowance}
						onChange={set}
					/>
					{allowance ? (
						<ChangeRange
							name={name}
							lever={allowance}
							month={edit.month}
							onChange={(range) => edit.set({ ...allowance, ...range })}
							onUndo={() => edit.unset(`bucket:${id}`)}
							undoing={`${name} change`}
						>
							{archive}
						</ChangeRange>
					) : archive ? (
						<LineActions>{archive}</LineActions>
					) : null}
					{archived ? (
						<ChangeRange
							label="Archived"
							name={`${name} archived`}
							lever={archived}
							month={edit.month}
							onChange={(range) => edit.set({ ...archived, ...range })}
							onUndo={() => edit.unset(`archive-bucket:${id}`)}
							undoing={`archiving ${name}`}
						/>
					) : null}
				</div>
			}
		/>
	);
}

const goalValue = (target: Cents, targetDate: DayKey | null) =>
	`${formatMoney(target)} · ${targetDate ? shortMonth(monthOfDay(targetDate)) : "No date"}`;

function GoalLine({
	goal,
	lever,
	edit,
}: {
	goal: ProjectionGoal & { name: string; kind?: "save" | "payoff" };
	lever: ScenarioChange | undefined;
	edit: Editing;
}) {
	// A payoff Goal's target is what was owed when it was added: only its date can change (ADR-0019).
	const payoff = goal.kind === "payoff";
	const current = lever?.kind === "goal" ? lever : null;
	const target = current?.target ?? goal.target;
	const targetDate = current ? current.targetDate : goal.targetDate;
	const set = (next: { target: Cents; targetDate: DayKey | null }) =>
		next.target === goal.target && next.targetDate === goal.targetDate
			? edit.unset(`goal:${goal.id}`)
			: edit.set({ kind: "goal", goalId: goal.id, ...next, fromMonth: edit.month });
	return (
		<Line
			title={goal.name}
			badge={<Mark lever={current ?? undefined} />}
			meta={
				payoff
					? goal.targetDate
						? `Plan: pay it off by ${fullDay(goal.targetDate)}`
						: "Plan: pay it off, no date"
					: goal.targetDate
						? `Plan ${formatMoney(goal.target)} by ${fullDay(goal.targetDate)}`
						: `Plan ${formatMoney(goal.target)}, no date`
			}
			restatesValue
			value={
				payoff
					? targetDate
						? `Paid off by ${shortMonth(monthOfDay(targetDate))}`
						: "No date"
					: goalValue(target, targetDate)
			}
			changed={current !== null}
			wide={edit.wide}
			editor={
				<div className="grid gap-2.5">
					{payoff ? null : (
						<AmountField
							label={`${goal.name} target`}
							value={target}
							reference={goal.target}
							min={1_000}
							onChange={(value) => set({ target: value, targetDate })}
						/>
					)}
					<div className="flex flex-wrap items-center gap-2">
						<GoalDate
							name={goal.name}
							month={edit.month}
							value={targetDate}
							own={goal.targetDate}
							onChange={(date) => set({ target, targetDate: date })}
						/>
						{current ? (
							<LineActions>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => edit.unset(`goal:${goal.id}`)}
								>
									Undo<span className="sr-only"> {goal.name} change</span>
								</Button>
							</LineActions>
						) : null}
					</div>
				</div>
			}
		/>
	);
}

/** Something the Scenario adds: removing it deletes its Change. */
function AddedLine({
	lever,
	edit,
	meta,
	value,
	fields,
}: {
	lever: ScenarioChange & { name: string };
	edit: Editing;
	meta: string;
	value: string;
	fields: (change: (scenarioChange: ScenarioChange) => void) => ReactNode;
}) {
	return (
		<Line
			title={lever.name}
			badge={<Mark lever={lever} added />}
			meta={meta}
			value={value}
			changed
			wide={edit.wide}
			editor={
				<div className="grid gap-2.5">
					{fields(edit.set)}
					<LineActions>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => edit.unset(changeTarget(lever))}
						>
							Remove<span className="sr-only"> {lever.name}</span>
						</Button>
					</LineActions>
				</div>
			}
		/>
	);
}

function GrowthLine({ lever, edit }: { lever: ScenarioChange | undefined; edit: Editing }) {
	const growth = lever?.kind === "growth" ? lever : null;
	const id = useId();
	const pct = (key: "incomePct" | "costsPct", label: string) =>
		growth ? (
			<label className="grid gap-1 text-[13px] text-muted-foreground" htmlFor={`${id}-${key}`}>
				{label}
				<Input
					id={`${id}-${key}`}
					type="text"
					inputMode="decimal"
					pattern="-?[0-9]*[.]?[0-9]*"
					autoComplete="off"
					defaultValue={growth[key]}
					className="tabular-nums"
					onChange={(event) => {
						const value = Number(event.currentTarget.value);
						if (
							event.currentTarget.value !== "" &&
							Number.isFinite(value) &&
							Math.abs(value) <= 50
						) {
							edit.set({ ...growth, [key]: value });
						}
					}}
				/>
			</label>
		) : null;
	return (
		<Line
			title="Raises & inflation"
			badge={<Mark lever={growth ?? undefined} />}
			meta={growth ? "Yearly, from the month it starts" : "Off: amounts stay as the Plan has them"}
			value={growth ? `+${growth.incomePct}% · +${growth.costsPct}%` : "Off"}
			changed={growth !== null}
			wide={edit.wide}
			editor={
				<div className="grid gap-2.5">
					<label
						htmlFor="raises-and-inflation"
						className="flex items-center justify-between gap-3 text-sm"
					>
						Model raises and inflation
						<Switch
							id="raises-and-inflation"
							checked={growth !== null}
							onCheckedChange={(on) =>
								on
									? edit.set({ kind: "growth", incomePct: 3, costsPct: 3, fromMonth: edit.month })
									: edit.unset("growth")
							}
						/>
					</label>
					{growth ? (
						<>
							<div className="grid gap-3 sm:grid-cols-2">
								{pct("incomePct", "Income, % a year")}
								{pct("costsPct", "Costs, % a year")}
							</div>
							<RangeChips
								name="Raises & inflation"
								lever={growth}
								month={edit.month}
								onChange={(range) => edit.set({ ...growth, ...range })}
							/>
						</>
					) : null}
				</div>
			}
		/>
	);
}

// ---------------------------------------------------------------------------------------------
// Fields for what a Scenario adds: the same in the Add form and on the line once added. With a
// `prefix` (the line's name) each label names its line; in the Add form they're plain.

const labelled = (prefix: string | undefined, field: string) =>
	prefix ? `${prefix} ${field.toLowerCase()}` : field;

function AddedCommitmentFields({
	lever,
	prefix,
	month,
	onChange,
}: {
	lever: ScenarioChangeOf<"add-commitment">;
	prefix?: string;
	month: MonthKey;
	onChange: (scenarioChange: ScenarioChange) => void;
}) {
	return (
		<div className="grid gap-2.5">
			<NameField
				label={labelled(prefix, "Name")}
				value={lever.name}
				keepLast={prefix !== undefined}
				onChange={(name) => onChange({ ...lever, name })}
			/>
			<AmountField
				label={labelled(prefix, "Amount")}
				value={lever.amount}
				reference={100_000}
				min={1_000}
				onChange={(amount) => onChange({ ...lever, amount })}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<ChipSelect
					aria-label={labelled(prefix, "Cadence")}
					value={lever.cadence}
					onValueChange={(value) => onChange({ ...lever, cadence: value as Cadence })}
					options={CADENCES.map((c) => ({ value: c, label: cadenceLabels[c] }))}
				/>
				<ChipSelect
					aria-label={labelled(prefix, "Due day")}
					value={String(lever.dueDay)}
					onValueChange={(value) => onChange({ ...lever, dueDay: Number(value) })}
					options={Array.from({ length: 31 }, (_, i) => ({
						value: String(i + 1),
						label: `Due on day ${i + 1}`,
					}))}
				/>
				<ChipSelect
					aria-label={labelled(prefix, "Term")}
					value={lever.months === null || lever.months === undefined ? "" : String(lever.months)}
					onValueChange={(months) =>
						onChange({ ...lever, months: months === "" ? null : Number(months) })
					}
					options={[
						{ value: "", label: "Ongoing" },
						...[3, 6, 12, 18, 24, 36, 48, 60, 72, 84, 120, 180, 360].map((months) => ({
							value: String(months),
							label: `For ${months} months`,
						})),
					]}
				/>
			</div>
			<RangeChips
				name={prefix ?? ""}
				lever={lever}
				month={month}
				onChange={(range) => onChange({ ...lever, ...range })}
			/>
		</div>
	);
}

function AddedBucketFields({
	lever,
	prefix,
	month,
	onChange,
}: {
	lever: ScenarioChangeOf<"add-bucket">;
	prefix?: string;
	month: MonthKey;
	onChange: (scenarioChange: ScenarioChange) => void;
}) {
	return (
		<div className="grid gap-2.5">
			<NameField
				label={labelled(prefix, "Name")}
				value={lever.name}
				keepLast={prefix !== undefined}
				onChange={(name) => onChange({ ...lever, name })}
			/>
			<AmountField
				label={labelled(prefix, "Allowance")}
				value={lever.amount}
				reference={50_000}
				onChange={(amount) => onChange({ ...lever, amount })}
			/>
			<RangeChips
				name={prefix ?? ""}
				lever={lever}
				month={month}
				onChange={(range) => onChange({ ...lever, ...range })}
			/>
		</div>
	);
}

function AddedGoalFields({
	lever,
	prefix,
	month,
	accounts,
	onChange,
}: {
	lever: ScenarioChangeOf<"add-goal">;
	prefix?: string;
	month: MonthKey;
	accounts: { id: string; name: string }[];
	onChange: (scenarioChange: ScenarioChange) => void;
}) {
	return (
		<div className="grid gap-2.5">
			<NameField
				label={labelled(prefix, "Name")}
				value={lever.name}
				keepLast={prefix !== undefined}
				onChange={(name) => onChange({ ...lever, name })}
			/>
			<AmountField
				label={labelled(prefix, "Target")}
				value={lever.target}
				reference={lever.target}
				min={1_000}
				onChange={(target) => onChange({ ...lever, target })}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<GoalDate
					name={prefix}
					month={month}
					value={lever.targetDate}
					own={null}
					onChange={(targetDate) => onChange({ ...lever, targetDate })}
				/>
				{accounts.length > 0 ? (
					<ChipSelect
						aria-label={labelled(prefix, "Account")}
						value={lever.accountId ?? ""}
						onValueChange={(accountId) => {
							const { accountId: _, ...rest } = lever;
							onChange(accountId === "" ? rest : { ...rest, accountId });
						}}
						options={[
							{ value: "", label: "Account: choose later" },
							...accounts.map((account) => ({
								value: account.id,
								label: `Kept in ${account.name}`,
							})),
						]}
					/>
				) : null}
			</div>
		</div>
	);
}

function OneOffFields({
	lever,
	prefix,
	month,
	onChange,
}: {
	lever: ScenarioChangeOf<"one-off">;
	prefix?: string;
	month: MonthKey;
	onChange: (scenarioChange: ScenarioChange) => void;
}) {
	return (
		<div className="grid gap-2.5">
			<NameField
				label={labelled(prefix, "Name")}
				value={lever.name}
				keepLast={prefix !== undefined}
				onChange={(name) => onChange({ ...lever, name })}
			/>
			<AmountField
				label={labelled(prefix, "Amount")}
				value={lever.amount}
				reference={500_000}
				min={1_000}
				onChange={(amount) => onChange({ ...lever, amount })}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<ChipSelect
					aria-label={labelled(prefix, "Kind")}
					value={lever.flow}
					onValueChange={(value) => onChange({ ...lever, flow: value as "expense" | "income" })}
					options={[
						{ value: "expense", label: "An expense" },
						{ value: "income", label: "Income" },
					]}
				/>
				<ChipSelect
					aria-label={labelled(prefix, "Month")}
					value={lever.fromMonth}
					onValueChange={(value) => onChange({ ...lever, fromMonth: value as MonthKey })}
					options={horizonMonths(month).map((m) => ({ value: m, label: `in ${shortMonth(m)}` }))}
				/>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Controls

/** An amount on a slider, and typed: side by side from sm, the slider above the field on a phone (#74). */
function AmountField({
	label,
	value,
	reference,
	min = 0,
	onChange,
}: {
	label: string;
	value: Cents;
	/** What the slider is scaled to: the Plan's amount, or a typical one for something new. */
	reference: Cents;
	min?: Cents;
	onChange: (value: Cents) => void;
}) {
	const max = Math.max(sliderMax(reference), value);
	return (
		<div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
			<Slider
				label={label}
				valueText={formatMoney(value)}
				min={min}
				max={max}
				step={sliderStep(max)}
				value={[value]}
				onValueChange={([next]) => {
					if (next !== undefined) onChange(next);
				}}
			/>
			<MoneyInput
				aria-label={label}
				value={value}
				onCommit={(cents) => {
					if (cents >= min) onChange(cents);
				}}
			/>
		</div>
	);
}

/** A name that's never saved empty: clearing it keeps the last one until it's typed again. */
function NameField({
	label,
	value,
	keepLast,
	onChange,
}: {
	label: string;
	value: string;
	/** On a line, where a name can't be empty; the Add form refuses an empty one itself. */
	keepLast: boolean;
	onChange: (name: string) => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState(value);
	return (
		<label htmlFor={id} className="grid gap-1 text-[13px] text-muted-foreground">
			{/* In the Add form the field is empty, so its name shows; on a line the name is its own label. */}
			<span className={keepLast ? "sr-only" : undefined}>{label}</span>
			<Input
				id={id}
				value={draft}
				maxLength={40}
				placeholder={keepLast ? "Name" : "Such as Car repair"}
				autoComplete="off"
				onChange={(event) => {
					const next = event.currentTarget.value;
					setDraft(next);
					if (!keepLast || next.trim() !== "") onChange(next);
				}}
				onBlur={() => setDraft(value)}
			/>
		</label>
	);
}

/** Radix Select has no empty value; this stands for "". */
const CHIP_NONE = "__none";

/**
 * A compact choice on an Explore row, as a rounded chip: a shadcn Select. `""` is a value like any
 * other ("No date", "for good").
 */
function ChipSelect({
	value,
	onValueChange,
	options,
	"aria-label": ariaLabel,
}: {
	value: string;
	onValueChange: (value: string) => void;
	options: { value: string; label: string }[];
	"aria-label": string;
}) {
	const toChip = (v: string) => (v === "" ? CHIP_NONE : v);
	return (
		<Select
			value={toChip(value)}
			onValueChange={(next) => onValueChange(next === CHIP_NONE ? "" : next)}
		>
			<SelectTrigger size="pill" aria-label={ariaLabel}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
				{options.map((option) => (
					<SelectItem key={option.value} value={toChip(option.value)}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * The months a change holds for as chips: "from Mar 2027" "until Aug 2028", anywhere across the
 * horizon. Until is exclusive, like a Change's `untilMonth`.
 */
function RangeChips({
	name,
	lever,
	month,
	onChange,
}: {
	name: string;
	lever: ScenarioChangeRange;
	month: MonthKey;
	onChange: (range: ScenarioChangeRange) => void;
}) {
	const months = horizonMonths(month);
	const from = lever.fromMonth < month ? month : lever.fromMonth;
	const until = [...months.filter((m) => m > from), addMonths(month, MAX_PROJECTION_MONTHS)];
	return (
		<div className="flex flex-wrap items-center gap-2">
			<ChipSelect
				aria-label={labelled(name, "From")}
				value={from}
				onValueChange={(value) => {
					const fromMonth = value as MonthKey;
					onChange({
						fromMonth,
						untilMonth:
							lever.untilMonth && lever.untilMonth > fromMonth ? lever.untilMonth : undefined,
					});
				}}
				options={months.map((m) => ({ value: m, label: `from ${shortMonth(m)}` }))}
			/>
			<ChipSelect
				aria-label={labelled(name, "Until")}
				value={lever.untilMonth ?? ""}
				onValueChange={(value) =>
					onChange({ fromMonth: from, untilMonth: value === "" ? undefined : (value as MonthKey) })
				}
				options={[
					{ value: "", label: "for good" },
					...until.map((m) => ({ value: m, label: `until ${shortMonth(m)}` })),
				]}
			/>
		</div>
	);
}

/** A change's range, with a way back to the Plan. */
function ChangeRange({
	label,
	name,
	lever,
	month,
	onChange,
	onUndo,
	undoing,
	children,
}: {
	label?: string;
	name: string;
	lever: ScenarioChangeRange;
	month: MonthKey;
	onChange: (range: ScenarioChangeRange) => void;
	onUndo: () => void;
	/** What Undo undoes, for screen readers: "Take-home pay change". */
	undoing: string;
	/** More actions beside Undo. */
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{label ? <span className="text-[13px] font-medium">{label}</span> : null}
			<RangeChips name={name} lever={lever} month={month} onChange={onChange} />
			<LineActions>
				<Button type="button" variant="ghost" size="sm" onClick={onUndo}>
					Undo<span className="sr-only"> {undoing}</span>
				</Button>
				{children}
			</LineActions>
		</div>
	);
}

/** A Goal's date: any month across the horizon (its last day, or the Goal's own day), or none. */
function GoalDate({
	name,
	month,
	value,
	own,
	onChange,
}: {
	name: string | undefined;
	month: MonthKey;
	value: DayKey | null;
	/** The Goal's own date in the Plan, kept when its month is chosen. */
	own: DayKey | null;
	onChange: (date: DayKey | null) => void;
}) {
	const chosen = value ? monthOfDay(value) : "";
	const months = horizonMonths(month);
	if (chosen && !months.includes(chosen)) months.push(chosen);
	return (
		<ChipSelect
			aria-label={labelled(name, "Date")}
			value={chosen}
			onValueChange={(value) => {
				const m = value as MonthKey | "";
				if (m === "") return onChange(null);
				onChange(own && monthOfDay(own) === m ? own : lastDayOf(m));
			}}
			options={[
				{ value: "", label: "No date" },
				...months.map((m) => ({ value: m, label: `by ${shortMonth(m)}` })),
			]}
		/>
	);
}

function LineActions({ children }: { children: ReactNode }) {
	return <div className="-me-2.5 ms-auto flex items-center gap-1">{children}</div>;
}

function Empty({ children }: { children: string }) {
	return <Card className="p-(--card-pad) text-sm text-muted-foreground">{children}</Card>;
}
