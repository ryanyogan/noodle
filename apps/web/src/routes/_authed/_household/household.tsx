import { UserButton } from "@clerk/tanstack-react-start";
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
import { Check, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import { householdParentsQuery } from "../../../queries";
import { inviteParent } from "../../../server/invites";

export const Route = createFileRoute("/_authed/_household/household")({
	loader: ({ context }) => context.queryClient.ensureQueryData(householdParentsQuery()),
	component: HouseholdPage,
});

function HouseholdPage() {
	const { household } = Route.useRouteContext();
	const { data } = useSuspenseQuery(householdParentsQuery());
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
