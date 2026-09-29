import { UserButton } from "@clerk/tanstack-react-start";
import { type ForTotals, monthKeyAt, type SpendTotal } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { Check, Mail, Pencil, Plus, UserRoundMinus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram, nextBucketColor } from "../../../buckets";
import { CaptureSettings } from "../../../components/capture-settings";
import { ColourPicker } from "../../../components/colour-picker";
import { NudgeSettings } from "../../../components/nudge-settings";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { formatMoney, monthName } from "../../../format";
import {
	childrenOf,
	type MemberSummary,
	useForTotals,
	useMemberChange,
	withChild,
	withChildDetails,
	withoutChild,
} from "../../../members";
import {
	captureTokenQuery,
	forTotalsEarlierQuery,
	householdParentsQuery,
	membersQuery,
	monthQuery,
	nudgeSettingsQuery,
} from "../../../queries";
import { inviteParent } from "../../../server/invites";
import { addChild, removeChild, updateChild } from "../../../server/members";

export const Route = createFileRoute("/_authed/_household/household")({
	loader: async ({ context }) => {
		// What each Child cost is shown for the Household's current month and its year so far.
		const month = monthKeyAt(new Date(), context.household.timeZone);
		await Promise.all([
			context.queryClient.ensureQueryData(householdParentsQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(monthQuery(month)),
			context.queryClient.ensureQueryData(forTotalsEarlierQuery(month)),
			context.queryClient.ensureQueryData(nudgeSettingsQuery()),
			context.queryClient.ensureQueryData(captureTokenQuery()),
		]);
		return { month };
	},
	component: HouseholdPage,
});

function HouseholdPage() {
	const { household } = Route.useRouteContext();
	const { data } = useSuspenseQuery(householdParentsQuery());
	const members = useSuspenseQuery(membersQuery()).data;
	const children = childrenOf(members);
	const remove = useMemberChange({
		save: (data: { memberId: string }) => removeChild({ data }),
		apply: withoutChild,
	});
	return (
		<>
			<PageHeader eyebrow="Household" title={household.name} />
			<div className="grid max-w-2xl gap-8">
				<Section aria-labelledby="parents">
					<SectionHeader id="parents" title="Parents" count={data.parents.length} />
					<List>
						{data.parents.map((parent) => (
							<ListRow
								key={parent.id}
								leading={<Tile>{parent.name.charAt(0).toUpperCase()}</Tile>}
								title={parent.name}
								meta="Parent"
							/>
						))}
					</List>
				</Section>
				<Section aria-labelledby="children">
					<SectionHeader id="children" title="Children" count={children.length} />
					<SaveFailed change={remove} />
					{children.length > 0 ? (
						<List>
							{children.map((child) => (
								<ChildRow
									key={child.id}
									child={child}
									onRemove={(memberId) => remove.mutate({ memberId })}
								/>
							))}
						</List>
					) : null}
					<AddChild members={members} />
				</Section>
				{children.length > 0 ? <ChildCosts of={children} /> : null}
				<Section aria-labelledby="invite">
					<SectionHeader id="invite" title="Invite the other Parent" />
					{data.hasAllParents ? (
						<Card className="flex items-center gap-3 p-(--card-pad) text-sm text-muted-foreground">
							<Tile bucket={6}>
								<Check />
							</Tile>
							Your Household has both Parents.
						</Card>
					) : (
						<InviteOtherParent invitedEmail={data.invitedEmail} />
					)}
				</Section>
				<NudgeSettings />
				<CaptureSettings />
				<Section aria-labelledby="account" className="lg:hidden">
					<SectionHeader id="account" title="Your account" />
					<Card className="flex items-center gap-3 p-(--card-pad) text-sm text-muted-foreground">
						<UserButton />
						Manage your sign-in or sign out.
					</Card>
				</Section>
			</div>
		</>
	);
}

/** A Child, with their name and colour to change, or to remove from the Household. */
function ChildRow({
	child,
	onRemove,
}: {
	child: MemberSummary;
	onRemove: (memberId: string) => void;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const detailsId = useId();
	return (
		<ListRow
			leading={<Tile bucket={asBucketColor(child.color ?? 1)}>{monogram(child.name)}</Tile>}
			title={child.name}
			meta="Child"
			trailing={
				<Button
					variant="ghost"
					size="icon"
					type="button"
					disabled={!hydrated}
					aria-label={`Edit ${child.name}`}
					aria-expanded={open}
					aria-controls={detailsId}
					onClick={() => setOpen(!open)}
				>
					<Pencil />
				</Button>
			}
			below={
				open ? (
					<div id={detailsId}>
						<ChildDetails child={child} onRemove={onRemove} />
					</div>
				) : undefined
			}
		/>
	);
}

function ChildDetails({
	child,
	onRemove,
}: {
	child: MemberSummary;
	onRemove: (memberId: string) => void;
}) {
	const nameId = useId();
	const [confirmRemove, setConfirmRemove] = useState(false);
	// The colour just picked, shown until the cache catches up (or rolls back).
	const [pickedColor, setPickedColor] = useState<number | null>(null);
	const details = useMemberChange({
		save: (data: { memberId: string; name?: string; color?: number }) => updateChild({ data }),
		apply: withChildDetails,
	});

	function rename(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
		if (name && name !== child.name) details.mutate({ memberId: child.id, name });
	}

	return (
		<div className="grid gap-4 rounded-xl bg-surface-2 p-3">
			<SaveFailed change={details} />
			<form onSubmit={rename}>
				<Field label="Name" htmlFor={nameId}>
					<div className="flex gap-2">
						<Input
							id={nameId}
							name="name"
							required
							maxLength={40}
							defaultValue={child.name}
							className="bg-card"
						/>
						<Button type="submit" variant="outline">
							Rename
						</Button>
					</div>
				</Field>
			</form>
			<ColourPicker
				name={`color-${child.id}`}
				value={pickedColor ?? child.color ?? 1}
				onChange={(color) => {
					setPickedColor(color);
					details.mutate({ memberId: child.id, color }, { onSettled: () => setPickedColor(null) });
				}}
			/>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="justify-self-end"
				onClick={() => setConfirmRemove(true)}
			>
				<UserRoundMinus />
				Remove
			</Button>
			{confirmRemove ? (
				<Confirm
					onConfirm={() => onRemove(child.id)}
					onCancel={() => setConfirmRemove(false)}
					confirmLabel={`Remove ${child.name}`}
				>
					{child.name} can no longer be picked for new spending. Spending already For {child.name}{" "}
					keeps it.
				</Confirm>
			) : null}
		</div>
	);
}

function AddChild({ members }: { members: MemberSummary[] }) {
	const hydrated = useHydrated();
	// A fresh ID per Child; a retry of the same attempt reuses it, so they're added once.
	const [memberId, setMemberId] = useState(() => ulid());
	const add = useMemberChange({
		save: (data: { memberId: string; name: string; color: number }) => addChild({ data }),
		apply: withChild,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const name = String(new FormData(form).get("name") ?? "").trim();
		if (!name) return;
		const color = nextBucketColor(childrenOf(members).map((c) => c.color ?? 0));
		add.mutate({ memberId, name, color });
		// The Child shows at once; the next one gets its own ID.
		setMemberId(ulid());
		form.reset();
	}

	return (
		<Card>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<Field
					label="Add a Child"
					htmlFor="new-child-name"
					hint="Children don’t sign in. Spending can be marked as For them to see what each one costs."
				>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							id="new-child-name"
							name="name"
							required
							maxLength={40}
							autoComplete="off"
							placeholder="Their name"
						/>
						<Button type="submit" variant="secondary" disabled={!hydrated}>
							<Plus />
							Add Child
						</Button>
					</div>
				</Field>
				<SaveFailed change={add} />
			</form>
		</Card>
	);
}

/**
 * What each Child cost this month and this year, by Bucket. Spending For Everyone is the
 * Household's, counted once and never again under each Child.
 */
function ChildCosts({ of: children }: { of: MemberSummary[] }) {
	const { month } = Route.useLoaderData();
	const totals = useForTotals(month);
	return (
		<Section aria-labelledby="child-costs">
			<SectionHeader
				id="child-costs"
				title="What each Child cost"
				action={
					<span className="text-[13px] text-muted-foreground">
						{monthName(month)} and {month.slice(0, 4)} so far
					</span>
				}
			/>
			{children.map((child) => (
				<ChildCost key={child.id} child={child} totals={totals} />
			))}
			<p className="text-[13px] text-muted-foreground">
				Spending For Everyone counts once, for the whole Household:{" "}
				{formatMoney(totals.month.household.total)} this month,{" "}
				{formatMoney(totals.yearToDate.household.total)} this year.
			</p>
		</Section>
	);
}

const noSpending: SpendTotal = { total: 0, buckets: {} };

function ChildCost({
	child,
	totals,
}: {
	child: MemberSummary;
	totals: {
		month: ForTotals;
		yearToDate: ForTotals;
		buckets: ReturnType<typeof useForTotals>["buckets"];
	};
}) {
	const month = totals.month.members[child.id] ?? noSpending;
	const year = totals.yearToDate.members[child.id] ?? noSpending;
	// The year includes the month, so its Buckets are every Bucket spent from.
	const rows = totals.buckets
		.filter((bucket) => year.buckets[bucket.id])
		.sort((a, b) => (year.buckets[b.id] ?? 0) - (year.buckets[a.id] ?? 0));
	const headingId = `child-cost-${child.id}`;
	return (
		<Card role="region" aria-labelledby={headingId}>
			<div className="flex items-center gap-3 px-(--card-pad) py-3.5">
				<Tile bucket={asBucketColor(child.color ?? 1)}>{monogram(child.name)}</Tile>
				<h3 id={headingId} className="flex-1 truncate text-sm font-medium">
					{child.name}
				</h3>
				{year.total === 0 ? <Badge>Nothing yet</Badge> : null}
			</div>
			{year.total > 0 ? (
				<table className="w-full table-fixed border-t text-sm">
					<thead>
						<tr className="text-xs text-subtle-foreground">
							<th scope="col" className="px-(--card-pad) pt-2.5 pb-1.5 text-start font-medium">
								Bucket
							</th>
							<th scope="col" className="w-28 px-2 pt-2.5 pb-1.5 text-end font-medium">
								This month
							</th>
							<th scope="col" className="w-28 px-(--card-pad) pt-2.5 pb-1.5 text-end font-medium">
								This year
							</th>
						</tr>
					</thead>
					<tbody className="tabular-nums">
						{rows.map((bucket) => (
							<tr key={bucket.id}>
								<th scope="row" className="px-(--card-pad) py-1.5 text-start font-normal">
									<span className="flex items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-[2px]"
											style={{ background: `var(--bucket-${asBucketColor(bucket.color)})` }}
										/>
										<span className="truncate">{bucket.name}</span>
									</span>
								</th>
								<td className="px-2 py-1.5 text-end">
									{formatMoney(month.buckets[bucket.id] ?? 0)}
								</td>
								<td className="px-(--card-pad) py-1.5 text-end">
									{formatMoney(year.buckets[bucket.id] ?? 0)}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot className="tabular-nums">
						<tr className="border-t font-semibold">
							<th scope="row" className="px-(--card-pad) py-2.5 text-start">
								Total
							</th>
							<td className="px-2 py-2.5 text-end">{formatMoney(month.total)}</td>
							<td className="px-(--card-pad) py-2.5 text-end">{formatMoney(year.total)}</td>
						</tr>
					</tfoot>
				</table>
			) : null}
		</Card>
	);
}

function InviteOtherParent({ invitedEmail }: { invitedEmail: string | null }) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	// A fresh ID per attempt; reused by a retry of the same attempt.
	const [inviteId, setInviteId] = useState(() => ulid());
	const invite = useMutation({
		mutationFn: (email: string) => inviteParent({ data: { inviteId, email } }),
		onSuccess: async (result) => {
			if (result.ok) setInviteId(ulid());
			await queryClient.invalidateQueries({ queryKey: householdParentsQuery().queryKey });
		},
	});
	const refused = invite.data?.ok === false ? invite.data.reason : null;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		invite.mutate(String(new FormData(form).get("email") ?? ""), {
			onSuccess: (result) => {
				if (result.ok) form.reset();
			},
		});
	}

	return (
		<Card>
			<div className="flex items-start gap-3 border-b px-(--card-pad) py-3.5 text-sm">
				<Tile>
					<Mail />
				</Tile>
				{invitedEmail ? (
					<div className="grid gap-1">
						<div className="flex flex-wrap items-center gap-2 font-medium">
							Invited {invitedEmail}
							<Badge variant="pace" dot>
								Waiting
							</Badge>
						</div>
						<p className="text-muted-foreground">
							Ask them to sign in to Noodle with that email to join.
						</p>
					</div>
				) : (
					<p className="self-center text-muted-foreground">
						Noodle doesn’t send an email. Once you’ve invited them, they join by signing in with
						that address.
					</p>
				)}
			</div>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<Field label="Their email" htmlFor="invite-email">
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input
							id="invite-email"
							name="email"
							type="email"
							required
							maxLength={254}
							autoComplete="off"
							placeholder="name@example.com"
						/>
						<Button type="submit" disabled={!hydrated || invite.isPending}>
							{invitedEmail ? "Invite someone else" : "Invite"}
						</Button>
					</div>
				</Field>
				{refused === "own-email" ? (
					<FormError>That’s your own email. Enter the other Parent’s email.</FormError>
				) : null}
				{refused === "household-full" ? (
					<FormError>Your Household already has both Parents.</FormError>
				) : null}
				{invite.isError ? (
					<FormError>We couldn’t save that invite. Please try again.</FormError>
				) : null}
			</form>
		</Card>
	);
}
