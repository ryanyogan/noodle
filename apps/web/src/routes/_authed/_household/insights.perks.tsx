import {
	addDays,
	byDoNow,
	type DayKey,
	PERK_RENEWALS,
	PERK_SOURCE_KINDS,
	type PerkRenewal,
	type PerkSourceKind,
	type PerkStanding,
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
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import { Spinner } from "@noodle/ui/components/spinner";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { Check, ExternalLink, Gift, Lock, RefreshCw } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Confirm } from "../../../components/plan-editing";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { shortDay, shortDayAt } from "../../../format";
import {
	newPerkSourceId,
	newPerkUseId,
	type PerkSourceItem,
	researchStatus,
	useAddPerkSource,
	useDecidePerkSource,
	useMarkPerkUsed,
	useRemovePerkUse,
	useSetAnnualFee,
	useSetPerkValue,
	useUpdatePerkSource,
} from "../../../perks";
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

/**
 * Credit card perks: what the Household's cards (and phone plans and memberships) include, read
 * from each one's own benefits page. First this year's sums (value used against value
 * available, and against the annual fees), then what to do now (perks about to reset unused, or
 * never used), then each card with its perks: value, how often it renews, when it resets, and
 * whether it was used this period (marked by hand, or a matching charge). Noodle suggests the
 * Perk Sources it spots; a Parent confirms each, or adds their own.
 */
function PerksPage() {
	const sources = useSuspenseQuery(perkSourcesQuery()).data;
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
		.filter((entry) => perkDoNow(entry.standing, entry.perk.renews))
		.sort(byDoNow);
	return (
		<div className="grid gap-(--layout-gap)">
			{sources.length === 0 ? (
				<Card className="p-0">
					<EmptyState
						icon={<Gift />}
						title="No Perk Sources yet"
						description="Credit cards, phone plans and memberships often include services or pay for costs. Noodle suggests the ones it spots in your spending each night, or add one below."
					/>
				</Card>
			) : null}
			{/* Summary first, with what to do now beside it on a wide screen. */}
			{cards.some((card) => card.entries.length > 0) || doNow.length > 0 ? (
				<SectionGrid className="xl:items-stretch">
					{cards.some((card) => card.entries.length > 0) ? (
						<YearSummary cards={cards} year={asOf.slice(0, 4)} />
					) : null}
					{doNow.length > 0 ? <DoNow entries={doNow} /> : null}
				</SectionGrid>
			) : null}
			{suggested.length > 0 ? (
				<SectionGrid>
					{suggested.length > 0 ? (
						<Section aria-labelledby="perks-to-confirm">
							<SectionHeader id="perks-to-confirm" title="To confirm" count={suggested.length} />
							<List>
								{suggested.map((source) => (
									<Suggestion key={source.id} source={source} />
								))}
							</List>
						</Section>
					) : null}
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
					<SectionGrid>
						{cards.map(({ source, entries }) => (
							<PerkSourceCard key={source.id} source={source} entries={entries} />
						))}
					</SectionGrid>
				</Section>
			) : null}
			<AddPerkSource />
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
	toUse: entries.filter((e) => perkDoNow(e.standing, e.perk.renews)).length,
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
				<div className="grid h-full content-between gap-5 p-(--card-pad)">
					<dl className="grid gap-4 sm:grid-cols-3">
						<div className="grid gap-1">
							<dt className="text-[13px] text-muted-foreground">Value used</dt>
							<dd className="text-2xl font-semibold tabular-nums">
								{usd(used)}
								<span className="text-sm font-normal text-muted-foreground">
									{" "}
									of {usd(available)}
								</span>
							</dd>
							<Meter used={used} available={available} label="Value used this year" />
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
					<ul aria-label="Each card this year" className="grid gap-3 border-t pt-4">
						{rows.map((row) => (
							<li key={row.source.id} className="grid gap-1.5">
								<div className="flex flex-wrap items-baseline justify-between gap-x-3">
									<span className="min-w-0 break-words font-medium">{row.source.name}</span>
									<span className="text-sm tabular-nums text-muted-foreground">
										{usd(row.used)} of {usd(row.available)} used
										{row.fee !== null ? ` · fee ${usd(row.fee)}` : ""}
									</span>
								</div>
								<Meter
									used={row.used}
									available={row.available}
									label={`${row.source.name} this year`}
								/>
								<span className="text-[13px] text-muted-foreground">
									{row.perks} {row.perks === 1 ? "perk" : "perks"}
									{row.toUse > 0 ? ` · ${row.toUse} to use now` : " · all used for now"}
									{row.available > row.used ? ` · ${usd(row.available - row.used)} left` : ""}
								</span>
							</li>
						))}
					</ul>
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

/** Do now shows the few most urgent; every perk is in its card below, once. */
const DO_NOW_SHOWN = 3;

/** The most urgent perks (about to reset unused, or never used), and how many more there are. */
function DoNow({ entries }: { entries: PerkEntry[] }) {
	const shown = entries.slice(0, DO_NOW_SHOWN);
	const more = entries.length - shown.length;
	return (
		<Section aria-labelledby="perks-do-now" className="grid-rows-[auto_1fr]">
			<SectionHeader id="perks-do-now" title="Do now" count={entries.length} />
			<Card className="flex flex-col p-0">
				<ul aria-label="Do now" className="flex-1 [&>li+li]:border-t">
					{shown.map((entry) => (
						<PerkRow key={entry.perk.id} entry={entry} doNow />
					))}
				</ul>
				{more > 0 ? (
					<p className="border-t px-(--card-pad) py-3 text-sm">
						<a
							href="#perk-sources"
							className="font-medium text-primary underline-offset-4 hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
						>
							{more} more to use
						</a>
						<span className="text-muted-foreground"> in the cards below</span>
					</p>
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

function PerkRow({ entry, doNow = false }: { entry: PerkEntry; doNow?: boolean }) {
	const { perk, source, standing } = entry;
	const mark = useMarkPerkUsed();
	const remove = useRemovePerkUse();
	const hydrated = useHydrated();
	const noteId = useId();
	const [marking, setMarking] = useState(false);
	const used = standing.usedThisPeriod;
	const line = usedLine(entry);
	const save = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const note = String(new FormData(event.currentTarget).get("note") ?? "").trim() || null;
		mark.mutate({ id: newPerkUseId(), perkId: perk.id, name: perk.name, note });
		setMarking(false);
	};
	return (
		<li aria-label={perk.name} className="grid gap-1.5 px-(--card-pad) py-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="min-w-0 break-words font-medium">{perk.name}</span>
				{perk.valueCents !== null ? (
					<span className="shrink-0 font-semibold tabular-nums">{usd(perk.valueCents)}</span>
				) : null}
			</div>
			<MetaParts
				parts={[
					doNow ? source.name : null,
					perk.renews ? perkRenewalLabel[perk.renews] : null,
					doNow ? null : perk.kind === "service" ? "A service it includes" : "A cost it pays for",
					doNow ? null : (
						<a
							key="source"
							href={perk.sourceUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline max-lg:min-h-11"
						>
							Source
							<ExternalLink aria-hidden="true" className="size-3" />
						</a>
					),
					doNow ? null : `Checked ${shortDayAt(perk.checkedAt)}`,
				]}
			/>
			{line && !doNow ? (
				<p className="flex items-center gap-1.5 text-sm">
					{used ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
					<span className="min-w-0 break-words">{line}</span>
				</p>
			) : null}
			{doNow && marking ? <p className="text-sm text-muted-foreground">{stepFor(entry)}</p> : null}
			{marking ? (
				<form onSubmit={save} className="grid gap-2 rounded-xl bg-surface-2 p-3">
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
				<div className={doNow ? "flex items-center gap-3" : "flex flex-wrap gap-2"}>
					{doNow ? (
						<p className="min-w-0 flex-1 text-sm text-muted-foreground">{stepFor(entry)}</p>
					) : null}
					{!doNow && (perk.valueCents === null || perk.renews === null) ? (
						<PerkValue perk={perk} />
					) : null}
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
					{used ? null : (
						<Button
							variant="outline"
							size="sm"
							aria-label={`Mark ${perk.name} used`}
							disabled={!hydrated}
							onClick={() => setMarking(true)}
						>
							Mark used
						</Button>
					)}
				</div>
			)}
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
			trailing={
				<div className="flex items-center gap-2">
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
				</div>
			}
		/>
	);
}

function PerkSourceCard({ source, entries }: { source: PerkSourceItem; entries: PerkEntry[] }) {
	const decide = useDecidePerkSource();
	const update = useUpdatePerkSource();
	const hydrated = useHydrated();
	const [removing, setRemoving] = useState(false);
	const titleId = `perk-source-${source.id}`;
	const status = researchStatus(source);
	const busy = !hydrated || update.isPending || decide.isPending;
	const sums = sumsOf(source, entries);
	return (
		<Card role="article" aria-labelledby={titleId} className="min-w-0">
			<div className="grid gap-2 p-(--card-pad)">
				<div className="flex flex-wrap items-center gap-2">
					<h3 id={titleId} className="min-w-0 break-words text-[15px] font-semibold leading-snug">
						{source.name}
					</h3>
					<PrivateBadge source={source} />
				</div>
				<p className="text-[13px] text-muted-foreground">
					{[
						kindAndPlan(source),
						source.checkedAt && source.research === "done"
							? `Checked ${shortDayAt(source.checkedAt)}`
							: null,
					]
						.filter(Boolean)
						.join(" · ")}
				</p>
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
				{status ? (
					<p role="status" className="text-sm">
						{status}
					</p>
				) : null}
				{source.research === "needs-plan" && source.planOptions.length > 0 ? (
					<PlanPicker source={source} disabled={busy} />
				) : null}
				{source.research === "needs-link" || source.research === "unreadable" ? (
					<PageLink source={source} disabled={busy} />
				) : null}
			</div>
			{entries.length > 0 ? (
				<ul aria-label={`${source.name} Perks`} className="border-t [&>li+li]:border-t">
					{entries.map((entry) => (
						<PerkRow key={entry.perk.id} entry={entry} />
					))}
				</ul>
			) : null}
			<div className="grid gap-3 border-t px-(--card-pad) py-2.5">
				{source.kind === "credit-card" ? <AnnualFee source={source} disabled={busy} /> : null}
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={busy || source.research === "researching"}
						onClick={() => update.mutate({ id: source.id })}
					>
						{update.isPending ? <Spinner /> : <RefreshCw />}
						Check again
					</Button>
					{source.pageUrl ? (
						<a
							href={source.pageUrl}
							target="_blank"
							rel="noreferrer"
							className="inline-flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline max-lg:min-h-11"
						>
							Benefits page
							<ExternalLink aria-hidden="true" className="size-3" />
						</a>
					) : null}
					<Button
						variant="ghost"
						size="sm"
						className="ms-auto"
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
		</Card>
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

/** A Perk Source of the Household's own: a name, what it is, and optionally its plan and page. */
function AddPerkSource() {
	const add = useAddPerkSource();
	const hydrated = useHydrated();
	const id = useId();
	const [kind, setKind] = useState<PerkSourceKind>("credit-card");
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		const data = new FormData(form);
		const text = (key: string) => String(data.get(key) ?? "").trim() || null;
		const name = text("name");
		if (!name) return;
		add.mutate(
			{ id: newPerkSourceId(), name, kind, plan: text("plan"), pageUrl: text("pageUrl") },
			{ onSuccess: () => form.reset() },
		);
	};
	return (
		<Section aria-labelledby="add-perk-source" className="max-w-3xl">
			<SectionHeader id="add-perk-source" title="Add a Perk Source" />
			<Card>
				<form onSubmit={submit} className="grid gap-4 p-(--card-pad)">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name" htmlFor={`${id}-name`}>
							<Input
								id={`${id}-name`}
								name="name"
								required
								maxLength={80}
								placeholder="e.g. Chase Sapphire"
							/>
						</Field>
						<Field label="Kind" htmlFor={`${id}-kind`}>
							<OptionSelect
								id={`${id}-kind`}
								value={kind}
								onValueChange={(value) => setKind(value as PerkSourceKind)}
								choices={PERK_SOURCE_KINDS.map((k) => ({
									value: k,
									label: perkSourceKindLabel[k],
								}))}
							/>
						</Field>
						<Field label="Plan (optional)" htmlFor={`${id}-plan`}>
							<Input id={`${id}-plan`} name="plan" maxLength={80} placeholder="e.g. Preferred" />
						</Field>
						<Field
							label="Benefits page (optional)"
							htmlFor={`${id}-page`}
							hint="Needed unless Noodle knows it already."
						>
							<Input
								id={`${id}-page`}
								name="pageUrl"
								type="url"
								pattern="https://.*"
								placeholder="https://"
							/>
						</Field>
					</div>
					<div>
						<Button type="submit" disabled={!hydrated || add.isPending}>
							Add
						</Button>
					</div>
				</form>
			</Card>
		</Section>
	);
}
