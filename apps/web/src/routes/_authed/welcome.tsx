import type { InviteToJoin } from "@noodle/db";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import { acceptInvite } from "../../server/invites";
import { createHousehold } from "../../server/session";

export const Route = createFileRoute("/_authed/welcome")({
	beforeLoad: ({ context }) => {
		if (context.household) throw redirect({ to: "/month" });
	},
	component: Welcome,
});

function Welcome() {
	const { invite } = Route.useRouteContext();
	// Someone invited by mistake can still start their own Household.
	const [startOwn, setStartOwn] = useState(false);
	return invite && !startOwn ? (
		<JoinHousehold invite={invite} onStartOwn={() => setStartOwn(true)} />
	) : (
		<CreateHousehold />
	);
}

/** After joining or creating, re-run the route guards so they see the new Household. */
function useEnterHousehold() {
	const router = useRouter();
	return async () => {
		await router.invalidate();
		await router.navigate({ to: "/month" });
	};
}

function CreateHousehold() {
	const enterHousehold = useEnterHousehold();
	// Until hydrated, a click would fall through to a native GET submit.
	const hydrated = useHydrated();
	// Client-generated IDs make a retried submit create one Household.
	const [ids] = useState(() => ({ householdId: ulid(), parentId: ulid() }));
	const create = useMutation({
		mutationFn: (form: FormData) =>
			createHousehold({
				data: {
					...ids,
					householdName: String(form.get("householdName") ?? ""),
					parentName: String(form.get("parentName") ?? ""),
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
			}),
		onSuccess: enterHousehold,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		create.mutate(new FormData(event.currentTarget));
	}

	return (
		<main>
			<h1>Welcome to Noodle</h1>
			<p>Start by naming your Household. You can invite the other Parent next.</p>
			<form onSubmit={onSubmit}>
				<label>
					Household name
					<input name="householdName" required maxLength={80} autoComplete="off" />
				</label>
				<label>
					Your name
					<input name="parentName" required maxLength={80} autoComplete="given-name" />
				</label>
				{create.isError ? (
					<p role="alert">We couldn't create your Household. Please try again.</p>
				) : null}
				<button type="submit" disabled={!hydrated || create.isPending || create.isSuccess}>
					Create Household
				</button>
			</form>
		</main>
	);
}

function JoinHousehold({ invite, onStartOwn }: { invite: InviteToJoin; onStartOwn: () => void }) {
	const enterHousehold = useEnterHousehold();
	const hydrated = useHydrated();
	const [parentId] = useState(() => ulid());
	const join = useMutation({
		mutationFn: (parentName: string) =>
			acceptInvite({ data: { inviteId: invite.inviteId, parentId, parentName } }),
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
		<main>
			<h1>Welcome to Noodle</h1>
			<p>You've been invited to share a Plan with {invite.householdName}.</p>
			<form onSubmit={onSubmit}>
				<label>
					Your name
					<input name="parentName" required maxLength={80} autoComplete="given-name" />
				</label>
				{refused === "invite-unusable" ? (
					<p role="alert">
						This invite can no longer be used. Ask the Parent who invited you to invite you again.
					</p>
				) : null}
				{refused === "in-another-household" ? (
					<p role="alert">You already belong to another Household.</p>
				) : null}
				{join.isError ? (
					<p role="alert">We couldn't add you to this Household. Please try again.</p>
				) : null}
				<button
					type="submit"
					disabled={!hydrated || join.isPending || join.data?.ok === true || refused !== null}
				>
					Join {invite.householdName}
				</button>
			</form>
			<p>Not expecting this invite?</p>
			<button type="button" onClick={onStartOwn} disabled={!hydrated || join.isPending}>
				Start my own Household instead
			</button>
		</main>
	);
}
