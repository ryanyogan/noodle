import { type MonthKey, type PlanBucket, parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Switch } from "@noodle/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import { nextBucketColor } from "../buckets";
import { formatMoney, formatMoneyInput } from "../format";
import { usePlanChange, withNewBuckets } from "../plan-changes";
import { planDraftQuery, suggestionsQuery, useAllowancesStillToSet } from "../queries";
import { addBuckets } from "../server/plan";
import {
	anotherBucket,
	type BucketRow,
	belongsOn,
	bucketsTotal,
	personalName,
	personalShare,
	sheetStarters,
	withSpending,
} from "../starter-buckets";
import { AmountInput } from "./goals";
import { SaveFailed } from "./plan-editing";
import { TermHelp } from "./term-help";

// The Add Buckets sheet (#57): the get-started wizard's starter list for every month after setup.
// Tick the ones you want, change amounts, and Add all in one save; the Parent's own Personal
// Allowance is offered too. What's left to plan follows every amount as it's typed.

type NewBucket = {
	bucketId: string;
	name: string;
	color: number;
	allowanceCents: number;
	rolling?: boolean;
	suggestionId?: string;
};

type AddBucketsChange = {
	month: MonthKey;
	owner: string;
	buckets: NewBucket[];
	personal?: Omit<NewBucket, "rolling">;
};

export function AddBuckets({
	month,
	buckets,
	freeToSpend,
	parentId,
	parentName,
}: {
	month: MonthKey;
	buckets: PlanBucket[];
	/** What's left to plan before anything here is added. */
	freeToSpend: number;
	parentId: string;
	parentName: string | undefined;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const add = usePlanChange(month, {
		save: ({ owner: _, ...data }: AddBucketsChange) => addBuckets({ data }),
		apply: withNewBuckets,
	});
	return (
		<div className="grid gap-2">
			<Button
				type="button"
				className="justify-self-start"
				disabled={!hydrated}
				onClick={() => setOpen(true)}
			>
				<Plus />
				Add Buckets
			</Button>
			<SaveFailed change={add} />
			<Sheet open={open} onOpenChange={setOpen}>
				{open ? (
					<SheetContent layout="wide">
						<SheetHeader
							title="Add Buckets"
							description="Tick the ones you want and set what each gets a month. You can change them any time."
						/>
						<AddBucketsForm
							buckets={buckets}
							freeToSpend={freeToSpend}
							parentId={parentId}
							parentName={parentName}
							onCancel={() => setOpen(false)}
							onAdd={(change) => {
								add.mutate({ month, owner: parentId, ...change });
								setOpen(false);
							}}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</div>
	);
}

function AddBucketsForm({
	buckets,
	freeToSpend,
	parentId,
	parentName,
	onCancel,
	onAdd,
}: {
	buckets: PlanBucket[];
	freeToSpend: number;
	parentId: string;
	parentName: string | undefined;
	onCancel: () => void;
	onAdd: (change: Pick<AddBucketsChange, "buckets" | "personal">) => void;
}) {
	const stillToSet = useAllowancesStillToSet(parentId);
	const hydrated = useHydrated();
	// The Plan as the sheet opened: what it already has stays hidden.
	const [used] = useState(() => buckets.filter((b) => b.owner === undefined).map((b) => b.name));
	const { data: draft, isPending: drafting } = useQuery(planDraftQuery());
	const [rows, setRows] = useState(() =>
		sheetStarters(used, draft?.buckets, freeToSpend, formatMoneyInput),
	);
	// Buckets background AI suggested from spending (ADR-0027) join the list unticked, with their
	// amount, so adding one is a tick. The Household's only: a Personal Allowance has its own row.
	// They wait for the plan draft, so history ticks its starter first (Restaurants on Dining out)
	// and a suggestion only marks that row, whichever of the two arrives first.
	const { data: suggested } = useQuery(suggestionsQuery());
	useEffect(() => {
		if (drafting) return;
		const ideas = (suggested ?? []).filter((item) => item.kind === "new-bucket" && !item.personal);
		if (ideas.length === 0) return;
		setRows((current) => {
			const usedNames = new Set(used.map((n) => n.toLowerCase()));
			const same = (row: BucketRow, name: string) =>
				!row.personal && row.name.toLowerCase() === name.toLowerCase();
			let rows = current;
			const fresh: BucketRow[] = [];
			for (const item of ideas) {
				const name = item.payload.name;
				if (usedNames.has(name.toLowerCase())) continue;
				// The same name first, else the starter it's a kind of ("Restaurants" is Dining out), so a
				// suggestion never sits beside the starter the plan draft fills from history.
				const row =
					rows.find((r) => same(r, name)) ??
					rows.find((r) => !r.suggestionId && belongsOn(r, name));
				if (row?.suggestionId === item.id) continue;
				if (!row) {
					fresh.push({
						key: `suggested-${item.id}`,
						id: ulid(),
						name,
						amountCents: item.payload.amountCents,
						amount: formatMoneyInput(item.payload.amountCents),
						rolling: false,
						personal: false,
						kept: false,
						touched: false,
						suggested: "spending",
						suggestionId: item.id,
					});
					continue;
				}
				// A starter of the same name (Pets) or kind becomes the suggested row, at the top.
				const marked: BucketRow = row.touched
					? { ...row, suggestionId: item.id }
					: {
							...row,
							amountCents: item.payload.amountCents,
							amount: formatMoneyInput(item.payload.amountCents),
							suggested: "spending",
							suggestionId: item.id,
						};
				rows = rows.filter((r) => r !== row);
				fresh.push(marked);
			}
			return fresh.length > 0 ? [...fresh, ...rows] : current;
		});
	}, [suggested, used, drafting]);
	// History that arrives after the sheet opened fills the rows nobody typed in.
	useEffect(() => {
		if (draft?.buckets.length) {
			setRows((current) => withSpending(current, used, draft.buckets, formatMoneyInput));
		}
	}, [draft, used]);
	const [personal, setPersonal] = useState<BucketRow | null>(() => {
		if (buckets.some((b) => b.owner === parentId)) return null;
		const share = personalShare(freeToSpend);
		return {
			key: "personal",
			id: ulid(),
			name: personalName(parentName),
			amountCents: share,
			amount: share ? formatMoneyInput(share) : "",
			rolling: false,
			personal: true,
			kept: false,
			touched: false,
			suggested: share ? "scaled" : null,
		};
	});
	const [focusKey, setFocusKey] = useState<string | null>(null);
	const [tried, setTried] = useState(false);
	const all = personal ? [...rows, personal] : rows;
	const ticked = all.filter((row) => row.kept);
	const left = freeToSpend - bucketsTotal(all);
	const unnamed = ticked.some((row) => !row.name.trim());
	const unpriced = ticked.some((row) => parseDollars(row.amount) === null);

	const edit = (key: string, change: Partial<BucketRow>) => {
		if (key === personal?.key) setPersonal({ ...personal, ...change, touched: true });
		else
			setRows((current) =>
				current.map((row) => (row.key === key ? { ...row, ...change, touched: true } : row)),
			);
	};

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setTried(true);
		if (ticked.length === 0 || unnamed || unpriced) return;
		// Colours in the fixed order (ADR-0008), each new one counted as taken for the next.
		const colors = buckets.map((b) => b.color);
		const color = () => {
			const next = nextBucketColor(colors);
			colors.push(next);
			return next;
		};
		const cents = (row: BucketRow) => parseDollars(row.amount) ?? 0;
		onAdd({
			buckets: ticked
				.filter((row) => !row.personal)
				.map((row) => ({
					bucketId: row.id,
					name: row.name.trim(),
					color: color(),
					allowanceCents: cents(row),
					rolling: row.rolling,
					// A row background AI suggested: adding it marks that suggestion taken.
					...(row.suggestionId ? { suggestionId: row.suggestionId } : {}),
				})),
			personal:
				personal?.kept === true
					? {
							bucketId: personal.id,
							name: personal.name.trim(),
							color: color(),
							allowanceCents: cents(personal),
						}
					: undefined,
		});
	}

	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-3">
			<p
				aria-live="polite"
				className="sticky top-0 z-10 -mx-1 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted-foreground"
			>
				Left to plan <TermHelp term="free-to-spend" />{" "}
				<span
					className={`font-medium tabular-nums ${left < 0 ? "text-over-foreground" : "text-foreground"}`}
				>
					{formatMoney(left)}
				</span>
				{left < 0 ? " (more than you bring in)" : null}
				{stillToSet.map((name) => (
					<span key={name}> · still to set: {name}’s Personal Allowance</span>
				))}
			</p>
			<p className="text-[13px] text-muted-foreground">
				A Bucket resets monthly unless it carries over <TermHelp term="carries-over" />, keeping
				what’s left for next month. Good for Gifts: save a bit each month for December.
			</p>
			<ul aria-label="Buckets to add" className="grid">
				{rows.map((row) => (
					<SheetRow
						key={row.key}
						row={row}
						custom={row.key.startsWith("own-")}
						focus={row.key === focusKey}
						onEdit={(change) => edit(row.key, change)}
					/>
				))}
			</ul>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="justify-self-start"
				onClick={() => {
					const own = anotherBucket();
					setRows((current) => [...current, own]);
					setFocusKey(own.key);
				}}
			>
				<Plus aria-hidden="true" />
				Add your own
			</Button>
			{personal ? (
				<div className="grid gap-1">
					<h3 className="flex items-center gap-1 text-sm font-semibold">
						Personal Allowance <TermHelp term="personal-allowance" />
					</h3>
					<ul aria-label="Personal Allowance" className="grid">
						<SheetRow
							row={personal}
							custom={false}
							focus={false}
							onEdit={(change) => edit(personal.key, change)}
						/>
					</ul>
					<p className="text-[13px] text-muted-foreground">
						Yours to spend, no questions asked. Only you see what you spend from it; the other
						Parent sees just the total, and sets up their own.
					</p>
				</div>
			) : null}
			{tried && ticked.length === 0 ? (
				<FormError>Tick at least one Bucket to add.</FormError>
			) : null}
			{tried && unnamed ? <FormError>Give each ticked Bucket a name, like Pets.</FormError> : null}
			{tried && unpriced ? (
				<FormError>Enter each ticked Bucket’s amount in dollars, like 250 or 85.50.</FormError>
			) : null}
			<SheetFooter stick className="max-lg:grid-cols-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={!hydrated}>
					{ticked.length === 0
						? "Add Buckets"
						: `Add ${ticked.length} ${ticked.length === 1 ? "Bucket" : "Buckets"}`}
				</Button>
			</SheetFooter>
		</form>
	);
}

/** One row: a tick, the name, its amount, and whether it carries over. */
function SheetRow({
	row,
	custom,
	focus,
	onEdit,
}: {
	row: BucketRow;
	custom: boolean;
	focus: boolean;
	onEdit: (change: Partial<BucketRow>) => void;
}) {
	const id = useId();
	const label = row.name.trim() || "your own Bucket";
	return (
		<li
			className="grid gap-1.5 border-b border-border py-2.5 last:border-b-0"
			data-starter={row.key}
		>
			<div className="flex items-center gap-3">
				<Checkbox
					id={`${id}-tick`}
					checked={row.kept}
					onCheckedChange={(checked) => onEdit({ kept: checked === true })}
					{...(custom ? { "aria-label": `Add ${label}` } : {})}
				/>
				{custom ? (
					<Input
						ref={(el) => {
							if (focus && el && document.activeElement !== el && !el.value) el.focus();
						}}
						aria-label="Name of your own Bucket"
						value={row.name}
						maxLength={40}
						placeholder="Name, like Hockey"
						onChange={(event) => onEdit({ name: event.currentTarget.value, kept: true })}
						className="min-w-0 flex-1"
					/>
				) : (
					<label htmlFor={`${id}-tick`} className="min-w-0 flex-1 truncate text-sm font-medium">
						{row.name}
					</label>
				)}
				<AmountInput
					aria-label={`${label} amount`}
					placeholder="0"
					value={row.amount}
					className="w-28 shrink-0"
					onFocus={(event) => event.currentTarget.select()}
					onChange={(event) => {
						const amount = event.currentTarget.value;
						onEdit({
							amount,
							amountCents: parseDollars(amount) ?? 0,
							suggested: null,
							kept: amount.trim() !== "" || row.kept,
						});
					}}
				/>
			</div>
			{/* Unticked rows stay one line; ticking one shows whether it carries over. */}
			{(row.personal || !row.kept) && row.suggested !== "spending" ? null : (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 ps-9">
					{row.personal || !row.kept ? null : (
						<label htmlFor={`${id}-rolling`} className="flex items-center gap-2 text-[13px]">
							<Switch
								id={`${id}-rolling`}
								checked={row.rolling}
								onCheckedChange={(rolling) => onEdit({ rolling })}
							/>
							Carries over
						</label>
					)}
					{row.suggested === "spending" ? (
						<Badge variant="brand">Suggested from your spending</Badge>
					) : null}
				</div>
			)}
		</li>
	);
}
