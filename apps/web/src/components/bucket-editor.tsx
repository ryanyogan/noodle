import type { BucketDeleteBlocker } from "@noodle/db";
import {
	cleanGroupName,
	GROUP_NAME_MAX,
	type MonthKey,
	type PlanBucket,
	type PlanScope,
	parseDollars,
	putInOrder,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { RadioGroup, RadioGroupCard } from "@noodle/ui/components/radio-group";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated, useNavigate, useParams } from "@tanstack/react-router";
import { Archive, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import { nudged, placeOf } from "../bucket-order";
import { nextBucketColor } from "../buckets";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import {
	usePlanChange,
	withAllowance,
	withBucketDetails,
	withCarriesOver,
	withGroupRenamed,
	withNewPersonalAllowance,
	withOrder,
	withoutBucket,
} from "../plan-changes";
import { freeToSpendAfter } from "../plan-split";
import { bucketDeleteBlockersQuery, membersQuery } from "../queries";
import {
	addPersonalAllowance,
	archiveBucket,
	deleteBucket,
	renameBucketGroup,
	reorderBuckets,
	setAllowance,
	setCarriesOver,
	updateBucket,
} from "../server/plan";
import { ColourPicker } from "./colour-picker";
import { AmountInput } from "./goals";
import { Confirm, SaveFailed } from "./plan-editing";
import { PlanHistoryDisclosure } from "./plan-history";
import { PlanScopeField } from "./plan-scope-field";

/** The writes the Bucket sheet makes, kept by whatever opens it so a failure outlives the sheet. */
export function useBucketChanges(month: MonthKey) {
	const allowance = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; amountCents: number; scope: PlanScope }) =>
			setAllowance({ data }),
		apply: withAllowance,
	});
	const details = usePlanChange(month, {
		save: (data: { bucketId: string; name?: string; color?: number; group?: string | null }) =>
			updateBucket({ data }),
		apply: withBucketDetails,
	});
	// A group's new name, on every Bucket in it (issue 98); null takes them all out of it.
	const renameGroup = usePlanChange(month, {
		save: (data: { from: string; to: string | null }) => renameBucketGroup({ data }),
		apply: withGroupRenamed,
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
	// Only a Bucket nothing points at goes (issue 98); the server leaves any other as it is.
	const remove = usePlanChange(month, {
		save: (data: { bucketId: string }) => deleteBucket({ data }),
		apply: withoutBucket,
	});
	const all = [allowance, details, carriesOver, reorder, archive, remove, renameGroup];
	const failed = all.some((change) => change.isError) ? (
		<>
			<SaveFailed change={allowance} />
			<SaveFailed change={details} />
			<SaveFailed change={carriesOver} />
			<SaveFailed change={reorder} />
			<SaveFailed change={archive} />
			<SaveFailed change={remove} />
			<SaveFailed change={renameGroup} />
		</>
	) : null;
	return { allowance, details, carriesOver, reorder, archive, remove, renameGroup, failed };
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
	peers,
	groups,
	open,
	onOpenChange,
	changes,
	onDraft,
	freeToSpend,
	withHistory = false,
	amountFirst = false,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	/** The Buckets it is moved among, of `order`: its group's (issue 98). Default: all of them. */
	peers?: string[];
	/** The groups the Plan's Buckets are in. With it the sheet has the Group field. */
	groups?: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	changes: BucketChanges;
	/** Its amount while it's typed (the page's split follows it), or null once put away. */
	onDraft?: (cents: number | null) => void;
	/**
	 * The month's Free to Spend as saved. With it the sheet says what Free to Spend will be once
	 * the typed amount is saved: the page that shows it is dimmed behind the sheet.
	 */
	freeToSpend?: number;
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
						groups={groups}
						changes={changes}
						onDraft={onDraft}
						freeToSpend={freeToSpend}
						amountFirst={amountFirst}
						onDirty={setDirty}
						onCancel={() => (dirty ? setConfirmDiscard(true) : close())}
						onSaved={close}
					>
						<BucketActions
							month={month}
							bucket={bucket}
							order={order}
							peers={peers}
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
	groups,
	changes,
	onDraft,
	freeToSpend,
	amountFirst,
	onDirty,
	onCancel,
	onSaved,
	children,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	groups?: string[];
	changes: BucketChanges;
	onDraft?: (cents: number | null) => void;
	freeToSpend?: number;
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
	const [group, setGroup] = useState(bucket.group ?? "");
	const groupName = cleanGroupName(group);
	const [errors, setErrors] = useState<{ name?: boolean; amount?: boolean }>({});
	const cents = parseDollars(amount);
	const trimmed = name.trim();
	const changed = {
		name: trimmed !== bucket.name,
		allowance: cents !== bucket.allowance,
		color: color !== bucket.color,
		rolling: rolling !== bucket.rolling,
		group: groupName !== (bucket.group ?? null),
	};
	const dirty = Object.values(changed).some(Boolean);
	const after =
		freeToSpend === undefined ? null : freeToSpendAfter(freeToSpend, bucket.allowance, cents);
	useEffect(() => onDirty(dirty), [dirty, onDirty]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const next = { name: trimmed === "", amount: cents === null };
		setErrors(next);
		if (next.name || cents === null) return;
		if (changed.name || changed.color || changed.group) {
			changes.details.mutate({
				bucketId: bucket.id,
				...(changed.name ? { name: trimmed } : {}),
				...(changed.color ? { color } : {}),
				...(changed.group ? { group: groupName } : {}),
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
			{/* Always there, so a screen reader hears the figure as it changes; empty until it does. */}
			<p
				data-slot="free-to-spend-after"
				aria-live="polite"
				className="-mt-2 text-[13px] text-muted-foreground tabular-nums empty:hidden"
			>
				{after === null ? null : (
					<>
						Free to Spend after this:{" "}
						<span
							className={
								after < 0 ? "font-medium text-over-foreground" : "font-medium text-foreground"
							}
						>
							{formatMoney(after)}
						</span>
						{after < 0 ? ". More is planned than you have this month." : null}
					</>
				)}
			</p>
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
				{groups && bucket.owner === undefined ? (
					// Issue 98: a group is a name Buckets share. Type a new one, pick one there is, or
					// leave it empty for none.
					<Field
						label="Group"
						htmlFor={`${id}-group`}
						hint="Buckets in a group are listed together in the Plan, with a subtotal. Empty for no group."
					>
						<Input
							id={`${id}-group`}
							maxLength={GROUP_NAME_MAX}
							autoComplete="off"
							placeholder="No group"
							value={group}
							onChange={(event) => setGroup(event.currentTarget.value)}
						/>
						{groups.length > 0 ? (
							<div data-slot="bucket-groups" className="flex flex-wrap gap-2">
								{groups.map((name) => (
									<Button
										key={name}
										type="button"
										variant="outline"
										size="sm"
										aria-pressed={name === groupName}
										className="max-w-full aria-pressed:bg-surface-2"
										onClick={() => setGroup(name === groupName ? "" : name)}
									>
										<span className="truncate">{name}</span>
									</Button>
								))}
							</div>
						) : null}
					</Field>
				) : null}
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
	peers,
	changes,
	onArchived,
	history,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	peers?: string[];
	changes: BucketChanges;
	onArchived: () => void;
	/** Its Plan history, where the sheet shows it: between moving and archiving. */
	history?: ReactNode;
}) {
	const [confirmArchive, setConfirmArchive] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const navigate = useNavigate();
	const openId = useParams({ strict: false, select: (params) => params.id });
	// It moves among its group's Buckets (issue 98); the others keep their places.
	const among = peers ?? order;
	const index = among.indexOf(bucket.id);
	const shared = bucket.owner === undefined && order.includes(bucket.id);
	// Asked when the sheet opens: until it answers, Archive is the only way out of the Plan.
	const blockers = useQuery({ ...bucketDeleteBlockersQuery(bucket.id), enabled: shared }).data;
	const kept = blockers?.length ? keptBecause(blockers) : null;
	// A Personal Allowance has its own section, and stays in the Plan: its Parent sets it to zero
	// rather than archiving it.
	if (!shared) return history ?? null;
	const move = (by: -1 | 1) => {
		const next = nudged(among, bucket.id, by);
		if (next !== among) changes.reorder.mutate({ bucketIds: putInOrder(order, next) });
	};

	return (
		<>
			{/* Moving it without dragging: the list's handle needs a steady thumb on a phone (#98). */}
			{among.length > 1 ? (
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
						disabled={index === among.length - 1}
						onClick={() => move(1)}
					>
						<ArrowDown />
						Move down
					</Button>
					<p aria-live="polite" className="text-[13px] text-muted-foreground tabular-nums">
						{placeOf(among, bucket.id)} in {bucket.group ?? "the list"}
					</p>
				</div>
			) : null}
			{history}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<Button type="button" variant="ghost" size="sm" onClick={() => setConfirmArchive(true)}>
					<Archive />
					Archive
				</Button>
				{blockers?.length === 0 ? (
					<Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
						<Trash2 />
						Delete
					</Button>
				) : null}
				<p className="text-[13px] text-muted-foreground">
					{among.length > 1 ? "Moving and archiving happen at once." : "Archiving happens at once."}
				</p>
			</div>
			{kept ? (
				// Why there is no Delete here: what happened in it stays where it was filed.
				<p data-slot="bucket-kept" className="text-[13px] text-muted-foreground">
					{bucket.name} can’t be deleted: {kept}. Archive it instead, and earlier months keep it.
				</p>
			) : null}
			{confirmDelete ? (
				<Confirm
					onConfirm={() => {
						onArchived();
						changes.remove.mutate({ bucketId: bucket.id });
						// Its own page, open beside the list, has nothing left to show.
						if (openId === bucket.id) navigate({ to: "/plan/$month", params: { month } });
					}}
					onCancel={() => setConfirmDelete(false)}
					confirmLabel={`Delete ${bucket.name}`}
				>
					{bucket.name} goes for good, with its allowance and its Plan history. Nothing was ever
					filed in it, so no Transaction changes.
				</Confirm>
			) : null}
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

/**
 * A group's own sheet (issue 98), from Rename on its heading in the Plan's Buckets: its name, on
 * every Bucket in it. An empty name takes them all out of the group; the Buckets stay.
 */
export function GroupSheet({
	group,
	changes,
	onClose,
}: {
	group: string;
	changes: BucketChanges;
	onClose: () => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [name, setName] = useState(group);
	const next = cleanGroupName(name);
	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			<SheetContent>
				<SheetHeader title={group} description="Group of Buckets" />
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (next !== group) changes.renameGroup.mutate({ from: group, to: next });
						onClose();
					}}
				>
					<Field
						label="Group name"
						htmlFor={`${id}-name`}
						hint="Empty takes its Buckets out of the group. They stay in the Plan."
					>
						<Input
							id={`${id}-name`}
							maxLength={GROUP_NAME_MAX}
							autoComplete="off"
							value={name}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
					</Field>
					<SheetFooter className="max-lg:grid-cols-2">
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={!hydrated || next === group}>
							{next === null ? "Remove group" : "Save"}
						</Button>
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	);
}

const KEPT: Record<BucketDeleteBlocker, string> = {
	"personal-allowance": "it is a Personal Allowance",
	"earlier-months": "it was in an earlier month’s Plan",
	spending: "Transactions are filed in it",
	moves: "money was Moved in or out of it",
	rules: "a Rule files into it",
};

/** Why a Bucket is kept, in words: "Transactions are filed in it, and a Rule files into it". */
export const keptBecause = (blockers: readonly BucketDeleteBlocker[]) =>
	new Intl.ListFormat("en", { type: "conjunction" }).format(blockers.map((b) => KEPT[b]));

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
					// Its words wrap inside it when they have no room on one line (a phone at 200% text).
					className="justify-self-start max-sm:h-auto max-sm:min-h-11 max-sm:max-w-full max-sm:py-2 max-sm:whitespace-normal"
					disabled={!hydrated}
				>
					<Plus />
					Set up Personal Allowance
				</Button>
			</form>
		</Card>
	);
}
