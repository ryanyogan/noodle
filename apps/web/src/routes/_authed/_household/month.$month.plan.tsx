import { type MonthKey, type MonthState, type PlanBucket, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Archive, ArrowDown, ArrowUp, ChevronLeft, Pencil, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, bucketColors, monogram, nextBucketColor } from "../../../buckets";
import { MoneyInput } from "../../../components/money-input";
import { formatMoney, monthName } from "../../../format";
import {
	usePlanChange,
	withAllowance,
	withBaseline,
	withBucketDetails,
	withNewBucket,
	withOrder,
	withoutBucket,
} from "../../../plan-changes";
import { useMonthState } from "../../../queries";
import {
	addBucket,
	archiveBucket,
	reorderBuckets,
	setAllowance,
	setBaseline,
	updateBucket,
} from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/month/$month/plan")({
	component: PlanPage,
});

function PlanPage() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	// Owned here: archiving removes the Bucket's row, which must not take the error with it.
	const archive = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey }) => archiveBucket({ data }),
		apply: withoutBucket,
	});
	return (
		<>
			<PageHeader
				eyebrow={monthName(month)}
				title="Plan"
				leading={
					<Button variant="ghost" size="icon" asChild>
						<Link to="/month/$month" params={{ month }} aria-label="Back to This Month">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
			/>
			<div className="grid max-w-2xl gap-8">
				{state.editable ? null : (
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						This month has ended, so its Plan can no longer change.
					</Card>
				)}
				<Summary state={state} />
				<Section aria-labelledby="plan-buckets">
					<SectionHeader id="plan-buckets" title="Buckets" count={state.buckets.length} />
					<SaveFailed change={archive} />
					{state.buckets.length > 0 ? (
						<List>
							{state.buckets.map((bucket, index) => (
								<BucketEditor
									key={bucket.id}
									month={month}
									bucket={bucket}
									order={state.buckets.map((b) => b.id)}
									index={index}
									editable={state.editable}
									onArchive={(bucketId) => archive.mutate({ bucketId, month })}
								/>
							))}
						</List>
					) : null}
					{state.editable ? <AddBucket month={month} buckets={state.buckets} /> : null}
				</Section>
			</div>
		</>
	);
}

/** Baseline, less what the Buckets take, is Free to Spend. Over-planning is said out loud. */
function Summary({ state }: { state: MonthState & { editable: boolean } }) {
	const hydrated = useHydrated();
	const change = usePlanChange(state.month, {
		save: (data: { month: MonthKey; amountCents: number }) => setBaseline({ data }),
		apply: withBaseline,
	});
	const overBy = -state.freeToSpend;
	return (
		<Section aria-labelledby="plan-summary">
			<SectionHeader id="plan-summary" title="Free to Spend" />
			<Card>
				<div className="grid gap-3 p-(--card-pad)">
					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<label htmlFor="baseline" className="text-sm font-medium">
								Baseline
							</label>
							<span className="text-[13px] text-muted-foreground">
								Your normal monthly take-home pay
							</span>
						</div>
						<MoneyInput
							id="baseline"
							className="w-36 shrink-0"
							value={state.baseline ?? 0}
							readOnly={!hydrated || !state.editable}
							onCommit={(amountCents) => change.mutate({ month: state.month, amountCents })}
						/>
					</div>
					<SaveFailed change={change} />
				</div>
				<dl className="grid gap-2 border-t p-(--card-pad) text-sm">
					<SummaryRow label="In Buckets" value={`−${formatMoney(state.planned)}`} />
					<SummaryRow
						label="Free to Spend"
						value={formatMoney(state.freeToSpend)}
						className={cn("font-semibold", overBy > 0 && "text-over")}
					/>
				</dl>
				{overBy > 0 ? (
					<p
						role="status"
						className="border-t bg-over-soft px-(--card-pad) py-3 text-[13px] text-over"
					>
						Your Buckets add up to {formatMoney(overBy)} more than your Baseline. Lower an allowance
						or raise the Baseline.
					</p>
				) : null}
			</Card>
		</Section>
	);
}

function SummaryRow({
	label,
	value,
	className,
}: {
	label: string;
	value: string;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center justify-between gap-4", className)}>
			<dt>{label}</dt>
			<dd className="tabular-nums">{value}</dd>
		</div>
	);
}

/** Says a Plan change didn't save (and was rolled back), with a retry of the same change. */
function SaveFailed<V>({
	change,
}: {
	change: { isError: boolean; variables: V | undefined; mutate: (variables: V) => void };
}) {
	if (!change.isError || change.variables === undefined) return null;
	const { variables } = change;
	return (
		<FormError className="items-center justify-between">
			We couldn’t save that change, so it’s been undone.
			<Button variant="outline" size="sm" type="button" onClick={() => change.mutate(variables)}>
				Try again
			</Button>
		</FormError>
	);
}

function BucketEditor({
	month,
	bucket,
	order,
	index,
	editable,
	onArchive,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	index: number;
	editable: boolean;
	onArchive: (bucketId: string) => void;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const detailsId = useId();
	const color = asBucketColor(bucket.color);
	const allowance = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; amountCents: number }) =>
			setAllowance({ data }),
		apply: withAllowance,
	});
	return (
		<ListRow
			leading={<Tile bucket={color}>{monogram(bucket.name)}</Tile>}
			title={bucket.name}
			trailing={
				<div className="flex items-center gap-1.5">
					<MoneyInput
						className="w-32"
						aria-label={`${bucket.name} allowance`}
						value={bucket.allowance}
						readOnly={!hydrated || !editable}
						onCommit={(amountCents) =>
							allowance.mutate({ bucketId: bucket.id, month, amountCents })
						}
					/>
					{editable ? (
						<Button
							variant="ghost"
							size="icon"
							type="button"
							disabled={!hydrated}
							aria-label={`Edit ${bucket.name}`}
							aria-expanded={open}
							aria-controls={detailsId}
							onClick={() => setOpen(!open)}
						>
							<Pencil />
						</Button>
					) : null}
				</div>
			}
			below={
				allowance.isError || open ? (
					<div id={detailsId} className="grid gap-3">
						<SaveFailed change={allowance} />
						{open ? (
							<BucketDetails
								month={month}
								bucket={bucket}
								order={order}
								index={index}
								onArchive={onArchive}
							/>
						) : null}
					</div>
				) : undefined
			}
		/>
	);
}

/** Rename, recolour, move, or archive a Bucket. */
function BucketDetails({
	month,
	bucket,
	order,
	index,
	onArchive,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	index: number;
	onArchive: (bucketId: string) => void;
}) {
	const nameId = useId();
	const [confirmArchive, setConfirmArchive] = useState(false);
	// The colour just picked, shown until the cache catches up (or rolls back).
	const [pickedColor, setPickedColor] = useState<number | null>(null);
	const details = usePlanChange(month, {
		save: (data: { bucketId: string; name?: string; color?: number }) => updateBucket({ data }),
		apply: withBucketDetails,
	});
	const reorder = usePlanChange(month, {
		save: (data: { bucketIds: string[] }) => reorderBuckets({ data }),
		apply: withOrder,
	});

	function move(by: -1 | 1) {
		const bucketIds = [...order];
		const [moved] = bucketIds.splice(index, 1);
		if (moved) bucketIds.splice(index + by, 0, moved);
		reorder.mutate({ bucketIds });
	}

	function rename(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
		if (name && name !== bucket.name) details.mutate({ bucketId: bucket.id, name });
	}

	return (
		<div className="grid gap-4 rounded-xl bg-surface-2 p-3">
			<SaveFailed change={details} />
			<SaveFailed change={reorder} />
			<form onSubmit={rename}>
				<Field label="Name" htmlFor={nameId}>
					<div className="flex gap-2">
						<Input
							id={nameId}
							name="name"
							required
							maxLength={40}
							defaultValue={bucket.name}
							className="bg-card"
						/>
						<Button type="submit" variant="outline">
							Rename
						</Button>
					</div>
				</Field>
			</form>
			<fieldset className="grid gap-2">
				<legend className="mb-2 text-sm font-medium">Colour</legend>
				<div className="flex flex-wrap gap-2">
					{bucketColors.map((option) => (
						<label key={option.value} className="relative">
							<input
								type="radio"
								name={`color-${bucket.id}`}
								value={option.value}
								checked={(pickedColor ?? bucket.color) === option.value}
								onChange={() => {
									setPickedColor(option.value);
									details.mutate(
										{ bucketId: bucket.id, color: option.value },
										{ onSettled: () => setPickedColor(null) },
									);
								}}
								className="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-full opacity-0"
							/>
							<span className="sr-only">{option.name}</span>
							<span
								aria-hidden="true"
								className={cn(
									"block size-8 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow duration-(--duration-fast)",
									"peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring",
								)}
								style={{ background: `var(--bucket-${option.value})` }}
							/>
						</label>
					))}
				</div>
			</fieldset>
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
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="ms-auto"
					onClick={() => setConfirmArchive(true)}
				>
					<Archive />
					Archive
				</Button>
			</div>
			{confirmArchive ? (
				<Confirm
					onConfirm={() => onArchive(bucket.id)}
					onCancel={() => setConfirmArchive(false)}
					confirmLabel={`Archive ${bucket.name}`}
				>
					{bucket.name} leaves the Plan from {monthName(month)} on. Earlier months keep it.
				</Confirm>
			) : null}
		</div>
	);
}

function Confirm({
	children,
	confirmLabel,
	onConfirm,
	onCancel,
}: {
	children: ReactNode;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<div role="alertdialog" aria-label={confirmLabel} className="grid gap-3 rounded-xl bg-card p-3">
			<p className="text-sm">{children}</p>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="button" variant="destructive" size="sm" onClick={onConfirm}>
					{confirmLabel}
				</Button>
			</div>
		</div>
	);
}

function AddBucket({ month, buckets }: { month: MonthKey; buckets: PlanBucket[] }) {
	const hydrated = useHydrated();
	// A fresh ID per Bucket; a retry of the same attempt reuses it, so it's added once.
	const [bucketId, setBucketId] = useState(() => ulid());
	const [invalidAmount, setInvalidAmount] = useState(false);
	const add = usePlanChange(month, {
		save: (data: {
			bucketId: string;
			month: MonthKey;
			name: string;
			color: number;
			allowanceCents: number;
		}) => addBucket({ data }),
		apply: withNewBucket,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const values = new FormData(form);
		const name = String(values.get("name") ?? "").trim();
		const allowanceCents = parseDollars(String(values.get("allowance") ?? ""));
		setInvalidAmount(allowanceCents === null);
		if (!name || allowanceCents === null) return;
		add.mutate({
			bucketId,
			month,
			name,
			color: nextBucketColor(buckets.map((b) => b.color)),
			allowanceCents,
		});
		// The Bucket shows at once; the next one gets its own ID.
		setBucketId(ulid());
		form.reset();
	}

	return (
		<Card>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
					<Field label="New Bucket" htmlFor="new-bucket-name">
						<Input
							id="new-bucket-name"
							name="name"
							required
							maxLength={40}
							autoComplete="off"
							placeholder="Gifts"
						/>
					</Field>
					<Field label="Monthly allowance" htmlFor="new-bucket-allowance">
						<Input
							id="new-bucket-allowance"
							name="allowance"
							required
							inputMode="decimal"
							autoComplete="off"
							placeholder="0"
							className="tabular-nums"
							aria-invalid={invalidAmount || undefined}
						/>
					</Field>
				</div>
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
					Add Bucket
				</Button>
			</form>
		</Card>
	);
}
