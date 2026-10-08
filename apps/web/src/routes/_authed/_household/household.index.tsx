import { UserButton } from "@clerk/tanstack-react-start";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageLayout, SectionGrid } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionGroup, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { Pencil, Plus, UserRoundMinus } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram, nextBucketColor } from "../../../buckets";
import { CaptureSettings } from "../../../components/capture-settings";
import { CheckInSettings } from "../../../components/check-in-settings";
import { ColourPicker } from "../../../components/colour-picker";
import { DataDownload } from "../../../components/data-download";
import { DangerZone } from "../../../components/fresh-start";
import { HouseholdDetails } from "../../../components/household-details";
import { LOG_HASH, type LogFilters, logSearchSchema } from "../../../components/household-log";
import { HouseholdSnapshots, snapshotsQuery } from "../../../components/household-snapshots";
import { InviteOtherParent } from "../../../components/invite-other-parent";
import { NudgeSettings } from "../../../components/nudge-settings";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { ReceiptSettings } from "../../../components/receipt-settings";
import {
	childrenOf,
	type MemberSummary,
	useMemberChange,
	withChild,
	withChildDetails,
	withoutChild,
} from "../../../members";
import {
	captureTokenQuery,
	checkInQuery,
	householdParentsQuery,
	membersQuery,
	monthsKey,
	nudgeSettingsQuery,
	receiptAddressQuery,
	setupQuery,
} from "../../../queries";
import { addChild, removeChild, updateChild, updateParent } from "../../../server/members";
import { restartSetup } from "../../../server/setup";

// Household settings › Settings: what the Household is and how Noodle behaves for it. The header
// and the tabs are the layout's (household.tsx).
export const Route = createFileRoute("/_authed/_household/household/")({
	// The Log was on this page, at #log with its filters in the address (issue 139). Its old
	// addresses open the Logs tab, filters kept: here when one is followed inside the app or has a
	// filter, and in the page below when a browser lands on a bare "/household#log", since the
	// server is never sent the part after the #.
	validateSearch: logSearchSchema,
	// Only the Log's own filters say so: `search` also holds what the layouts above read, and Quick
	// Add opens over this page by adding `sheet` to it.
	beforeLoad: ({ search, location }) => {
		const filtered = (Object.keys(logSearchSchema.shape) as (keyof LogFilters)[]).some(
			(key) => search[key] !== undefined,
		);
		if (location.hash === LOG_HASH || filtered) {
			throw redirect({ to: "/household/logs", search, replace: true });
		}
	},
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(householdParentsQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(nudgeSettingsQuery()),
			context.queryClient.ensureQueryData(checkInQuery()),
			context.queryClient.ensureQueryData(captureTokenQuery()),
			context.queryClient.ensureQueryData(receiptAddressQuery()),
			// The snapshot history comes with the page, so it doesn't pop in and move what's below.
			context.queryClient.prefetchQuery(snapshotsQuery()),
		]);
	},
	component: HouseholdPage,
});

function HouseholdPage() {
	const { household, parentId } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	// A bookmark of the Log's old address, opened in the browser: see the route's beforeLoad.
	useEffect(() => {
		if (window.location.hash === `#${LOG_HASH}`) {
			void navigate({ to: "/household/logs", replace: true });
		}
	}, [navigate]);
	const { data } = useSuspenseQuery(householdParentsQuery());
	const members = useSuspenseQuery(membersQuery()).data;
	const children = childrenOf(members);
	const remove = useMemberChange({
		save: (data: { memberId: string }) => removeChild({ data }),
		apply: withoutChild,
	});
	return (
		<>
			{/* A settings page (#69): groups, each a short heading over what a Parent sets. One column
			    at the reading width below xl; from xl two columns of groups that use the page's width
			    (#73), in reading order down the left then the right, with the Danger zone last across
			    both. */}
			<PageLayout className="max-xl:max-w-(--reading-width)">
				<SectionGrid className="gap-y-10">
					<div className="grid gap-10">
						<SectionGroup id="household" title="Household">
							<HouseholdDetails household={household} />
						</SectionGroup>
						<SectionGroup id="people" title="People">
							<Section aria-labelledby="parents">
								<SectionHeader id="parents" title="Parents" count={data.parents.length} />
								<List>
									{data.parents.map((parent) => (
										<ParentRow
											key={parent.id}
											parent={parent}
											// Their name and colour as the Members list has them, which shows a change
											// at once.
											member={members.find((m) => m.id === parent.id)}
											own={parent.id === parentId}
										/>
									))}
								</List>
							</Section>
							{data.hasAllParents ? null : (
								<Section aria-labelledby="invite">
									<SectionHeader id="invite" title="Invite the other Parent" />
									<InviteOtherParent invite={data.invite} />
								</Section>
							)}
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
						</SectionGroup>
						<SectionGroup id="bringing-in" title="Bringing in spending">
							<ReceiptSettings />
							<CaptureSettings />
						</SectionGroup>
						<SectionGroup id="setup" title="Setup">
							<RunSetupAgain />
						</SectionGroup>
					</div>
					{/* Reminders and Your data, the two tall groups, make the right column, so the two
					    columns end near the same line (#73). */}
					<div className="grid gap-10">
						<SectionGroup id="reminders" title="Reminders">
							<CheckInSettings />
							<NudgeSettings />
						</SectionGroup>
						<SectionGroup id="your-data" title="Your data">
							<DataDownload />
							<HouseholdSnapshots householdName={household.name} />
						</SectionGroup>
					</div>
					<SectionGroup id="danger-zone" title="Danger zone" className="col-span-full">
						<DangerZone householdName={household.name} />
					</SectionGroup>
					{/* The sidebar has the account button from lg; a phone has it here. */}
					<SectionGroup id="account" title="Account" className="col-span-full lg:hidden">
						<Card className="flex items-center gap-3 p-(--card-pad) text-sm text-muted-foreground">
							<UserButton
								appearance={{
									elements: { userButtonTrigger: { minWidth: "2.75rem", minHeight: "2.75rem" } },
								}}
							/>
							Manage your sign-in or sign out.
						</Card>
					</SectionGroup>
				</SectionGrid>
			</PageLayout>
		</>
	);
}

/**
 * A Parent. Their own row has a pencil that opens their sheet (issue 104); the other Parent's has
 * none, since each changes only their own name and colour.
 */
function ParentRow({
	parent,
	member,
	own,
}: {
	parent: { id: string; name: string; email: string | null };
	member: MemberSummary | undefined;
	own: boolean;
}) {
	const hydrated = useHydrated();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const name = member?.name ?? parent.name;
	const color = member?.color ?? null;
	const details = useMemberChange({
		save: async (data: { memberId: string; name?: string; color?: number }) => {
			await updateParent({ data });
			// Their Personal Allowance may be named after them, and the Plan lists it.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: householdParentsQuery().queryKey }),
				...(data.name === undefined
					? []
					: [queryClient.invalidateQueries({ queryKey: monthsKey })]),
			]);
		},
		apply: withChildDetails,
	});
	return (
		<ListRow
			leading={
				// Plain until they pick a colour, as every Parent was before.
				<Tile bucket={color ? asBucketColor(color) : undefined}>{monogram(name)}</Tile>
			}
			title={name}
			meta={
				// The email on its own line: beside "Parent" it wrapped or not by its
				// length, so the row's height changed from one Parent to the next.
				<span className="flex w-full min-w-0 flex-col">
					<span>{own ? "Parent · You" : "Parent"}</span>
					{parent.email ? (
						// One line, cut short when long (the whole address on hover), so every
						// Parent's row is the same height whatever the address.
						<span className="min-w-0 truncate" title={parent.email}>
							{parent.email}
						</span>
					) : null}
				</span>
			}
			trailing={
				own ? (
					<>
						<Button
							variant="ghost"
							size="icon"
							type="button"
							disabled={!hydrated}
							aria-label="Edit your name and colour"
							onClick={() => setOpen(true)}
						>
							<Pencil />
						</Button>
						<ParentSheet
							name={name}
							color={color}
							open={open}
							onOpenChange={setOpen}
							onSave={(change) => details.mutate({ memberId: parent.id, ...change })}
						/>
					</>
				) : undefined
			}
			below={details.isError ? <SaveFailed change={details} /> : undefined}
		/>
	);
}

/** A Parent's own sheet (issue 104): the name Noodle shows for them and their colour, saved together. */
function ParentSheet({
	name: savedName,
	color: savedColor,
	open,
	onOpenChange,
	onSave,
}: {
	name: string;
	color: number | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (change: ChildChange) => void;
}) {
	const hydrated = useHydrated();
	const nameId = useId();
	const [name, setName] = useState(savedName);
	// 0 is no colour yet: no swatch is chosen until they pick one.
	const [color, setColor] = useState(savedColor ?? 0);
	const trimmed = name.trim();
	const change: ChildChange = {
		...(trimmed !== savedName ? { name: trimmed } : {}),
		...(color !== (savedColor ?? 0) ? { color } : {}),
	};
	const dirty = Object.keys(change).length > 0;

	function close() {
		setName(savedName);
		setColor(savedColor ?? 0);
		onOpenChange(false);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!trimmed) return;
		// The row shows the change at once (and says so if it didn't save).
		if (dirty) onSave(change);
		onOpenChange(false);
	}

	return (
		<Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			{open ? (
				<SheetContent>
					<SheetHeader title="Your name and colour" description="How you show up in Noodle" />
					<form onSubmit={onSubmit} className="grid gap-4">
						<Field
							label="Name"
							htmlFor={nameId}
							hint="What Noodle calls you, for both Parents. Your sign-in stays as it is."
						>
							<Input
								id={nameId}
								name="name"
								required
								maxLength={80}
								autoComplete="off"
								value={name}
								onChange={(event) => setName(event.currentTarget.value)}
							/>
						</Field>
						<ColourPicker value={color} onChange={setColor} />
						<SheetFooter className="max-lg:grid-cols-2">
							<Button type="button" variant="outline" onClick={close}>
								Cancel
							</Button>
							<Button type="submit" disabled={!hydrated || !trimmed || !dirty}>
								Save
							</Button>
						</SheetFooter>
					</form>
				</SheetContent>
			) : null}
		</Sheet>
	);
}

/** A Child, with a link to what they cost and a pencil that opens their sheet. */
function ChildRow({
	child,
	onRemove,
}: {
	child: MemberSummary;
	onRemove: (memberId: string) => void;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const details = useMemberChange({
		save: (data: { memberId: string; name?: string; color?: number }) => updateChild({ data }),
		apply: withChildDetails,
	});
	return (
		<ListRow
			leading={<Tile bucket={asBucketColor(child.color ?? 1)}>{monogram(child.name)}</Tile>}
			title={child.name}
			meta={
				<span className="flex flex-wrap items-center gap-x-3">
					<span>Child</span>
					{/* What a Child cost is a report, so it lives in Reports › People (#69). A quiet link, but
					    44 px tall below lg so a thumb finds it; the negative margin keeps the row's height. */}
					<Link
						to="/reports"
						search={{ view: "people", member: child.id }}
						className="inline-flex items-center underline underline-offset-2 hover:text-foreground max-lg:-my-3 max-lg:min-h-11"
					>
						See what {child.name} costs
					</Link>
				</span>
			}
			trailing={
				<>
					<Button
						variant="ghost"
						size="icon"
						type="button"
						disabled={!hydrated}
						aria-label={`Edit ${child.name}`}
						onClick={() => setOpen(true)}
					>
						<Pencil />
					</Button>
					<ChildSheet
						child={child}
						open={open}
						onOpenChange={setOpen}
						onSave={(change) => details.mutate({ memberId: child.id, ...change })}
						onRemove={() => onRemove(child.id)}
					/>
				</>
			}
			below={details.isError ? <SaveFailed change={details} /> : undefined}
		/>
	);
}

type ChildChange = { name?: string; color?: number };

/** A Child's sheet (#51): their name and colour, saved together, or removing them. */
function ChildSheet({
	child,
	open,
	onOpenChange,
	onSave,
	onRemove,
}: {
	child: MemberSummary;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (change: ChildChange) => void;
	onRemove: () => void;
}) {
	const hydrated = useHydrated();
	const nameId = useId();
	const [name, setName] = useState(child.name);
	const [color, setColor] = useState(child.color ?? 1);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const trimmed = name.trim();
	const change: ChildChange = {
		...(trimmed !== child.name ? { name: trimmed } : {}),
		...(color !== (child.color ?? 1) ? { color } : {}),
	};
	const dirty = Object.keys(change).length > 0;

	function close() {
		setName(child.name);
		setColor(child.color ?? 1);
		setConfirmRemove(false);
		onOpenChange(false);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!trimmed) return;
		// The row shows the change at once (and says so if it didn't save).
		if (dirty) onSave(change);
		onOpenChange(false);
	}

	return (
		<Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			{open ? (
				<SheetContent>
					<SheetHeader title={child.name} description="Child" />
					<form onSubmit={onSubmit} className="grid gap-4">
						<Field label="Name" htmlFor={nameId}>
							<Input
								id={nameId}
								name="name"
								required
								maxLength={40}
								autoComplete="off"
								value={name}
								onChange={(event) => setName(event.currentTarget.value)}
							/>
						</Field>
						<ColourPicker value={color} onChange={setColor} />
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="justify-self-start"
							onClick={() => setConfirmRemove(true)}
						>
							<UserRoundMinus />
							Remove
						</Button>
						{confirmRemove ? (
							<Confirm
								onConfirm={() => {
									onRemove();
									onOpenChange(false);
								}}
								onCancel={() => setConfirmRemove(false)}
								confirmLabel={`Remove ${child.name}`}
							>
								{child.name} can no longer be picked for new spending. Spending already For{" "}
								{child.name} keeps it.
							</Confirm>
						) : null}
						<SheetFooter className="max-lg:grid-cols-2">
							<Button type="button" variant="outline" onClick={close}>
								Cancel
							</Button>
							<Button type="submit" disabled={!hydrated || !trimmed || !dirty}>
								Save
							</Button>
						</SheetFooter>
					</form>
				</SheetContent>
			) : null}
		</Sheet>
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
						<Button type="submit" variant="outline" disabled={!hydrated}>
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
				className="sm:justify-self-start"
				disabled={!hydrated || again.isPending || again.isSuccess}
				onClick={() => again.mutate()}
			>
				Run setup again
			</Button>
			{again.isError ? <FormError>We couldn’t start setup. Please try again.</FormError> : null}
		</Card>
	);
}
