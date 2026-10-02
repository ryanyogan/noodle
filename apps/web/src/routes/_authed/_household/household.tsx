import { UserButton } from "@clerk/tanstack-react-start";
import { type ForTotals, monthKeyAt, type SpendTotal } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageLayout } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
import { MetaParts } from "@noodle/ui/components/meta-parts";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { Tile } from "@noodle/ui/components/tile";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated, useRouter } from "@tanstack/react-router";
import { BookOpen, Landmark, Pencil, Plus, UserRoundMinus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram, nextBucketColor } from "../../../buckets";
import { CaptureSettings } from "../../../components/capture-settings";
import { CheckInSettings } from "../../../components/check-in-settings";
import { ColourPicker } from "../../../components/colour-picker";
import { InviteOtherParent } from "../../../components/invite-other-parent";
import { NudgeSettings } from "../../../components/nudge-settings";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { ReceiptSettings } from "../../../components/receipt-settings";
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
	checkInQuery,
	forTotalsEarlierQuery,
	householdParentsQuery,
	membersQuery,
	monthQuery,
	nudgeSettingsQuery,
	receiptAddressQuery,
	setupQuery,
} from "../../../queries";
import { addChild, removeChild, updateChild } from "../../../server/members";
import { restartSetup } from "../../../server/setup";

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
			context.queryClient.ensureQueryData(checkInQuery()),
			context.queryClient.ensureQueryData(captureTokenQuery()),
			context.queryClient.ensureQueryData(receiptAddressQuery()),
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
			<PageHeader
				eyebrow="Household"
				title={household.name}
				actions={
					// On phones Accounts lives here and on Transactions; the sidebar has its own link.
					<Button variant="outline" size="sm" asChild className="lg:hidden">
						<Link to="/accounts">
							<Landmark />
							Accounts
						</Link>
					</Button>
				}
			/>
			<PageLayout columns={2}>
				<div className="grid gap-8">
					<Section aria-labelledby="parents">
						<SectionHeader id="parents" title="Parents" count={data.parents.length} />
						<List>
							{data.parents.map((parent) => (
								<ListRow
									key={parent.id}
									leading={<Tile>{parent.name.charAt(0).toUpperCase()}</Tile>}
									title={parent.name}
									meta={
										// The email on its own line: beside "Parent" it wrapped or not by its
										// length, so the row's height changed from one Parent to the next.
										<span className="flex min-w-0 flex-col">
											<span>Parent</span>
											{parent.email ? (
												// Breaks at the @ rather than mid-word on a phone.
												<span className="min-w-0 break-words">
													{parent.email.split("@")[0]}
													<wbr />@{parent.email.split("@").slice(1).join("@")}
												</span>
											) : null}
										</span>
									}
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
					{data.hasAllParents ? null : (
						<Section aria-labelledby="invite">
							<SectionHeader id="invite" title="Invite the other Parent" />
							<InviteOtherParent invitedEmail={data.invitedEmail} />
						</Section>
					)}
				</div>
				<div className="grid gap-8">
					<CheckInSettings />
					<NudgeSettings />
					<CaptureSettings />
					<ReceiptSettings />
					<Section aria-labelledby="setup-again">
						<SectionHeader id="setup-again" title="Setup" />
						<RunSetupAgain />
					</Section>
					<Section aria-labelledby="glossary">
						<SectionHeader id="glossary" title="Words Noodle uses" />
						<Card className="flex items-center gap-3 p-(--card-pad) text-sm text-muted-foreground">
							<Tile>
								<BookOpen />
							</Tile>
							<p>
								What Free to Spend, a Bucket, a Sweep and the rest mean, in plain words:{" "}
								<Link
									to="/glossary"
									className="font-medium text-foreground underline underline-offset-2"
								>
									the Glossary
								</Link>
								.
							</p>
						</Card>
					</Section>
					<Section aria-labelledby="account" className="lg:hidden">
						<SectionHeader id="account" title="Your account" />
						<Card className="flex items-center gap-3 p-(--card-pad) text-sm text-muted-foreground">
							<UserButton
								appearance={{
									elements: { userButtonTrigger: { minWidth: "2.75rem", minHeight: "2.75rem" } },
								}}
							/>
							Manage your sign-in or sign out.
						</Card>
					</Section>
				</div>
			</PageLayout>
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
				// A phone gets a list (each Bucket's name whole, its two amounts beneath); sm+ the table.
				<ul
					aria-label={`What ${child.name} cost, by Bucket`}
					className="grid gap-2.5 border-t px-(--card-pad) py-3 text-sm sm:hidden"
				>
					{rows.map((bucket) => (
						<li key={bucket.id} className="grid gap-0.5">
							<span className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className="size-2 shrink-0 rounded-[2px]"
									style={{ background: `var(--bucket-${asBucketColor(bucket.color)})` }}
								/>
								<span className="min-w-0 break-words">{bucket.name}</span>
							</span>
							<MetaParts
								className="ms-4 text-[13px] text-muted-foreground tabular-nums"
								parts={[
									`This month ${formatMoney(month.buckets[bucket.id] ?? 0)}`,
									`This year ${formatMoney(year.buckets[bucket.id] ?? 0)}`,
								]}
							/>
						</li>
					))}
					<li className="grid gap-0.5 border-t pt-2.5 font-semibold">
						<span>Total</span>
						<MetaParts
							className="tabular-nums"
							parts={[
								`This month ${formatMoney(month.total)}`,
								`This year ${formatMoney(year.total)}`,
							]}
						/>
					</li>
				</ul>
			) : null}
			{year.total > 0 ? (
				<Table className="border-t text-sm max-sm:hidden sm:table-fixed">
					<TableCaption className="sr-only">What {child.name} cost, by Bucket</TableCaption>
					<TableHeader>
						<TableRow className="border-0">
							<TableHead
								scope="col"
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-2.5 pb-1.5"
							>
								Bucket
							</TableHead>
							<TableHead scope="col" numeric className="h-auto px-2 pt-2.5 pb-1.5 sm:w-28">
								This month
							</TableHead>
							<TableHead
								scope="col"
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-2.5 pb-1.5 sm:w-28"
							>
								This year
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((bucket) => (
							<TableRow key={bucket.id} className="border-0">
								<th scope="row" className="px-(--card-pad) py-1.5 text-start font-normal">
									<span className="flex items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-[2px]"
											style={{ background: `var(--bucket-${asBucketColor(bucket.color)})` }}
										/>
										<span className="min-w-0 break-words">{bucket.name}</span>
									</span>
								</th>
								<TableCell numeric className="px-2 py-1.5">
									{formatMoney(month.buckets[bucket.id] ?? 0)}
								</TableCell>
								<TableCell
									numeric
									className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-1.5"
								>
									{formatMoney(year.buckets[bucket.id] ?? 0)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter className="bg-transparent">
						<TableRow className="font-semibold">
							<th scope="row" className="px-(--card-pad) py-2.5 text-start">
								Total
							</th>
							<TableCell numeric className="px-2 py-2.5">
								{formatMoney(month.total)}
							</TableCell>
							<TableCell
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5"
							>
								{formatMoney(year.total)}
							</TableCell>
						</TableRow>
					</TableFooter>
				</Table>
			) : null}
		</Card>
	);
}

/**
 * "Run setup again" (#53): the get-started wizard from Hello, with what was answered before filled
 * in, so each step changes what's on the Plan instead of adding to it.
 */
function RunSetupAgain() {
	const hydrated = useHydrated();
	const router = useRouter();
	const queryClient = useQueryClient();
	const again = useMutation({
		mutationFn: () => restartSetup(),
		onSuccess: async () => {
			// The wizard reads where it is from the cache; drop the old copy so it starts at Hello.
			queryClient.removeQueries({ queryKey: setupQuery().queryKey });
			await router.navigate({ to: "/setup" });
		},
	});
	return (
		<Card className="grid gap-3 p-(--card-pad) text-sm">
			<p className="text-muted-foreground">
				Go through the setup steps again to change your take-home pay, bills, Buckets or Goal. It
				changes what’s there. Nothing is added twice.
			</p>
			<Button
				type="button"
				variant="outline"
				className="justify-self-start"
				disabled={!hydrated || again.isPending || again.isSuccess}
				onClick={() => again.mutate()}
			>
				Run setup again
			</Button>
			{again.isError ? <FormError>We couldn’t start setup. Please try again.</FormError> : null}
		</Card>
	);
}
