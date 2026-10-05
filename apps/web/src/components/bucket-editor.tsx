import {
	type BucketState,
	type MonthKey,
	type PlanBucket,
	type PlanScope,
	parseDollars,
} from "@noodle/domain";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { ListRow } from "@noodle/ui/components/list";
import { RadioGroup, RadioGroupCard } from "@noodle/ui/components/radio-group";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ulid } from "ulid";
import { nudged, placeOf } from "../bucket-order";
import { opensBucketSheet } from "../bucket-row-click";
import { asBucketColor, barState, monogram, nextBucketColor } from "../buckets";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import {
	usePlanChange,
	withAllowance,
	withBucketDetails,
	withCarriesOver,
	withNewPersonalAllowance,
	withOrder,
	withoutBucket,
} from "../plan-changes";
import { membersQuery } from "../queries";
import {
	addPersonalAllowance,
	archiveBucket,
	reorderBuckets,
	setAllowance,
	setCarriesOver,
	updateBucket,
} from "../server/plan";
import { ColourPicker } from "./colour-picker";
import { AmountInput } from "./goals";
import { masterDetailItem } from "./master-detail";
import { Confirm, SaveFailed } from "./plan-editing";
import { PlanHistoryDisclosure } from "./plan-history";
import { ChangedNote, PlanScopeField } from "./plan-scope-field";

/**
 * A Bucket (or Personal Allowance) in the Plan: its allowance, and the one Bucket sheet that
 * changes it (#98), the same one its page opens. The row opens it wherever it is chosen (its
 * amount, its figures, its pencil); only its name, which leads to its page, and its handle do
 * something else. `was` is its allowance the month before, when this month changed it.
 */
export function BucketEditor({
	month,
	bucket,
	editable,
	was,
	order,
	setBy,
	handle,
	dragged,
	onDraft,
	figures,
}: {
	month: MonthKey;
	bucket: PlanBucket | BucketState;
	/**
	 * In a list with the page's width, the row is a line of a table: allowance, spent so far, what's
	 * left and its bar, each in its own column (`BucketColumns` heads them). Needs the month's state.
	 */
	figures?: boolean;
	editable: boolean;
	was?: number;
	/** The handle that moves it in the list, before its tile. */
	handle?: ReactNode;
	/** Whether it's being dragged to a new place. */
	dragged?: boolean;
	/** Its amount while typed in its sheet (for Left to plan), or null once put away. */
	onDraft?: (cents: number | null) => void;
	/** Who sets this one, when it isn't the viewer (the other Parent's Personal Allowance). */
	setBy?: string;
	/** The shared Buckets' IDs in order, for moving this one; a Personal Allowance has none. */
	order: string[];
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const color = asBucketColor(bucket.color);
	const changes = useBucketChanges(month);
	const spending = figures && "spent" in bucket ? bucket : undefined;
	const opens = editable && hydrated;
	// Whether the press now under way began where the row opens its sheet: the click that ends a
	// drag by the handle lands on the row, and mustn't open it.
	const pressed = useRef(false);
	return (
		<ListRow
			data-bucket-row={bucket.id}
			className={cn(opens && "cursor-pointer", dragged && "relative z-1 bg-surface-2 shadow-pop")}
			// The whole row is the pencil's hit area, for a thumb or a mouse; the pencil is the one
			// control a keyboard or screen reader meets, and takes focus so it comes back to it when
			// the sheet closes.
			onPointerDown={(event) => {
				pressed.current = opens && opensBucketSheet(event.target, event.currentTarget);
			}}
			onClick={(event) => {
				const began = pressed.current;
				pressed.current = false;
				if (!began || !opens || !opensBucketSheet(event.target, event.currentTarget)) return;
				event.currentTarget
					.querySelector<HTMLElement>("[data-bucket-edit]")
					?.focus({ preventScroll: true });
				setOpen(true);
			}}
			leading={
				handle ? (
					<div className="flex items-center gap-1">
						{handle}
						<Tile bucket={color}>{monogram(bucket.name)}</Tile>
					</div>
				) : (
					<Tile bucket={color}>{monogram(bucket.name)}</Tile>
				)
			}
			title={
				<Link
					to="/plan/$month/buckets/$id"
					params={{ month, id: bucket.id }}
					className="hover:underline"
					{...masterDetailItem}
				>
					{bucket.name}
				</Link>
			}
			meta={
				// Only the choice that isn't the default is named (most Buckets reset monthly).
				bucket.rolling ? (
					<>
						<span>Carries over</span>
						<ChangedNote was={was} />
					</>
				) : was != null ? (
					<span>Changed this month · was {formatMoney(was)}</span>
				) : setBy ? (
					<span>{setBy} sets this</span>
				) : undefined
			}
			trailing={
				<div className="flex items-center gap-1">
					<span
						className={cn(
							"text-sm font-medium tabular-nums",
							spending && `${COLUMN.allowance} @2xl:px-2 @2xl:text-end`,
							// Clear of the pencil beside it (or the space kept for one), so amounts line up.
							(editable || setBy) && "px-2",
						)}
					>
						{formatMoney(bucket.allowance)}
					</span>
					{spending ? (
						<>
							<span
								className={cn("hidden text-sm text-muted-foreground @2xl:block", COLUMN.figure)}
							>
								<span className="sr-only">Spent </span>
								{formatMoney(spending.spent)}
							</span>
							<span
								className={cn(
									"hidden text-sm font-medium @2xl:block",
									COLUMN.figure,
									spending.left < 0 && "text-over-foreground",
								)}
							>
								<span className="sr-only">Left </span>
								{formatMoney(spending.left)}
							</span>
							<div className={cn("hidden @2xl:block", COLUMN.bar)}>
								<BudgetBar
									bucket={color}
									value={spending.spent}
									max={spending.available}
									marker={1 - spending.pace.leftShare}
									state={barState(spending.status)}
									label={`${bucket.name} this month`}
									valueText={`${formatMoney(spending.spent)} spent of ${formatMoney(spending.available)}, ${
										spending.left < 0
											? `${formatMoney(-spending.left)} over`
											: `${formatMoney(spending.left)} left`
									}`}
								/>
							</div>
						</>
					) : null}
					{editable ? (
						<Button
							variant="ghost"
							size="icon"
							type="button"
							disabled={!hydrated}
							aria-label={`Edit ${bucket.name}`}
							aria-haspopup="dialog"
							data-bucket-edit=""
							onClick={() => setOpen(true)}
						>
							<Pencil />
						</Button>
					) : setBy ? (
						// Keeps the pencil's space, so its amount lines up with the viewer's own.
						<span aria-hidden="true" className="size-8 shrink-0" />
					) : null}
					<BucketSheet
						month={month}
						bucket={bucket}
						order={order}
						open={open}
						onOpenChange={setOpen}
						changes={changes}
						onDraft={onDraft}
						withHistory
						amountFirst
					/>
				</div>
			}
			below={changes.failed ?? undefined}
		/>
	);
}

/** The widths of a row's columns in a wide list, shared with the line that heads them. */
const COLUMN = {
	allowance: "@2xl:w-24 @2xl:justify-end",
	figure: "w-20 px-2 text-end tabular-nums",
	// The bar takes what a wider list has to spare.
	bar: "w-28 px-2 @3xl:w-44 @4xl:w-64 @5xl:w-96 @6xl:w-[30rem]",
};

/** Heads the columns of the rows beneath it, in a list wide enough to show them. */
export function BucketColumns({ pencil }: { pencil: boolean }) {
	return (
		<div
			aria-hidden="true"
			data-slot="bucket-columns"
			className="hidden items-center justify-end gap-1 px-(--card-pad) text-xs font-medium text-subtle-foreground @2xl:flex"
		>
			<span className="w-24 px-2 text-end">Allowance</span>
			<span className={COLUMN.figure}>Spent</span>
			<span className={COLUMN.figure}>Left</span>
			<span className={COLUMN.bar}>This month</span>
			{pencil ? <span className="size-8 shrink-0" /> : null}
		</div>
	);
}

/** The writes the Bucket sheet makes, kept by whatever opens it so a failure outlives the sheet. */
export function useBucketChanges(month: MonthKey) {
	const allowance = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; amountCents: number; scope: PlanScope }) =>
			setAllowance({ data }),
		apply: withAllowance,
	});
	const details = usePlanChange(month, {
		save: (data: { bucketId: string; name?: string; color?: number }) => updateBucket({ data }),
		apply: withBucketDetails,
	});
	const carriesOver = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; rolling: boolean }) =>
			setCarriesOver({ data }),
		apply: withCarriesOver,
	});
	const reorder = usePlanChange(month, {
		save: (data: { bucketIds: string[] }) => reorderBuckets({ data }),
		apply: withOrder,
	});
	const archive = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey }) => archiveBucket({ data }),
		apply: withoutBucket,
	});
	const all = [allowance, details, carriesOver, reorder, archive];
	const failed = all.some((change) => change.isError) ? (
		<>
			<SaveFailed change={allowance} />
			<SaveFailed change={details} />
			<SaveFailed change={carriesOver} />
			<SaveFailed change={reorder} />
			<SaveFailed change={archive} />
		</>
	) : null;
	return { allowance, details, carriesOver, reorder, archive, failed };
}

export type BucketChanges = ReturnType<typeof useBucketChanges>;

/**
 * The Bucket sheet, the one place a Bucket changes (#98), most used first: its allowance (from
 * this month on, or just this month) and name; then, under "More", its colour and whether it
 * carries over, all saved together by one Save (Enter saves too); then moving it, its Plan
 * history and archiving it, which act at once. Closing it with unsaved changes asks first.
 */
export function BucketSheet({
	month,
	bucket,
	order,
	open,
	onOpenChange,
	changes,
	onDraft,
	withHistory = false,
	amountFirst = false,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	changes: BucketChanges;
	/** Its amount while it's typed (for the list's Left to plan), or null once put away. */
	onDraft?: (cents: number | null) => void;
	withHistory?: boolean;
	/**
	 * Opened from the list, where the amount is what a Parent most often came to change: it takes
	 * focus on a phone too (keyboard up), as it did when the amount was typed in the list. On
	 * desktop a sheet's first field, the amount, has focus anyway.
	 */
	amountFirst?: boolean;
}) {
	const [dirty, setDirty] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const close = () => {
		setDirty(false);
		setConfirmDiscard(false);
		onDraft?.(null);
		onOpenChange(false);
	};
	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (next) onOpenChange(true);
				else if (dirty) setConfirmDiscard(true);
				else close();
			}}
		>
			{open ? (
				<SheetContent>
					<SheetHeader
						title={bucket.name}
						description={bucket.owner === undefined ? "Bucket" : "Personal Allowance"}
					/>
					<BucketForm
						month={month}
						bucket={bucket}
						changes={changes}
						onDraft={onDraft}
						amountFirst={amountFirst}
						onDirty={setDirty}
						onCancel={() => (dirty ? setConfirmDiscard(true) : close())}
						onSaved={close}
					>
						<BucketActions
							month={month}
							bucket={bucket}
							order={order}
							changes={changes}
							onArchived={close}
							history={
								withHistory ? <PlanHistoryDisclosure month={month} targetId={bucket.id} /> : null
							}
						/>
					</BucketForm>
					{confirmDiscard ? (
						<Confirm
							confirmLabel="Discard changes"
							onConfirm={close}
							onCancel={() => setConfirmDiscard(false)}
						>
							What you changed in {bucket.name} hasn’t been saved.
						</Confirm>
					) : null}
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function BucketForm({
	month,
	bucket,
	changes,
	onDraft,
	amountFirst,
	onDirty,
	onCancel,
	onSaved,
	children,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	changes: BucketChanges;
	onDraft?: (cents: number | null) => void;
	amountFirst: boolean;
	onDirty: (dirty: boolean) => void;
	onCancel: () => void;
	onSaved: () => void;
	/** Moving it, its history and archiving it: the end of "More", above the footer. */
	children?: ReactNode;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [name, setName] = useState(bucket.name);
	const [amount, setAmount] = useState(() => formatMoneyInput(bucket.allowance));
	const [scope, setScope] = useState<PlanScope>("from-on");
	const [color, setColor] = useState(bucket.color);
	const [rolling, setRolling] = useState(bucket.rolling);
	const [errors, setErrors] = useState<{ name?: boolean; amount?: boolean }>({});
	const cents = parseDollars(amount);
	const trimmed = name.trim();
	const changed = {
		name: trimmed !== bucket.name,
		allowance: cents !== bucket.allowance,
		color: color !== bucket.color,
		rolling: rolling !== bucket.rolling,
	};
	const dirty = Object.values(changed).some(Boolean);
	useEffect(() => onDirty(dirty), [dirty, onDirty]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const next = { name: trimmed === "", amount: cents === null };
		setErrors(next);
		if (next.name || cents === null) return;
		if (changed.name || changed.color) {
			changes.details.mutate({
				bucketId: bucket.id,
				...(changed.name ? { name: trimmed } : {}),
				...(changed.color ? { color } : {}),
			});
		}
		if (changed.allowance) {
			changes.allowance.mutate({ bucketId: bucket.id, month, amountCents: cents, scope });
		}
		if (changed.rolling) changes.carriesOver.mutate({ bucketId: bucket.id, month, rolling });
		onSaved();
	}

	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<Field label="Allowance" htmlFor={`${id}-amount`}>
				<AmountInput
					id={`${id}-amount`}
					placeholder="0"
					value={amount}
					aria-invalid={errors.amount || undefined}
					data-autofocus={amountFirst ? "" : undefined}
					// What's typed replaces the amount, as it did when it was typed in the list.
					onFocus={(event) => event.currentTarget.select()}
					onChange={(event) => {
						const value = event.currentTarget.value;
						setAmount(value);
						onDraft?.(parseDollars(value));
					}}
				/>
			</Field>
			{changed.allowance && cents !== null ? (
				<PlanScopeField
					month={month}
					current={bucket.allowance}
					scope={scope}
					onScopeChange={setScope}
				/>
			) : null}
			<Field label="Name" htmlFor={`${id}-name`}>
				<Input
					id={`${id}-name`}
					maxLength={40}
					autoComplete="off"
					value={name}
					aria-invalid={errors.name || undefined}
					onChange={(event) => setName(event.currentTarget.value)}
				/>
			</Field>
			{errors.name ? <FormError>Give the Bucket a name.</FormError> : null}
			{errors.amount ? (
				<FormError>Enter the allowance as a dollar amount, like 250 or 85.50.</FormError>
			) : null}
			{/* Used less often, so quieter and last; nothing is hidden behind another tap. */}
			<div data-slot="bucket-more" className="grid gap-4 border-t pt-4">
				<p className="text-[13px] font-medium text-muted-foreground">More</p>
				<ColourPicker value={color} onChange={setColor} />
				<CarriesOverField
					name={`${id}-rolling`}
					rolling={rolling}
					onChange={setRolling}
					hint={changed.rolling ? `From ${monthName(month)} on.` : undefined}
				/>
				{children}
			</div>
			<SheetFooter className="max-lg:grid-cols-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={!hydrated || !dirty}>
					Save
				</Button>
			</SheetFooter>
		</form>
	);
}

/** "At the end of the month": Resets monthly or Carries over, each with what it means. */
export function CarriesOverField({
	name,
	rolling,
	onChange,
	hint,
}: {
	name: string;
	rolling: boolean;
	onChange: (rolling: boolean) => void;
	hint?: string;
}) {
	const labelId = useId();
	return (
		<div className="grid gap-2">
			<p id={labelId} className="mb-2 text-sm font-medium">
				At the end of the month
			</p>
			<RadioGroup
				aria-labelledby={labelId}
				value={rolling ? "carries-over" : "resets"}
				onValueChange={(value) => onChange(value === "carries-over")}
			>
				{carriesOverOptions.map((option) => (
					<RadioGroupCard
						key={option.label}
						id={`${name}-${option.rolling ? "carries-over" : "resets"}`}
						value={option.rolling ? "carries-over" : "resets"}
						label={option.label}
						description={option.description}
						className="border-transparent bg-surface-2 has-data-[state=checked]:bg-surface-2"
					/>
				))}
			</RadioGroup>
			{hint ? <p className="text-xs text-subtle-foreground">{hint}</p> : null}
		</div>
	);
}

/**
 * The end of the sheet's "More": moving a Bucket, its Plan history, and archiving it. Moving and
 * archiving act at once, apart from the form's Save.
 */
function BucketActions({
	month,
	bucket,
	order,
	changes,
	onArchived,
	history,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	changes: BucketChanges;
	onArchived: () => void;
	/** Its Plan history, where the sheet shows it: between moving and archiving. */
	history?: ReactNode;
}) {
	const [confirmArchive, setConfirmArchive] = useState(false);
	const index = order.indexOf(bucket.id);
	// A Personal Allowance has its own section, and stays in the Plan: its Parent sets it to zero
	// rather than archiving it.
	if (bucket.owner !== undefined || index < 0) return history ?? null;
	const move = (by: -1 | 1) => {
		const next = nudged(order, bucket.id, by);
		if (next !== order) changes.reorder.mutate({ bucketIds: next });
	};

	return (
		<>
			{/* Moving it without dragging: the list's handle needs a steady thumb on a phone (#98). */}
			{order.length > 1 ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={index === 0}
						onClick={() => move(-1)}
					>
						<ArrowUp />
						Move up
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={index === order.length - 1}
						onClick={() => move(1)}
					>
						<ArrowDown />
						Move down
					</Button>
					<p aria-live="polite" className="text-[13px] text-muted-foreground tabular-nums">
						{placeOf(order, bucket.id)} in the list
					</p>
				</div>
			) : null}
			{history}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<Button type="button" variant="ghost" size="sm" onClick={() => setConfirmArchive(true)}>
					<Archive />
					Archive
				</Button>
				<p className="text-[13px] text-muted-foreground">
					{order.length > 1 ? "Moving and archiving happen at once." : "Archiving happens at once."}
				</p>
			</div>
			{confirmArchive ? (
				<Confirm
					onConfirm={() => {
						onArchived();
						changes.archive.mutate({ bucketId: bucket.id, month });
					}}
					onCancel={() => setConfirmArchive(false)}
					confirmLabel={`Archive ${bucket.name}`}
				>
					{bucket.name} leaves the Plan from {monthName(month)} on. Earlier months keep it.
				</Confirm>
			) : null}
		</>
	);
}

const carriesOverOptions = [
	{
		rolling: false,
		label: "Resets monthly",
		description: "Starts each month at its allowance. What’s left can go to a Goal.",
	},
	{
		rolling: true,
		label: "Carries over",
		description:
			"What’s left carries into next month, and so does overspending that isn’t Covered.",
	},
];

/**
 * Sets up the signed-in Parent's Personal Allowance: a Bucket of their own, counted in the Plan,
 * whose Transactions only they see.
 */
export function AddPersonalAllowance({
	month,
	parentId,
	buckets,
}: {
	month: MonthKey;
	parentId: string;
	buckets: PlanBucket[];
}) {
	const hydrated = useHydrated();
	const members = useSuspenseQuery(membersQuery()).data;
	const firstName = members.find((m) => m.id === parentId)?.name.split(/\s+/)[0];
	// Reused by a retry of the same attempt, so it's added once.
	const [bucketId] = useState(() => ulid());
	const [invalidAmount, setInvalidAmount] = useState(false);
	const add = usePlanChange(month, {
		save: (data: {
			bucketId: string;
			month: MonthKey;
			name: string;
			color: number;
			allowanceCents: number;
		}) => addPersonalAllowance({ data }),
		apply: (data, variables) => withNewPersonalAllowance(data, { ...variables, owner: parentId }),
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const allowanceCents = parseDollars(
			String(new FormData(event.currentTarget).get("allowance") ?? ""),
		);
		setInvalidAmount(allowanceCents === null);
		if (allowanceCents === null) return;
		add.mutate({
			bucketId,
			month,
			name: firstName ? `${firstName}’s Personal Allowance` : "Personal Allowance",
			color: nextBucketColor(buckets.map((b) => b.color)),
			allowanceCents,
		});
	}

	return (
		<Card>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<p className="text-[13px] text-muted-foreground">
					Money that’s yours to spend each month. It counts in the Plan like any Bucket; the other
					Parent sees only its totals, never what you spent it on.
				</p>
				<Field label="Your Personal Allowance" htmlFor="new-personal-allowance">
					<Input
						id="new-personal-allowance"
						name="allowance"
						required
						inputMode="decimal"
						autoComplete="off"
						placeholder="0"
						className="tabular-nums sm:w-40"
						aria-invalid={invalidAmount || undefined}
					/>
				</Field>
				{invalidAmount ? (
					<FormError>Enter the allowance as a dollar amount, like 250 or 85.50.</FormError>
				) : null}
				<SaveFailed change={add} />
				<Button
					type="submit"
					variant="secondary"
					className="justify-self-start"
					disabled={!hydrated}
				>
					<Plus />
					Set up Personal Allowance
				</Button>
			</form>
		</Card>
	);
}
