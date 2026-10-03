import { Alert, AlertDescription, AlertTitle } from "@noodle/ui/components/alert";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useHydrated } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import { CenteredHeading, CenteredPage } from "../components/centered-page";
import { ParentNameInput, useEnterHousehold, useFirstName } from "../components/join-household";
import { acceptInviteLink, getInviteLink, type InviteLink } from "../server/invites";

// An invite link (#60): /invite/<token>. Signed out, it goes to sign-up with the email filled in,
// and back here after. Signed in, it asks them to confirm and joins the Household.

export const Route = createFileRoute("/invite/$token")({
	loader: async ({ params }) => {
		const invite = await getInviteLink({ data: { token: params.token } });
		if (invite.state === "open" && !invite.signedIn) {
			throw redirect({ href: `/sign-up?invite=${encodeURIComponent(params.token)}` });
		}
		if (invite.state === "open" && invite.member === "this") throw redirect({ to: "/month" });
		return invite;
	},
	head: () => ({ meta: [{ title: "Join a Household · Noodle" }] }),
	component: InvitePage,
});

function InvitePage() {
	const invite = Route.useLoaderData();
	const { token } = Route.useParams();
	if (invite.state !== "open" || !invite.signedIn) return <LinkProblem invite={invite} />;
	if (invite.member === "other") {
		return (
			<Problem title="You’re already in a Household" signedIn>
				You belong to another Household, so you can’t join {invite.householdName} too.
			</Problem>
		);
	}
	if (!invite.hasRoom) {
		return (
			<Problem title={`${invite.householdName} is full`} signedIn>
				{invite.householdName} already has both Parents, so this invite can’t be used.
			</Problem>
		);
	}
	return (
		<JoinByLink
			token={token}
			householdName={invite.householdName}
			email={invite.email}
			forThem={invite.forThem}
		/>
	);
}

function LinkProblem({ invite }: { invite: InviteLink }) {
	const ask = "Ask the Parent who invited you to invite you again.";
	if (invite.state === "used") {
		return (
			<Problem title="This invite has been used" signedIn={invite.signedIn}>
				Someone has already joined with this link. {ask}
			</Problem>
		);
	}
	if (invite.state === "expired") {
		return (
			<Problem title="This invite has expired" signedIn={invite.signedIn}>
				Invite links work for 7 days. {ask}
			</Problem>
		);
	}
	return (
		<Problem title="This invite link doesn’t work" signedIn={invite.signedIn}>
			It may have been replaced by a newer invite, or copied only in part. {ask}
		</Problem>
	);
}

function Problem({
	title,
	signedIn,
	children,
}: {
	title: string;
	signedIn: boolean;
	children: string | string[];
}) {
	return (
		<CenteredPage>
			<div data-invite-problem className="grid gap-6">
				<CenteredHeading title={title}>{children}</CenteredHeading>
				<Link
					to={signedIn ? "/welcome" : "/sign-in/$"}
					className="text-sm font-medium underline underline-offset-4"
				>
					{signedIn ? "Go to Noodle" : "Sign in to Noodle"}
				</Link>
			</div>
		</CenteredPage>
	);
}

function JoinByLink({
	token,
	householdName,
	email,
	forThem,
}: {
	token: string;
	householdName: string;
	email: string;
	forThem: boolean;
}) {
	const firstName = useFirstName();
	const enterHousehold = useEnterHousehold("/joined");
	const hydrated = useHydrated();
	const [parentId] = useState(() => ulid());
	const join = useMutation({
		mutationFn: (parentName: string) => acceptInviteLink({ data: { token, parentId, parentName } }),
		onSuccess: async (result) => {
			if (result.ok) await enterHousehold();
		},
	});
	const refused = join.data?.ok === false ? join.data.reason : null;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		join.mutate(String(new FormData(event.currentTarget).get("parentName") ?? ""));
	}

	return (
		<CenteredPage>
			<CenteredHeading title={`Join ${householdName}`}>
				You’ve been invited to share a Plan with {householdName}.
			</CenteredHeading>
			{forThem ? null : (
				<Alert>
					<AlertTitle>
						This invite was for <span className="[overflow-wrap:anywhere]">{email}</span>. Join
						anyway?
					</AlertTitle>
					<AlertDescription>
						You’re signed in with a different email. Anyone with the link can join, so only join if
						it was meant for you.
					</AlertDescription>
				</Alert>
			)}
			<Card>
				<form onSubmit={onSubmit} className="grid gap-4 p-(--card-pad)">
					<Field label="Your name" htmlFor="parentName">
						<ParentNameInput firstName={firstName} />
					</Field>
					{refused === "invite-unusable" ? (
						<FormError>
							This invite can no longer be used. Ask the Parent who invited you to invite you again.
						</FormError>
					) : null}
					{refused === "in-another-household" ? (
						<FormError>You already belong to another Household.</FormError>
					) : null}
					{join.isError ? (
						<FormError>We couldn’t add you to this Household. Please try again.</FormError>
					) : null}
					<Button
						type="submit"
						size="lg"
						disabled={!hydrated || join.isPending || join.data?.ok === true || refused !== null}
					>
						{forThem ? `Join ${householdName}` : "Join anyway"}
					</Button>
				</form>
			</Card>
		</CenteredPage>
	);
}
