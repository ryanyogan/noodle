import {
	addDays,
	byDoNow,
	byPerkValue,
	type DayKey,
	earnRate,
	PERK_RENEWALS,
	type PerkRenewal,
	type PerkStanding,
	perkCategoryLabel,
	perkDoNow,
	perkRenewalLabel,
	perkSourceKindLabel,
	perkStanding,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { SectionGrid } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
import { MetaParts } from "@noodle/ui/components/meta-parts";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import { Spinner } from "@noodle/ui/components/spinner";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import {
	Check,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Gift,
	Lock,
	Plus,
	RefreshCw,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { AddPerkSourceSheet, WhichCardSheet } from "../../../components/perk-source-picker";
import { Confirm } from "../../../components/plan-editing";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { shortDay, shortDayAt } from "../../../format";
import {
	newPerkUseId,
	type PerkSourceItem,
	researchStatus,
	useDecidePerkSource,
	useMarkPerkUsed,
	useRemovePerkUse,
	useSetAnnualFee,
	useSetPerkValue,
	useUpdatePerkSource,
} from "../../../perks";
import { groupPerks, sourceHeadline, sourceState, sourceStateLabel } from "../../../perks-view";
import { perkSourcesQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/insights/perks")({
	loader: ({ context }) => context.queryClient.ensureQueryData(perkSourcesQuery()),
	pendingComponent: SectionPending,
	component: PerksPage,
});

type PerkItem = PerkSourceItem["perks"][number];
type PerkEntry = {
	perk: PerkItem;
	source: PerkSourceItem;
	standing: PerkStanding;
	valueCents: number | null;
};

const usd = (cents: number) => {
	const whole = cents % 100 === 0;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: whole ? 0 : 2,
		maximumFractionDigits: whole ? 0 : 2,
	}).format(cents / 100);
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Something to do now: never what a card earns more on, which isn't used up or reset. */
const toDoNow = (entry: PerkEntry) =>
	entry.perk.kind !== "earn" && perkDoNow(entry.standing, entry.perk.renews);

/** A card shows its most valuable perks; the rest fold under "Show all N perks". */
const PERKS_SHOWN = 5;

/** A list opens on its first few rows; the rest are behind "Show all". */
const FEW = 3;

/**
 * Perks & Benefits: what the Household's cards (and phone plans and memberships) include, read
 * from each one's own benefits page. The page opens short (issue 101): one button to add a card or
 * membership, this year's sums, the few perks worth using now, the ones Noodle spotted to
 * confirm, then one row per Perk Source. A row opens that Perk Source alone: its perks (value, how
 * often each renews, whether it was used), what's worth using, and what a Parent can do with it.
 */
function PerksPage() {
	const sources = useSuspenseQuery(perkSourcesQuery()).data;
	const hydrated = useHydrated();
	const [adding, setAdding] = useState(false);
	const [allSuggested, setAllSuggested] = useState(false);
	// Which Perk Source is open: one at a time. Untouched, a lone one is open, as there's no list.
	const [picked, setPicked] = useState<string | null | undefined>(undefined);
	const suggested = sources.filter((s) => s.status === "suggested");
	const confirmed = sources.filter((s) => s.status === "confirmed");
	const asOf = sources[0]?.asOf ?? (new Date().toISOString().slice(0, 10) as DayKey);
	const cards = confirmed.map((source) => ({
		source,
		entries: source.perks.map(
			(perk): PerkEntry => ({
				perk,
				source,
				standing: perkStanding(perk, asOf),
				valueCents: perk.valueCents,
			}),
		),
	}));
	const doNow = cards
		.flatMap((card) => card.entries)
		.filter(toDoNow)
		.sort(byDoNow);
	const lone = confirmed.length === 1 ? (confirmed[0]?.id ?? null) : null;
	const openId = picked === undefined ? lone : picked;
	/** From "Worth using now": opens the perk's Perk Source and goes to its row. */
	const goTo = (id: string) => {
		setPicked(id);
		requestAnimationFrame(() => document.getElementById(`perk-source-${id}-row`)?.focus());
	};
	return (
		<div className="grid gap-(--layout-gap)">
			<div className="flex justify-end">
				<Button className="max-lg:w-full" disabled={!hydrated} onClick={() => setAdding(true)}>
					<Plus />
					Add a card or membership
				</Button>
			</div>
			<AddPerkSourceSheet open={adding} onOpenChange={setAdding} />
			{sources.length === 0 ? (
				<Card className="p-0">
					<EmptyState
						icon={<Gift />}
						title="No Perk Sources yet"
						description="Credit cards, phone plans and memberships often include services or pay for costs. Noodle suggests the ones it spots in your spending each night, or add one with the button above."
					/>
				</Card>
			) : null}
			{/* Summary first, with what's worth using now beside it on a wide screen. */}
			{cards.some((card) => card.entries.length > 0) || doNow.length > 0 ? (
				<SectionGrid className="xl:items-stretch">
					{cards.some((card) => card.entries.length > 0) ? (
						<YearSummary cards={cards} year={asOf.slice(0, 4)} />
					) : null}
					{doNow.length > 0 ? <WorthNow entries={doNow} onOpen={goTo} /> : null}
				</SectionGrid>
			) : null}
			{suggested.length > 0 ? (
				<SectionGrid>
					<Section aria-labelledby="perks-to-confirm">
						<SectionHeader id="perks-to-confirm" title="To confirm" count={suggested.length} />
						{/* The rows measure this list: in a half-width card (1280) the choices go under the text. */}
						<List className="@container/confirm">
							{(allSuggested ? suggested : suggested.slice(0, FEW)).map((source) => (
								<Suggestion key={source.id} source={source} />
							))}
						</List>
						{suggested.length > FEW ? (
							<div>
								<Button
									variant="ghost"
									size="sm"
									aria-expanded={allSuggested}
									onClick={() => setAllSuggested(!allSuggested)}
								>
									{allSuggested ? "Show fewer" : `Show all ${suggested.length} to confirm`}
								</Button>
							</div>
						) : null}
					</Section>
				</SectionGrid>
			) : null}
			{confirmed.length > 0 ? (
				<Section aria-labelledby="perk-sources">
					<SectionHeader
						id="perk-sources"
						title="Perk Sources"
						count={confirmed.length}
						help={<TermHelp term="perk-source" />}
					/>
					<Card className="min-w-0 p-0 [&>article+article]:border-t">
						{cards.map(({ source, entries }) => (
							<PerkSourceRow
								key={source.id}
								source={source}
								entries={entries}
								open={openId === source.id}
								onToggle={() => setPicked(openId === source.id ? null : source.id)}
							/>
						))}
					</Card>
				</Section>
			) : null}
		</div>
	);
}

type CardSums = {
	used: number;
	available: number;
	fee: number | null;
	perks: number;
	toUse: number;
};
const sumsOf = (source: PerkSourceItem, entries: PerkEntry[]): CardSums => ({
	used: sum(entries.map((e) => e.standing.usedThisYearCents)),
	available: sum(entries.map((e) => e.standing.yearlyValueCents ?? 0)),
	fee: source.annualFeeCents,
	perks: entries.length,
	toUse: entries.filter(toDoNow).length,
});

function Meter({ used, available, label }: { used: number; available: number; label: string }) {
	return (
		<BudgetBar
			value={used}
			max={available}
			label={label}
			valueText={`${usd(used)} used of ${usd(available)}`}
		/>
	);
}

/** This year: value used against value available, and what the perks returned against the fees. */
function YearSummary({
	cards,
	year,
}: {
	cards: { source: PerkSourceItem; entries: PerkEntry[] }[];
	year: string;
}) {
	const rows = cards
		.filter((card) => card.entries.length > 0)
		.map((card) => ({ source: card.source, ...sumsOf(card.source, card.entries) }));
	const used = sum(rows.map((r) => r.used));
	const available = sum(rows.map((r) => r.available));
	const fees = sum(rows.map((r) => r.fee ?? 0));
	return (
		<Section aria-labelledby="perks-this-year" className="grid-rows-[auto_1fr]">
			<SectionHeader id="perks-this-year" title={`This year (${year})`} />
			<Card>
				<div className="grid h-full content-start gap-5 p-(--card-pad)">
					<dl className="grid gap-4 sm:grid-cols-3">
						<div className="grid gap-1">
							<dt className="text-[13px] text-muted-foreground">Value used</dt>
							{/* The meter is part of the value: a list of terms holds only terms and values. */}
							<dd className="grid gap-1">
								<span className="text-2xl font-semibold tabular-nums">
									{usd(used)}
									<span className="text-sm font-normal text-muted-foreground">
										{" "}
										of {usd(available)}
									</span>
								</span>
								<Meter used={used} available={available} label="Value used this year" />
							</dd>
						</div>
						<div className="grid content-start gap-1">
							<dt className="text-[13px] text-muted-foreground">Annual fees</dt>
							<dd className="text-2xl font-semibold tabular-nums">{usd(fees)}</dd>
						</div>
						<div className="grid content-start gap-1">
							<dt className="text-[13px] text-muted-foreground">Perks against fees</dt>
							<dd className="text-2xl font-semibold tabular-nums">
								{used >= fees ? "Ahead " : "Behind "}
								{usd(Math.abs(used - fees))}
							</dd>
						</div>
					</dl>
				</div>
			</Card>
		</Section>
	);
}

/**
 * What to do with a perk, in plain words from its name and kind: "Book a hotel stay with Amex
 * Platinum", "Pay for Global Entry with …", "Spend Uber Cash".
 */
function actionFor({ perk, source }: PerkEntry): string {
	const what = `${perk.name} ${perk.matches}`.toLowerCase();
	const card = source.name;
	if (/\bcash\b/.test(what)) return `Spend ${perk.name}`;
	if (perk.kind === "service") return `Turn on ${perk.name} with ${card}`;
	if (/hotel|resort|\bstay/.test(what)) return `Book a hotel stay with ${card}`;
	if (/airline|flight|baggage/.test(what)) return `Pay an airline fee with ${card}`;
	if (/doordash/.test(what)) return `Order on DoorDash with ${card}`;
	if (/dining|restaurant/.test(what)) return `Eat out with ${card}`;
	if (/travel/.test(what)) return `Pay for travel with ${card}`;
	const thing = perk.name.replace(/\s+(statement credit|credit|fee credit)$/i, "");
	return `Pay for ${thing} with ${card}`;
}

/** The one step that gets the most out of a perk now. */
function stepFor(entry: PerkEntry): string {
	const resets = entry.standing.period?.resets;
	const action = actionFor(entry);
	if (resets) return `${action} by ${shortDay(addDays(resets, -1))}, then mark it used.`;
	return entry.perk.kind === "cost" ? `${action}; the credit comes back.` : `${action}.`;
}

/**
 * The perks most worth using now (about to reset unused, or never used), the few most urgent
 * first; each line opens its Perk Source, where it can be marked used.
 */
function WorthNow({ entries, onOpen }: { entries: PerkEntry[]; onOpen: (id: string) => void }) {
	const [all, setAll] = useState(false);
	const shown = all ? entries : entries.slice(0, FEW);
	return (
		<Section aria-labelledby="perks-worth-now" className="grid-rows-[auto_1fr]">
			<SectionHeader id="perks-worth-now" title="Worth using now" count={entries.length} />
			<Card className="flex flex-col p-0">
				<ul aria-label="Worth using now" className="flex-1 [&>li+li]:border-t">
					{shown.map((entry) => (
						<li key={entry.perk.id} aria-label={entry.perk.name}>
							<RowButton
								className="rounded-none px-(--card-pad) py-3 focus-visible:-outline-offset-2"
								onClick={() => onOpen(entry.source.id)}
							>
								<span className="grid min-w-0 flex-1 gap-0.5">
									<span className="flex items-baseline justify-between gap-3">
										<span className="min-w-0 break-words font-medium">{entry.perk.name}</span>
										{entry.perk.valueCents !== null ? (
											<span className="shrink-0 font-semibold tabular-nums">
												{usd(entry.perk.valueCents)}
											</span>
										) : null}
									</span>
									<span className="min-w-0 break-words text-[13px] text-muted-foreground">
										{entry.source.name} · {stepFor(entry)}
									</span>
								</span>
								<ChevronRight
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground"
								/>
							</RowButton>
						</li>
					))}
				</ul>
				{entries.length > FEW ? (
					<div className="border-t px-(--card-pad) py-1.5">
						<Button variant="ghost" size="sm" aria-expanded={all} onClick={() => setAll(!all)}>
							{all ? "Show fewer" : `Show all ${entries.length}`}
						</Button>
					</div>
				) : null}
			</Card>
		</Section>
	);
}

const periodWord: Record<string, string> = {
	monthly: "this month",
	quarterly: "these 3 months",
	yearly: "this year",
	"every-4-years": "in the last 4 years",
};

/** Whether it was used this period, and when it resets. */
function usedLine({ perk, standing }: PerkEntry): string {
	const use = standing.usedThisPeriod ?? (perk.renews === "per-trip" ? standing.lastUsed : null);
	if (use) {
		const how = use.how === "spending" ? " (a matching charge)" : "";
		const note = use.note ? ` · “${use.note}”` : "";
		return `${perk.renews === "per-trip" ? "Last used" : "Used"} ${shortDay(use.on)}${how}${note}`;
	}
	if (perk.renews === "per-trip") return "Not used yet";
	if (!perk.renews) return standing.lastUsed ? `Last used ${shortDay(standing.lastUsed.on)}` : "";
	const resets = standing.period?.resets;
	const left =
		resets && standing.daysLeft !== null
			? ` · resets ${shortDay(resets)}, ${standing.daysLeft} ${standing.daysLeft === 1 ? "day" : "days"} left`
			: "";
	return `Not used ${periodWord[perk.renews] ?? ""}${left}`;
}

const kindWords = (perk: PerkItem) =>
	perk.kind === "earn"
		? "Earns more here"
		: perk.kind === "service"
			? "A service it includes"
			: "A cost it pays for";

/**
 * One perk: its name with its value at the right, how often it renews, and whether it was used.
 * The page's own words for it and the link to them are behind "Where this comes from".
 */
function PerkRow({ entry }: { entry: PerkEntry }) {
	const { perk, standing } = entry;
	const mark = useMarkPerkUsed();
	const remove = useRemovePerkUse();
	const hydrated = useHydrated();
	const noteId = useId();
	const fromId = useId();
	const [marking, setMarking] = useState(false);
	const [from, setFrom] = useState(false);
	const used = standing.usedThisPeriod;
	const earns = perk.kind === "earn";
	const rate = earns ? earnRate(perk.quote) : null;
	const line = earns ? "" : usedLine(entry);
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const note = String(new FormData(event.currentTarget).get("note") ?? "").trim() || null;
		mark.mutate({ id: newPerkUseId(), perkId: perk.id, name: perk.name, note });
		setMarking(false);
	};
	return (
		<li aria-label={perk.name} className="grid gap-1.5 py-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="min-w-0 break-words font-medium">{perk.name}</span>
				{perk.valueCents !== null ? (
					<span className="shrink-0 font-semibold tabular-nums">{usd(perk.valueCents)}</span>
				) : rate ? (
					<span className="shrink-0 font-semibold tabular-nums">{rate}</span>
				) : null}
			</div>
			<MetaParts
				className="text-[13px] text-muted-foreground"
				parts={[perk.renews ? perkRenewalLabel[perk.renews] : null, earns ? kindWords(perk) : null]}
			/>
			{line ? (
				<p className="flex items-center gap-1.5 text-sm">
					{used ? <Check aria-hidden="true" className="size-4 shrink-0 text-brand" /> : null}
					<span className="min-w-0 break-words">{line}</span>
				</p>
			) : null}
			{marking ? (
				<form onSubmit={save} className="grid gap-2 rounded-xl bg-surface-2 p-3">
					<p className="text-sm text-muted-foreground">{stepFor(entry)}</p>
					<Field label="Note (optional)" htmlFor={noteId}>
						<Input
							id={noteId}
							name="note"
							maxLength={120}
							placeholder="e.g. Rides to the airport"
							className="bg-card"
						/>
					</Field>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" size="sm" disabled={!hydrated || mark.isPending}>
							<Check />
							Save
						</Button>
						<Button type="button" variant="ghost" size="sm" onClick={() => setMarking(false)}>
							Cancel
						</Button>
					</div>
				</form>
			) : (
				<div className="-ms-2.5 flex flex-wrap gap-x-1 gap-y-2">
					{earns || used ? null : (
						<Button
							variant="outline"
							size="sm"
							className="ms-2.5"
							aria-label={`Mark ${perk.name} used`}
							disabled={!hydrated}
							onClick={() => setMarking(true)}
						>
							Mark used
						</Button>
					)}
					{used?.how === "by-hand" && used.id ? (
						<Button
							variant="ghost"
							size="sm"
							aria-label={`Undo ${perk.name} used`}
							disabled={!hydrated || remove.isPending}
							onClick={() => remove.mutate({ id: used.id as string })}
						>
							Undo
						</Button>
					) : null}
					{!earns && (perk.valueCents === null || perk.renews === null) ? (
						<PerkValue perk={perk} />
					) : null}
					<Button
						variant="ghost"
						size="sm"
						aria-expanded={from}
						aria-controls={fromId}
						aria-label={`Where ${perk.name} comes from`}
						disabled={!hydrated}
						onClick={() => setFrom(!from)}
					>
						Where this comes from
					</Button>
				</div>
			)}
			{from ? (
				<div id={fromId} className="grid gap-1.5 rounded-xl bg-surface-2 p-3 text-[13px]">
					{perk.quote.trim() ? <p className="min-w-0 break-words">“{perk.quote.trim()}”</p> : null}
					<MetaParts
						className="text-muted-foreground"
						parts={[
							kindWords(perk),
							<a
								key="source"
								href={perk.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground max-lg:min-h-11"
							>
								Source
								<ExternalLink aria-hidden="true" className="size-3" />
							</a>,
							`Checked ${shortDayAt(perk.checkedAt)}`,
						]}
					/>
				</div>
			) : null}
		</li>
	);
}

/**
 * A perk's value and how often it renews, typed by a Parent when its page states none (DashPass).
 * The button opens a small form in the row.
 */
function PerkValue({ perk }: { perk: PerkItem }) {
	const set = useSetPerkValue();
	const hydrated = useHydrated();
	const id = useId();
	const [open, setOpen] = useState(false);
	const [renews, setRenews] = useState<PerkRenewal>(perk.renews ?? "monthly");
	if (!open) {
		return (
			<Button
				variant="ghost"
				size="sm"
				aria-label={`Add the value of ${perk.name}`}
				disabled={!hydrated}
				onClick={() => setOpen(true)}
			>
				Add its value
			</Button>
		);
	}
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = String(new FormData(event.currentTarget).get("value") ?? "").replace(
			/[$,\s]/g,
			"",
		);
		const dollars = text === "" ? null : Number(text);
		if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) return;
		set.mutate({
			id: perk.id,
			name: perk.name,
			valueCents: dollars === null ? null : Math.round(dollars * 100),
			renews,
		});
		setOpen(false);
	};
	return (
		<form onSubmit={save} className="grid w-full gap-2 rounded-xl bg-surface-2 p-3">
			<div className="grid gap-2 sm:grid-cols-2">
				<Field label="Value" htmlFor={`${id}-value`}>
					<Input
						id={`${id}-value`}
						name="value"
						inputMode="decimal"
						maxLength={10}
						placeholder="$0"
						defaultValue={perk.valueCents !== null ? String(perk.valueCents / 100) : ""}
						className="bg-card"
					/>
				</Field>
				<Field label="How often it renews" htmlFor={`${id}-renews`}>
					<OptionSelect
						id={`${id}-renews`}
						value={renews}
						onValueChange={(value) => setRenews(value as PerkRenewal)}
						choices={PERK_RENEWALS.map((r) => ({ value: r, label: perkRenewalLabel[r] }))}
					/>
				</Field>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button type="submit" size="sm" disabled={!hydrated || set.isPending}>
					<Check />
					Save
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
					Cancel
				</Button>
			</div>
		</form>
	);
}

const kindAndPlan = (source: PerkSourceItem) =>
	[perkSourceKindLabel[source.kind], source.plan].filter(Boolean).join(" · ");

function PrivateBadge({ source }: { source: PerkSourceItem }) {
	return source.private ? (
		<Badge>
			<Lock />
			Only you see this
		</Badge>
	) : null;
}

/**
 * Where focus goes once a suggestion is decided and its row is gone: the next suggestion, else
 * the Perk Sources heading (or the one above the list), never the page's body.
 */
function focusAfter(next: HTMLElement | null) {
	const target =
		next?.querySelector<HTMLElement>("button:not([disabled])") ??
		document.getElementById("perk-sources") ??
		document.getElementById("perks-to-confirm");
	if (!target) return;
	if (!target.matches("button, a, input")) target.tabIndex = -1;
	target.focus();
}

function Suggestion({ source }: { source: PerkSourceItem }) {
	const decide = useDecidePerkSource();
	const hydrated = useHydrated();
	const busy = !hydrated || decide.isPending;
	const decideAndMoveOn = (status: "confirmed" | "dismissed", button: HTMLElement) => {
		const row = button.closest("li");
		const next = (row?.nextElementSibling ?? row?.previousElementSibling) as HTMLElement | null;
		decide
			.mutateAsync({ source, status })
			// Once the list has refetched without this row (a few frames, at most a second).
			.then(() => {
				let frames = 60;
				const settle = () => {
					if (row?.isConnected && frames-- > 0) requestAnimationFrame(settle);
					else focusAfter(next?.isConnected ? next : null);
				};
				settle();
			})
			.catch(() => {});
	};
	// Both choices, beside the text from a tablet up and under it on a phone (issue 110): beside it at
	// 320 px they cut "Membership" short and broke the line under it over four lines.
	const choices = (
		<>
			<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				onClick={(event) => decideAndMoveOn("dismissed", event.currentTarget)}
			>
				Not ours
			</Button>
			<Button
				size="sm"
				disabled={busy}
				onClick={(event) => decideAndMoveOn("confirmed", event.currentTarget)}
			>
				<Check />
				Confirm
			</Button>
		</>
	);
	return (
		<ListRow
			aria-label={source.name}
			title={source.name}
			badge={<PrivateBadge source={source} />}
			meta={
				<MetaParts
					parts={[
						perkSourceKindLabel[source.kind],
						source.seenIn ? (
							<span key="seen" className="break-words">
								Seen in “{source.seenIn}”
							</span>
						) : null,
					]}
				/>
			}
			// From a tablet up too, where the list is under 32rem wide (half the page at 1280): beside the
			// text there, "Seen in …" took a line of its own in one row and not in the next (issue 73).
			trailing={
				<div className="flex items-center gap-2 max-sm:hidden @max-lg/confirm:hidden">
					{choices}
				</div>
			}
			below={<div className="flex justify-end gap-2 sm:@lg/confirm:hidden">{choices}</div>}
		/>
	);
}

/**
 * One Perk Source: a short row (its name and last digits, one line on where it stands, what its
 * perks are worth in a year) that opens its details below it, one Perk Source at a time.
 */
function PerkSourceRow({
	source,
	entries,
	open,
	onToggle,
}: {
	source: PerkSourceItem;
	entries: PerkEntry[];
	open: boolean;
	onToggle: () => void;
}) {
	const hydrated = useHydrated();
	const titleId = `perk-source-${source.id}`;
	const sums = sumsOf(source, entries);
	// The most valuable first: by what each is worth in a year, then credits before the rest.
	const ordered = byPerkValue(
		entries.map((entry) => ({ ...entry.perk, entry })),
		(perk) => perk.entry.standing.yearlyValueCents ?? perk.valueCents,
	).map((perk) => perk.entry);
	const state = sourceState(source);
	const stateLabel = state ? sourceStateLabel[state] : null;
	return (
		<article aria-labelledby={titleId} className="min-w-0">
			<h3 className="text-[15px] leading-snug">
				<RowButton
					id={`${titleId}-row`}
					aria-expanded={open}
					aria-controls={`${titleId}-details`}
					disabled={!hydrated}
					className="rounded-none px-(--card-pad) py-3.5 focus-visible:-outline-offset-2"
					onClick={onToggle}
				>
					<span className="grid min-w-0 flex-1 gap-1">
						<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
							<span id={titleId} className="min-w-0 break-words font-semibold">
								{source.name}
								{source.card?.mask ? (
									<span className="font-normal text-muted-foreground"> ••{source.card.mask}</span>
								) : null}
							</span>
							{stateLabel ? (
								<Badge variant={state === "unreadable" ? "over" : "pace"}>{stateLabel}</Badge>
							) : null}
							<PrivateBadge source={source} />
						</span>
						<span className="flex min-w-0 items-center gap-1.5 text-[13px] font-normal text-muted-foreground">
							{state === "reading" ? <Spinner /> : null}
							<span className="min-w-0 break-words">
								{sourceHeadline(source, {
									names: ordered.map((entry) => entry.perk.name),
									toUse: sums.toUse,
								})}
							</span>
						</span>
					</span>
					{sums.available > 0 ? (
						<span className="grid shrink-0 text-end">
							<span className="font-semibold tabular-nums">{usd(sums.available)}</span>
							<span className="text-xs font-normal text-muted-foreground">a year</span>
						</span>
					) : null}
					<ChevronDown
						aria-hidden="true"
						className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
					/>
				</RowButton>
			</h3>
			{open ? (
				<PerkSourceDetails
					id={`${titleId}-details`}
					source={source}
					ordered={ordered}
					sums={sums}
				/>
			) : null}
		</article>
	);
}

/** What a Perk Source's row opens: where it stands, what's worth using, its perks, what to do. */
function PerkSourceDetails({
	id,
	source,
	ordered,
	sums,
}: {
	id: string;
	source: PerkSourceItem;
	ordered: PerkEntry[];
	sums: CardSums;
}) {
	const decide = useDecidePerkSource();
	const update = useUpdatePerkSource();
	const hydrated = useHydrated();
	const [removing, setRemoving] = useState(false);
	const [naming, setNaming] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const status = researchStatus(source);
	const busy = !hydrated || update.isPending || decide.isPending;
	const shown = showAll ? ordered : ordered.slice(0, PERKS_SHOWN);
	const groups = groupPerks(shown.map((entry) => ({ ...entry.perk, entry })));
	const card = source.card;
	const asking = card?.needsProduct === true;
	const about = [
		kindAndPlan(source),
		card && card.accountName.trim() !== source.name ? `Account “${card.accountName.trim()}”` : null,
		source.checkedAt && source.research === "done"
			? `Checked ${shortDayAt(source.checkedAt)}`
			: null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<div
			id={id}
			className="grid gap-x-(--layout-gap) gap-y-4 border-t px-(--card-pad) py-4 lg:grid-cols-2"
		>
			<div className="grid min-w-0 content-start gap-3">
				<p className="break-words text-[13px] text-muted-foreground">{about}</p>
				{sums.available > 0 ? (
					<div className="grid gap-1.5">
						<p className="text-sm tabular-nums">
							{usd(sums.used)} of {usd(sums.available)} used this year
							{sums.fee !== null ? ` · annual fee ${usd(sums.fee)}` : ""}
						</p>
						<Meter
							used={sums.used}
							available={sums.available}
							label={`${source.name} used this year`}
						/>
					</div>
				) : null}
				{asking && card ? (
					<div className="grid gap-2 rounded-xl bg-surface-2 p-3">
						<p className="break-words text-sm">
							The bank calls this card “{card.accountName.trim()}” and doesn’t say which card it is,
							so Noodle can’t look up its perks yet.
						</p>
						<div>
							<Button disabled={busy} onClick={() => setNaming(true)}>
								Say which card it is
							</Button>
						</div>
					</div>
				) : null}
				{status && !asking ? (
					<p role="status" className="text-sm">
						{status}
					</p>
				) : null}
				{source.research === "needs-plan" && source.planOptions.length > 0 ? (
					<PlanPicker source={source} disabled={busy} />
				) : null}
				{!asking && (source.research === "needs-link" || source.research === "unreadable") ? (
					<PageLink source={source} disabled={busy} />
				) : null}
				{source.worth.length > 0 ? (
					<div className="grid gap-2">
						<h4 id={`${id}-worth`} className="text-[13px] font-semibold">
							Worth using
						</h4>
						<ul aria-labelledby={`${id}-worth`} className="grid gap-2.5">
							{source.worth.map((line) => (
								<li key={line.key} className="grid gap-0.5 text-sm">
									<span className="min-w-0 break-words">{line.text}</span>
									{line.evidence.length > 0 ? (
										<span className="min-w-0 break-words text-[13px] text-muted-foreground">
											{line.evidence
												.map((e) => `${shortDay(e.date)} ${e.note} ${usd(e.amountCents)}`)
												.join(" · ")}
										</span>
									) : null}
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
			{ordered.length > 0 ? (
				<div className="grid min-w-0 content-start gap-1">
					{groups.map((group) => (
						<div key={group.category ?? "all"} className="grid gap-0.5">
							<h4 className="text-[13px] font-semibold">
								{group.category ? perkCategoryLabel[group.category] : "Perks"}
							</h4>
							<ul
								aria-label={`${source.name} ${group.category ? perkCategoryLabel[group.category] : "Perks"}`}
								className="[&>li+li]:border-t"
							>
								{group.perks.map((perk) => (
									<PerkRow key={perk.id} entry={perk.entry} />
								))}
							</ul>
						</div>
					))}
					{ordered.length > PERKS_SHOWN ? (
						<div className="-ms-2.5 border-t pt-1.5">
							<Button
								variant="ghost"
								size="sm"
								aria-expanded={showAll}
								onClick={() => setShowAll(!showAll)}
							>
								{showAll ? "Show fewer" : `Show all ${ordered.length} perks`}
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			<div className="grid min-w-0 gap-3 border-t pt-3 lg:col-span-2">
				{source.kind === "credit-card" ? (
					<div className="max-w-sm">
						<AnnualFee source={source} disabled={busy} />
					</div>
				) : null}
				{/* Under 360px the four wrapped to three ragged lines: two even columns there. */}
				<div className="flex flex-wrap items-center gap-2 max-[359px]:grid max-[359px]:grid-cols-2 max-[359px]:justify-items-stretch">
					{asking ? null : (
						<Button
							variant="outline"
							size="sm"
							className="max-[359px]:px-2"
							disabled={busy || source.research === "researching"}
							onClick={() => update.mutate({ id: source.id })}
						>
							{update.isPending ? <Spinner /> : <RefreshCw />}
							Check again
						</Button>
					)}
					{card && !asking ? (
						<Button
							variant="ghost"
							size="sm"
							className="max-[359px]:px-2"
							disabled={busy}
							onClick={() => setNaming(true)}
						>
							Change which card
						</Button>
					) : null}
					{source.pageUrl ? (
						<a
							href={source.pageUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline max-lg:min-h-11 max-[359px]:justify-center"
						>
							Benefits page
							<ExternalLink aria-hidden="true" className="size-3" />
						</a>
					) : null}
					<Button
						variant="ghost"
						size="sm"
						className="ms-auto max-[359px]:ms-0 max-[359px]:px-2"
						disabled={busy}
						onClick={() => setRemoving(true)}
					>
						Remove
					</Button>
				</div>
				{removing ? (
					<Confirm
						confirmLabel={`Remove ${source.name}`}
						onCancel={() => setRemoving(false)}
						onConfirm={() => {
							setRemoving(false);
							decide.mutate({ source, status: "dismissed" });
						}}
					>
						Its Perks, and the Insights resting on them, go too. Noodle won’t suggest it again.
					</Confirm>
				) : null}
			</div>
			{card ? <WhichCardSheet source={source} open={naming} onOpenChange={setNaming} /> : null}
		</div>
	);
}

/** A card's annual fee, as a Parent types it: weighed against what its perks returned. */
function AnnualFee({ source, disabled }: { source: PerkSourceItem; disabled: boolean }) {
	const setFee = useSetAnnualFee();
	const id = useId();
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const text = String(new FormData(event.currentTarget).get("fee") ?? "").replace(/[$,\s]/g, "");
		const dollars = text === "" ? null : Number(text);
		if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) return;
		setFee.mutate({
			id: source.id,
			annualFeeCents: dollars === null ? null : Math.round(dollars * 100),
		});
	};
	return (
		<form onSubmit={save}>
			<Field label="Annual fee" htmlFor={id}>
				<div className="flex gap-2">
					<Input
						id={id}
						name="fee"
						inputMode="decimal"
						maxLength={10}
						placeholder="$0"
						defaultValue={source.annualFeeCents !== null ? String(source.annualFeeCents / 100) : ""}
						className="min-w-0 flex-1"
					/>
					<Button type="submit" variant="outline" disabled={disabled || setFee.isPending}>
						Save fee
					</Button>
				</div>
			</Field>
		</form>
	);
}

/** Which plan tier the Perk Source is: its Perks depend on it. */
function PlanPicker({ source, disabled }: { source: PerkSourceItem; disabled: boolean }) {
	const update = useUpdatePerkSource();
	const id = useId();
	const [plan, setPlan] = useState(source.plan ?? "");
	const save = (event: FormEvent) => {
		event.preventDefault();
		if (plan) update.mutate({ id: source.id, plan });
	};
	return (
		<form onSubmit={save} className="grid gap-2 rounded-xl bg-surface-2 p-3">
			<Field label="Plan" htmlFor={id}>
				<div className="flex gap-2">
					<OptionSelect
						id={id}
						className="flex-1"
						value={plan}
						onValueChange={setPlan}
						placeholder="Choose a plan"
						choices={source.planOptions.map((option) => ({ value: option, label: option }))}
					/>
					<Button type="submit" variant="outline" disabled={disabled || !plan}>
						Save
					</Button>
				</div>
			</Field>
		</form>
	);
}

/** A link to the Perk Source's benefits page, when there's none or it couldn't be read. */
function PageLink({ source, disabled }: { source: PerkSourceItem; disabled: boolean }) {
	const update = useUpdatePerkSource();
	const id = useId();
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const pageUrl = String(new FormData(event.currentTarget).get("pageUrl") ?? "").trim();
		if (pageUrl) update.mutate({ id: source.id, pageUrl });
	};
	return (
		<form onSubmit={save} className="grid gap-2 rounded-xl bg-surface-2 p-3">
			<Field
				label="Benefits page"
				htmlFor={id}
				hint="Its benefits page on the provider’s own site. Noodle reads Perks only from the page."
			>
				<div className="flex gap-2">
					<Input
						id={id}
						name="pageUrl"
						type="url"
						required
						pattern="https://.*"
						placeholder="https://"
						defaultValue={source.research === "unreadable" ? (source.pageUrl ?? "") : ""}
						className="flex-1 bg-card"
					/>
					<Button type="submit" variant="outline" disabled={disabled}>
						Read it
					</Button>
				</div>
			</Field>
		</form>
	);
}
