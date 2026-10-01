import { PERK_SOURCE_KINDS, type PerkSourceKind, perkSourceKindLabel } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { NativeSelect } from "@noodle/ui/components/native-select";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check, ChevronLeft, ExternalLink, Gift, Lock, RefreshCw } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Confirm } from "../../../components/plan-editing";
import { TermHelp } from "../../../components/term-help";
import { shortDayAt } from "../../../format";
import {
	newPerkSourceId,
	type PerkSourceItem,
	researchStatus,
	useAddPerkSource,
	useDecidePerkSource,
	useUpdatePerkSource,
} from "../../../perks";
import { perkSourcesQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/perks")({
	loader: ({ context }) => context.queryClient.ensureQueryData(perkSourcesQuery()),
	component: PerksPage,
});

/**
 * Perks: what the Household's phone plan, cards and memberships include, read from each one's own
 * benefits page, with a link to that page and the day it was read. Noodle suggests the Perk
 * Sources it spots in spending and Accounts; a Parent confirms each, or adds their own. When the
 * Perks depend on the plan, it asks which plan rather than guessing. Perk Overlaps (a service
 * paid for that a Perk includes, a cost one covers) then show among the Insights.
 */
function PerksPage() {
	const sources = useSuspenseQuery(perkSourcesQuery()).data;
	const suggested = sources.filter((s) => s.status === "suggested");
	const confirmed = sources.filter((s) => s.status === "confirmed");
	return (
		<>
			<PageHeader
				className="max-w-2xl"
				eyebrow="Insights"
				title="Perks"
				actions={
					<Button variant="outline" size="sm" asChild>
						<Link to="/insights">
							<ChevronLeft />
							Insights
						</Link>
					</Button>
				}
			/>
			<div className="grid max-w-2xl gap-6">
				{sources.length === 0 ? (
					<Card className="p-0">
						<EmptyState
							icon={<Gift />}
							title="No Perk Sources yet"
							description="Phone plans, credit cards and memberships often include services or pay for costs. Noodle suggests the ones it spots in your spending each night, or add one below."
						/>
					</Card>
				) : null}
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
				{confirmed.length > 0 ? (
					<Section aria-labelledby="perk-sources">
						<SectionHeader
							id="perk-sources"
							title="Perk Sources"
							count={confirmed.length}
							help={<TermHelp term="perk-source" />}
						/>
						{confirmed.map((source) => (
							<PerkSourceCard key={source.id} source={source} />
						))}
					</Section>
				) : null}
				<AddPerkSource />
			</div>
		</>
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
				<>
					<span>{perkSourceKindLabel[source.kind]}</span>
					{source.seenIn ? <span className="truncate">· Seen in “{source.seenIn}”</span> : null}
				</>
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

function PerkSourceCard({ source }: { source: PerkSourceItem }) {
	const decide = useDecidePerkSource();
	const update = useUpdatePerkSource();
	const hydrated = useHydrated();
	const [removing, setRemoving] = useState(false);
	const titleId = `perk-source-${source.id}`;
	const status = researchStatus(source);
	const busy = !hydrated || update.isPending || decide.isPending;
	return (
		<Card role="article" aria-labelledby={titleId}>
			<div className="grid gap-2 p-(--card-pad)">
				<div className="flex flex-wrap items-center gap-2">
					<h3 id={titleId} className="text-[15px] font-semibold leading-snug">
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
			{source.perks.length > 0 ? (
				<ul aria-label={`${source.name} Perks`} className="border-t [&>li+li]:border-t">
					{source.perks.map((perk) => (
						<ListRow
							key={perk.id}
							title={perk.name}
							meta={
								<>
									<span>
										{perk.kind === "service" ? "A service it includes" : "A cost it pays for"}
									</span>
									<span>·</span>
									<a
										href={perk.sourceUrl}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
									>
										Source
										<ExternalLink aria-hidden="true" className="size-3" />
									</a>
									<span>· Checked {shortDayAt(perk.checkedAt)}</span>
								</>
							}
						/>
					))}
				</ul>
			) : null}
			<div className="grid gap-2 border-t px-(--card-pad) py-2.5">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={busy || source.research === "researching"}
						onClick={() => update.mutate({ id: source.id })}
					>
						<RefreshCw
							className={update.isPending ? "animate-spin motion-reduce:animate-none" : ""}
						/>
						Check again
					</Button>
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
					<NativeSelect
						id={id}
						className="flex-1"
						value={plan}
						onChange={(event) => setPlan(event.target.value)}
					>
						<option value="" disabled>
							Choose a plan
						</option>
						{source.planOptions.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</NativeSelect>
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
		<Section aria-labelledby="add-perk-source">
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
							<NativeSelect
								id={`${id}-kind`}
								value={kind}
								onChange={(event) => setKind(event.target.value as PerkSourceKind)}
							>
								{PERK_SOURCE_KINDS.map((k) => (
									<option key={k} value={k}>
										{perkSourceKindLabel[k]}
									</option>
								))}
							</NativeSelect>
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
