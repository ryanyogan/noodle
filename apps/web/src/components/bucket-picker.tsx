import { type MonthKey, type PlanBucket, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import {
	ChoiceList,
	ChoiceMark,
	ChosenChoice,
	choiceText,
} from "@noodle/ui/components/choice-list";
import { CommandGroup, CommandItem } from "@noodle/ui/components/command";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@noodle/ui/components/popover";
import { type ChoiceGroup, flatChoices, selectTriggerClass } from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { ChevronDown, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { nextBucketColor } from "../buckets";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import {
	BUCKET_NAME_MAX,
	nameProblem,
	nameToCreate,
	suggestedAllowanceCents,
	tidyName,
} from "../new-bucket";
import { usePlanChange, withNewBucket } from "../plan-changes";
import { useMonthState } from "../queries";
import { addBucket } from "../server/plan";
import { AmountInput } from "./goals";

/**
 * Where a Transaction goes, with a search box (#90): the shared Combobox's field and its list
 * (ChoiceList, issue 154: one look and one way of searching for both), plus a last row, "Create
 * Bucket “Vet”", once what's typed is the name of nothing it lists. The row is always last, under
 * any partly matching choices, so Enter on a search still picks the first real match. Picking it
 * only asks (`onCreate`): the Bucket is made in NewBucketStep, where its allowance is set.
 */
export function BucketPicker({
	id,
	className,
	disabled,
	placeholder,
	searchPlaceholder,
	choices,
	onValueChange,
	onCreate,
	value,
	defaultOpen = false,
	onClose,
	foot,
	none,
	loading,
	empty = "Nothing matches.",
	"aria-label": label,
}: {
	/** What is chosen to begin with (a table cell shows what the row is assigned to). */
	value?: string;
	/** Open as soon as it is on the page: a table cell puts it there when it is asked for. */
	defaultOpen?: boolean;
	/** The list has closed, with or without a choice. */
	onClose?: () => void;
	id?: string;
	className?: string;
	disabled?: boolean;
	/** Words, or words that differ by width (Review's narrowest card, issue 74). */
	placeholder: ReactNode;
	searchPlaceholder: string;
	choices: ChoiceGroup[];
	onValueChange: (value: string) => void;
	/** Asked to make a Bucket by this name. Without it there's no Create row. */
	onCreate?: (name: string) => void;
	/** Under the choices: a way to where Buckets are managed (issue 98, from Review). */
	foot?: ReactNode;
	/**
	 * In place of the search and the list (issue 117): the Transaction's month had no Buckets, so
	 * there is nothing to pick or create. It says why.
	 */
	none?: ReactNode;
	/** Said in the list while another month's Plan is on its way, instead of "Nothing matches". */
	loading?: string;
	/** Said when a search finds nothing. A month that is over says why nothing can be created. */
	empty?: string;
	"aria-label": string;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(defaultOpen);
	const [search, setSearch] = useState("");
	const [current, setCurrent] = useState(value ?? "");
	const all = flatChoices(choices);
	const chosen = all.find((c) => c.value === current);
	const create = onCreate && !loading ? nameToCreate(search, all.map(choiceText)) : null;
	const close = () => {
		setOpen(false);
		setSearch("");
		onClose?.();
	};
	return (
		<Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
			<PopoverTrigger
				type="button"
				id={id}
				role="combobox"
				aria-expanded={open}
				aria-label={label}
				disabled={disabled || !hydrated}
				data-size="default"
				data-placeholder={chosen ? undefined : ""}
				className={cn(selectTriggerClass, className)}
			>
				{chosen ? (
					<ChosenChoice choice={chosen} />
				) : (
					<span className="truncate">{placeholder}</span>
				)}
				<ChevronDown aria-hidden="true" className="text-muted-foreground" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				collisionPadding={8}
				// The shared Combobox's panel: as wide as its field, above sheets and alert dialogs.
				className={cn(
					"z-55 w-(--radix-popover-trigger-width) min-w-[max(var(--radix-popover-trigger-width),12rem)] max-w-[calc(100vw-16px)] gap-0 overflow-hidden rounded-xl border p-0 ring-0",
					// A sentence, not a list of names: room to read it in a narrow cell.
					none && "min-w-[max(var(--radix-popover-trigger-width),20rem)]",
				)}
			>
				{none ? (
					<div className="p-3">{none}</div>
				) : (
					<ChoiceList
						choices={choices}
						current={current}
						search={search}
						onSearchChange={setSearch}
						searchPlaceholder={searchPlaceholder}
						empty={empty}
						loading={loading}
						// A short window (1024×768): a shorter list, so the panel opens under its field and
						// not upward over the page's title (issue 73). Phones keep the full list.
						listClassName="sm:[@media(max-height:820px)]:max-h-52"
						onChoose={(next) => {
							setCurrent(next);
							close();
							onValueChange(next);
						}}
						foot={foot}
					>
						{create && onCreate ? (
							<CommandGroup heading="New">
								<CommandItem
									value={`create:${create}`}
									onSelect={() => {
										close();
										onCreate(create);
									}}
								>
									<ChoiceMark>
										<Plus />
									</ChoiceMark>
									<span className="min-w-0 break-words">Create Bucket “{create}”</span>
								</CommandItem>
							</CommandGroup>
						) : null}
					</ChoiceList>
				)}
			</PopoverContent>
		</Popover>
	);
}

type NewBucket = { bucketId: string; name: string; color: number; allowanceCents: number };

/**
 * The one step between "Create Bucket “Vet”" and the Transaction being filed there (#90): the
 * name, what the Bucket gets each month, and what that leaves Free to Spend. It writes the Plan's
 * own "add a Bucket" change (the same one the Plan’s Buckets write), from this month on, and only
 * then hands the Bucket back to be filed in. If the Bucket can't be made, the step stays open and
 * says so, and nothing is filed.
 */
export function NewBucketStep({
	month,
	name: typed,
	what,
	amountCents,
	buckets,
	taken,
	onCancel,
	onCreated,
}: {
	month: MonthKey;
	/** The name typed in the picker. */
	name: string;
	/** The Transaction waiting to be filed, as its card names it. */
	what: string;
	amountCents: number;
	/** The month's Buckets, for the next colour. */
	buckets: PlanBucket[];
	/** Names the Plan already has: its Buckets' and Commitments'. */
	taken: string[];
	onCancel: () => void;
	/** The Bucket is in the Plan: file the Transaction in it. */
	onCreated: (bucket: PlanBucket) => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const { freeToSpend } = useMonthState(month);
	// One ID for every try, so a retry after a failure can't add the Bucket twice.
	const [bucketId] = useState(() => ulid());
	const [name, setName] = useState(typed);
	const suggested = suggestedAllowanceCents(amountCents);
	const [amount, setAmount] = useState(suggested === null ? "" : formatMoneyInput(suggested));
	const [errors, setErrors] = useState<{ name?: string; amount?: boolean }>({});
	const create = usePlanChange(month, {
		save: (bucket: NewBucket) => addBucket({ data: { month, ...bucket } }),
		apply: withNewBucket,
	});
	const cents = parseDollars(amount);
	const spent = Math.abs(amountCents);

	function submit(event: FormEvent) {
		event.preventDefault();
		if (create.isPending) return;
		const next = { name: nameProblem(name, taken) ?? undefined, amount: cents === null };
		setErrors(next);
		if (next.name || cents === null) return;
		const bucket: PlanBucket = {
			id: bucketId,
			name: tidyName(name),
			color: nextBucketColor(buckets.map((b) => b.color)),
			allowance: cents,
			rolling: false,
		};
		create.mutate(
			{
				bucketId: bucket.id,
				name: bucket.name,
				color: bucket.color,
				allowanceCents: bucket.allowance,
			},
			{ onSuccess: () => onCreated(bucket) },
		);
	}

	return (
		// It can't be closed while the Bucket is being made, so what follows is never left half done.
		<Sheet open onOpenChange={(open) => !open && !create.isPending && onCancel()}>
			<SheetContent>
				<SheetHeader
					title="New Bucket"
					description={`${what} (${formatMoney(spent)}) will be filed in it. Its allowance comes out of Free to Spend, from ${monthName(month)} on.`}
				/>
				<form className="grid gap-4" noValidate onSubmit={submit}>
					<Field label="Name" htmlFor={`${id}-name`}>
						<Input
							id={`${id}-name`}
							maxLength={BUCKET_NAME_MAX}
							autoComplete="off"
							value={name}
							aria-invalid={errors.name ? true : undefined}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
					</Field>
					<Field label="Allowance each month" htmlFor={`${id}-amount`}>
						<AmountInput
							id={`${id}-amount`}
							value={amount}
							aria-invalid={errors.amount || undefined}
							aria-describedby={`${id}-left`}
							onChange={(event) => setAmount(event.currentTarget.value)}
						/>
					</Field>
					<p
						id={`${id}-left`}
						className="text-muted-foreground text-sm"
						data-testid="new-bucket-left"
					>
						{cents === null
							? `Free to Spend is ${formatMoney(freeToSpend)} now.`
							: cents === 0
								? `Free to Spend stays ${formatMoney(freeToSpend)}. With no allowance, this Bucket is over by ${formatMoney(spent)} as soon as this is filed.`
								: `Free to Spend goes from ${formatMoney(freeToSpend)} to ${formatMoney(freeToSpend - cents)}.${
										cents < spent
											? ` This Bucket will be over by ${formatMoney(spent - cents)} as soon as this is filed.`
											: ""
									}`}
					</p>
					{suggested !== null ? (
						<p className="text-muted-foreground text-sm">
							{formatMoney(suggested)} is this Transaction rounded up. Change it to what a whole
							month needs.
						</p>
					) : null}
					{errors.name ? <FormError>{errors.name}</FormError> : null}
					{errors.amount ? (
						<FormError>Enter the allowance as a dollar amount, like 250 or 85.50.</FormError>
					) : null}
					{create.isError ? (
						<FormError>
							Couldn’t create the Bucket, so nothing changed and nothing was filed. Try again.
						</FormError>
					) : null}
					<SheetFooter className="max-lg:grid-cols-2">
						<Button type="button" variant="outline" disabled={create.isPending} onClick={onCancel}>
							Cancel
						</Button>
						<Button type="submit" disabled={!hydrated || create.isPending}>
							{create.isPending ? "Creating…" : "Create and file here"}
						</Button>
					</SheetFooter>
				</form>
			</SheetContent>
		</Sheet>
	);
}
