import { UserButton } from "@clerk/tanstack-react-start";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageLayout } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionGroup, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated, useRouter } from "@tanstack/react-router";
import { Landmark, Pencil, Plus, UserRoundMinus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram, nextBucketColor } from "../../../buckets";
import { CaptureSettings } from "../../../components/capture-settings";
import { CheckInSettings } from "../../../components/check-in-settings";
import { ColourPicker } from "../../../components/colour-picker";
import { HouseholdDetails } from "../../../components/household-details";
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
	nudgeSettingsQuery,
	receiptAddressQuery,
	setupQuery,
} from "../../../queries";
import { addChild, removeChild, updateChild } from "../../../server/members";
import { restartSetup } from "../../../server/setup";

export const Route = createFileRoute("/_authed/_household/household")({
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(householdParentsQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(nudgeSettingsQuery()),
			context.queryClient.ensureQueryData(checkInQuery()),
			context.queryClient.ensureQueryData(captureTokenQuery()),
			context.queryClient.ensureQueryData(receiptAddressQuery()),
		]);
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
				eyebrow="Household settings"
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
			{/* A settings page (#69): one column of groups, each a short heading over what a Parent sets. */}
			<PageLayout width="reading">
				<div className="grid gap-10">
					<SectionGroup id="household" title="Household">
						<HouseholdDetails household={household} />
					</SectionGroup>
					<SectionGroup id="people" title="People">
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
						{data.hasAllParents ? null : (
							<Section aria-labelledby="invite">
								<SectionHeader id="invite" title="Invite the other Parent" />
								<InviteOtherParent invitedEmail={data.invitedEmail} />
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
					<SectionGroup id="reminders" title="Reminders">
						<CheckInSettings />
						<NudgeSettings />
					</SectionGroup>
					<SectionGroup id="bringing-in" title="Bringing in spending">
						<ReceiptSettings />
						<CaptureSettings />
					</SectionGroup>
					<SectionGroup id="setup" title="Setup">
						<RunSetupAgain />
					</SectionGroup>
					{/* The sidebar has the account button from lg; a phone has it here. */}
					<SectionGroup id="account" title="Account" className="lg:hidden">
						<Card className="flex items-center gap-3 p-(--card-pad) text-sm text-muted-foreground">
							<UserButton
								appearance={{
									elements: { userButtonTrigger: { minWidth: "2.75rem", minHeight: "2.75rem" } },
								}}
							/>
							Manage your sign-in or sign out.
						</Card>
					</SectionGroup>
				</div>
			</PageLayout>
		</>
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
