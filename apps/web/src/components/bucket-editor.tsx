import { type MonthKey, type PlanBucket, type PlanScope, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { ListRow } from "@noodle/ui/components/list";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, bucketColors, monogram, nextBucketColor } from "../buckets";
import { formatMoney, monthName } from "../format";
import {
	usePlanChange,
	withAllowance,
	withBucketDetails,
	withCarriesOver,
	withNewBucket,
	withNewPersonalAllowance,
	withOrder,
} from "../plan-changes";
import { membersQuery } from "../queries";
import {
	addBucket,
	addPersonalAllowance,
	reorderBuckets,
	setAllowance,
	setCarriesOver,
	updateBucket,
} from "../server/plan";
import { Confirm, SaveFailed } from "./plan-editing";
import { PlanHistoryDisclosure } from "./plan-history";
import { ChangedNote, PlanAmountForm } from "./plan-scope-field";

/**
 * A Bucket (or Personal Allowance) in the Plan: its allowance, and an Edit sheet to change it. The
 * rest of the Bucket (name, colour, Rolling, order, archiving) changes on its page, which the name
 * links to. `was` is its allowance the month before, when this month changed it.
 */
export function BucketEditor({
	month,
	bucket,
	editable,
	was,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	editable: boolean;
	was?: number;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const color = asBucketColor(bucket.color);
	const allowance = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; amountCents: number; scope: PlanScope }) =>
			setAllowance({ data }),
		apply: withAllowance,
	});
	return (
		<ListRow
			leading={<Tile bucket={color}>{monogram(bucket.name)}</Tile>}
			title={
				<Link to="/plan/buckets/$id" params={{ id: bucket.id }} className="hover:underline">
					{bucket.name}
				</Link>
			}
			meta={
				<>
					<span>{bucket.rolling ? "Rolling" : "Fresh-start"}</span>
					<ChangedNote was={was} />
				</>
			}
			trailing={
				<div className="flex items-center gap-1">
					<span className="text-sm font-medium tabular-nums">{formatMoney(bucket.allowance)}</span>
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
					) : null}
					<Sheet open={open} onOpenChange={setOpen}>
						{open ? (
							<SheetContent>
								<SheetHeader
									title={bucket.name}
									description={bucket.owner === undefined ? "Bucket" : "Personal Allowance"}
								/>
								<PlanAmountForm
									month={month}
									label="Allowance"
									value={bucket.allowance}
									onSave={(amountCents, scope) => {
										setOpen(false);
										if (amountCents !== bucket.allowance) {
											allowance.mutate({ bucketId: bucket.id, month, amountCents, scope });
										}
									}}
								/>
								<PlanHistoryDisclosure month={month} targetId={bucket.id} />
								<p className="text-[13px] text-muted-foreground">
									Rename it, change its colour, make it Rolling or Fresh-start, move or archive it
									on{" "}
									<Link
										to="/plan/buckets/$id"
										params={{ id: bucket.id }}
										className="font-medium text-foreground underline underline-offset-2"
									>
										its page
									</Link>
									.
								</p>
							</SheetContent>
						) : null}
					</Sheet>
				</div>
			}
			below={allowance.isError ? <SaveFailed change={allowance} /> : undefined}
		/>
	);
}

/**
 * Rename, recolour, set Rolling or Fresh-start from `month` on, move, or archive a Bucket: on its
 * page, in its Edit sheet.
 */
export function BucketDetails({
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
	const [pickedCarriesOver, setPickedCarriesOver] = useState<boolean | null>(null);
	const details = usePlanChange(month, {
		save: (data: { bucketId: string; name?: string; color?: number }) => updateBucket({ data }),
		apply: withBucketDetails,
	});
	const reorder = usePlanChange(month, {
		save: (data: { bucketIds: string[] }) => reorderBuckets({ data }),
		apply: withOrder,
	});
	const carriesOver = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; rolling: boolean }) =>
			setCarriesOver({ data }),
		apply: withCarriesOver,
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
			<SaveFailed change={carriesOver} />
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
			<fieldset className="grid gap-2">
				<legend className="mb-2 text-sm font-medium">At the end of the month</legend>
				{carriesOverOptions.map((option) => (
					<label
						key={option.label}
						className="flex cursor-pointer items-start gap-3 rounded-lg bg-card px-3 py-2.5"
					>
						<input
							type="radio"
							name={`rolling-${bucket.id}`}
							checked={(pickedCarriesOver ?? bucket.rolling) === option.rolling}
							onChange={() => {
								setPickedCarriesOver(option.rolling);
								carriesOver.mutate(
									{ bucketId: bucket.id, month, rolling: option.rolling },
									{ onSettled: () => setPickedCarriesOver(null) },
								);
							}}
							className="mt-0.5 size-4 shrink-0 accent-foreground"
						/>
						<span className="grid gap-0.5">
							<span className="text-sm font-medium">{option.label}</span>
							<span className="text-[13px] text-muted-foreground">{option.description}</span>
						</span>
					</label>
				))}
			</fieldset>
			{/* A Personal Allowance has its own section, and stays in the Plan: its Parent sets it to
			    zero rather than archiving it. */}
			{bucket.owner === undefined ? (
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
			) : null}
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

const carriesOverOptions = [
	{
		rolling: false,
		label: "Fresh-start",
		description: "Starts each month at its allowance.",
	},
	{
		rolling: true,
		label: "Rolling",
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

export function AddBucket({ month, buckets }: { month: MonthKey; buckets: PlanBucket[] }) {
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
