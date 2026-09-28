import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
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
		<main>
			<h1>{household.name}</h1>
			<h2>Parents</h2>
			<ul>
				{data.parents.map((parent) => (
					<li key={parent.id}>{parent.name}</li>
				))}
			</ul>
			{data.hasAllParents ? (
				<p>Your Household has both Parents.</p>
			) : (
				<InviteOtherParent invitedEmail={data.invitedEmail} />
			)}
		</main>
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
		<section>
			<h2>Invite the other Parent</h2>
			{invitedEmail ? (
				<p>Invited {invitedEmail}. Ask them to sign in to Noodle with that email to join.</p>
			) : (
				<p>
					Noodle doesn't send an email. Once you've invited them, they join by signing in with that
					address.
				</p>
			)}
			<form onSubmit={onSubmit}>
				<label>
					Their email
					<input name="email" type="email" required maxLength={254} autoComplete="off" />
				</label>
				{refused === "own-email" ? (
					<p role="alert">That's your own email. Enter the other Parent's email.</p>
				) : null}
				{refused === "household-full" ? (
					<p role="alert">Your Household already has both Parents.</p>
				) : null}
				{invite.isError ? (
					<p role="alert">We couldn't save that invite. Please try again.</p>
				) : null}
				<button type="submit" disabled={!hydrated || invite.isPending}>
					{invitedEmail ? "Invite someone else" : "Invite"}
				</button>
			</form>
		</section>
	);
}
