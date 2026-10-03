import { type MonthKey, type PlanBucket, type PlanScope, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { ListRow } from "@noodle/ui/components/list";
import { RadioGroup, RadioGroupCard } from "@noodle/ui/components/radio-group";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { Archive, Pencil, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram, nextBucketColor } from "../buckets";
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
 * A Bucket (or Personal Allowance) in the Plan: its allowance, and the Bucket sheet to change it,
 * the same one its page opens. `was` is its allowance the month before, when this month changed
 * it.
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
}: {
	month: MonthKey;
	bucket: PlanBucket;
	editable: boolean;
	was?: number;
	/** The handle that moves it in the list, before its tile. */
	handle?: ReactNode;
	/** Whether it's being dragged to a new place. */
	dragged?: boolean;
	/** Its amount while typed in the list (for Left to plan), or null once put away. */
	onDraft?: (cents: number | null) => void;
	/** Who sets this one, when it isn't the viewer (the other Parent's Personal Allowance). */
	setBy?: string;
	/** The shared Buckets' IDs in order, for moving this one; a Personal Allowance has none. */
	order: string[];
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const [inline, setInline] = useState(false);
	const color = asBucketColor(bucket.color);
	const changes = useBucketChanges(month);
	function closeInline() {
		setInline(false);
		onDraft?.(null);
	}
	return (
		<ListRow
			data-bucket-row={bucket.id}
			className={dragged ? "relative z-1 bg-surface-2 shadow-pop" : undefined}
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
					{editable && onDraft ? (
						<Button
							variant="ghost"
							size="sm"
							type="button"
							disabled={!hydrated}
							aria-label={`Change ${bucket.name}: ${formatMoney(bucket.allowance)}`}
							aria-expanded={inline}
							className="px-2 font-medium tabular-nums"
							onClick={() => (inline ? closeInline() : setInline(true))}
						>
							{formatMoney(bucket.allowance)}
						</Button>
					) : (
						<span className="text-sm font-medium tabular-nums">
							{formatMoney(bucket.allowance)}
						</span>
					)}
					{editable ? (
						<Button
							variant="ghost"
							size="icon"
							type="button"
							disabled={!hydrated}
							aria-label={`Edit ${bucket.name}`}
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
						withHistory
					/>
				</div>
			}
			belowFull={inline}
			below={
				inline || changes.failed ? (
					<div className="grid gap-2">
						{inline ? (
							<InlineBucketForm
								month={month}
								bucket={bucket}
								changes={changes}
								onDraft={(cents) => onDraft?.(cents)}
								onDone={closeInline}
							/>
						) : null}
						{changes.failed}
					</div>
				) : undefined
			}
		/>
	);
}

/**
 * A Bucket's name and amount, changed right in the list: Enter saves, Escape puts it away. A new
 * amount asks how far it reaches, as the sheet does, and is saved as a Plan change.
 */
function InlineBucketForm({
	month,
	bucket,
	changes,
	onDraft,
	onDone,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	changes: BucketChanges;
	onDraft: (cents: number | null) => void;
	onDone: () => void;
}) {
	const id = useId();
	const [name, setName] = useState(bucket.name);
	const [amount, setAmount] = useState(() => formatMoneyInput(bucket.allowance));
	const [scope, setScope] = useState<PlanScope>("from-on");
	const cents = parseDollars(amount);
	const trimmed = name.trim();
	const changedAmount = cents !== null && cents !== bucket.allowance;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (trimmed === "" || cents === null) return;
		if (trimmed !== bucket.name) changes.details.mutate({ bucketId: bucket.id, name: trimmed });
		if (changedAmount) {
			changes.allowance.mutate({ bucketId: bucket.id, month, amountCents: cents, scope });
		}
		onDone();
	}

	return (
		<form
			onSubmit={onSubmit}
			noValidate
			aria-label={`Change ${bucket.name}`}
			className="col-span-full grid gap-3 rounded-xl bg-surface-2 p-3"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				onDone();
			}}
		>
			<div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						maxLength={40}
						autoComplete="off"
						enterKeyHint="done"
						value={name}
						aria-invalid={trimmed === "" || undefined}
						onChange={(event) => setName(event.currentTarget.value)}
					/>
				</Field>
				<Field label="Allowance" htmlFor={`${id}-amount`}>
					<AmountInput
						id={`${id}-amount`}
						// Opened to change the amount, so it starts there.
						autoFocus
						enterKeyHint="done"
						value={amount}
						aria-invalid={cents === null || undefined}
						onFocus={(event) => event.currentTarget.select()}
						onChange={(event) => {
							const value = event.currentTarget.value;
							setAmount(value);
							onDraft(parseDollars(value));
						}}
					/>
				</Field>
			</div>
			{changedAmount ? (
				<PlanScopeField
					month={month}
					current={bucket.allowance}
					scope={scope}
					onScopeChange={setScope}
				/>
			) : null}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onDone}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={trimmed === "" || cents === null}>
					Save
				</Button>
			</div>
		</form>
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
 * The Bucket sheet, the one place a Bucket changes: its name, allowance (from this month on, or
 * just this month), colour, and whether it carries over, saved together by one Save; then moving
 * and archiving it, which act at once. Closing it with unsaved changes asks first.
 */
export function BucketSheet({
	month,
	bucket,
	order,
	open,
	onOpenChange,
	changes,
	withHistory = false,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	changes: BucketChanges;
	withHistory?: boolean;
}) {
	const [dirty, setDirty] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const close = () => {
		setDirty(false);
		setConfirmDiscard(false);
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
						onDirty={setDirty}
						onCancel={() => (dirty ? setConfirmDiscard(true) : close())}
						onSaved={close}
					>
						{withHistory ? <PlanHistoryDisclosure month={month} targetId={bucket.id} /> : null}
						<BucketActions
							month={month}
							bucket={bucket}
							order={order}
							changes={changes}
							onArchived={close}
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
	onDirty,
	onCancel,
	onSaved,
	children,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	changes: BucketChanges;
	onDirty: (dirty: boolean) => void;
	onCancel: () => void;
	onSaved: () => void;
	/** History and the Bucket's other actions: above the footer, so Save stays last. */
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
					onChange={(event) => setAmount(event.currentTarget.value)}
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
			<ColourPicker value={color} onChange={setColor} />
			<CarriesOverField
				name={`${id}-rolling`}
				rolling={rolling}
				onChange={setRolling}
				hint={changed.rolling ? `From ${monthName(month)} on.` : undefined}
			/>
			{errors.name ? <FormError>Give the Bucket a name.</FormError> : null}
			{errors.amount ? (
				<FormError>Enter the allowance as a dollar amount, like 250 or 85.50.</FormError>
			) : null}
			{children}
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

/** Moving and archiving a Bucket: they act at once, apart from the form's Save. */
function BucketActions({
	month,
	bucket,
	order,
	changes,
	onArchived,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	changes: BucketChanges;
	onArchived: () => void;
}) {
	const [confirmArchive, setConfirmArchive] = useState(false);
	const index = order.indexOf(bucket.id);
	// A Personal Allowance has its own section, and stays in the Plan: its Parent sets it to zero
	// rather than archiving it.
	if (bucket.owner !== undefined || index < 0) return null;

	return (
		<div className="grid gap-2 border-t pt-4">
			<p className="text-[13px] text-muted-foreground">These happen at once.</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={() => setConfirmArchive(true)}>
					<Archive />
					Archive
				</Button>
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
		</div>
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
