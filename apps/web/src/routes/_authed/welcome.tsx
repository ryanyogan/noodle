import { useUser } from "@clerk/tanstack-react-start";
import type { InviteToJoin } from "@noodle/db";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import { CenteredHeading, CenteredPage } from "../../components/centered-page";
import { viewerQuery } from "../../queries";
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

/**
 * After joining or creating, re-run the route guards so they see the new Household. A new
 * Household goes on to the get-started wizard; a Parent joining one skips it for a short look at what's there.
 */
function useEnterHousehold(to: "/setup" | "/joined") {
	const router = useRouter();
	const queryClient = useQueryClient();
	return async () => {
		await queryClient.invalidateQueries({ queryKey: viewerQuery().queryKey, refetchType: "none" });
		await router.invalidate();
		await router.navigate({ to });
	};
}

function CreateHousehold() {
	const firstName = useFirstName();
	const enterHousehold = useEnterHousehold("/setup");
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
		<CenteredPage>
			<CenteredHeading title="Welcome to Noodle">
				Start by naming your Household. You can invite the other Parent next.
			</CenteredHeading>
			<Card>
				<form onSubmit={onSubmit} className="grid gap-4 p-(--card-pad)">
					<Field
						label="Household name"
						htmlFor="householdName"
						hint="Only you and the other Parent see this."
					>
						<Input
							id="householdName"
							name="householdName"
							required
							maxLength={80}
							autoComplete="off"
							placeholder="e.g. The Rinks"
						/>
					</Field>
					<Field label="Your name" htmlFor="parentName">
						<ParentNameInput firstName={firstName} />
					</Field>
					{create.isError ? (
						<FormError>We couldn’t create your Household. Please try again.</FormError>
					) : null}
					<Button
						type="submit"
						size="lg"
						disabled={!hydrated || create.isPending || create.isSuccess}
					>
						Create Household
					</Button>
				</form>
			</Card>
		</CenteredPage>
	);
}

function JoinHousehold({ invite, onStartOwn }: { invite: InviteToJoin; onStartOwn: () => void }) {
	const firstName = useFirstName();
	const enterHousehold = useEnterHousehold("/joined");
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
		<CenteredPage>
			<CenteredHeading title={`Join ${invite.householdName}`}>
				You’ve been invited to share a Plan with {invite.householdName}.
			</CenteredHeading>
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
						Join {invite.householdName}
					</Button>
				</form>
			</Card>
			<div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
				Not expecting this invite?
				<Button
					type="button"
					variant="link"
					className="h-auto px-0 font-medium text-foreground underline underline-offset-4"
					onClick={onStartOwn}
					disabled={!hydrated || join.isPending}
				>
					Start my own Household instead
				</Button>
			</div>
		</CenteredPage>
	);
}

/**
 * "Your name", started with Clerk's first name once it loads (after hydration) - unless the Parent
 * has typed in it already, so a late load never overwrites what they typed.
 */
function ParentNameInput({ firstName }: { firstName: string | undefined }) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (firstName && input.current && input.current.value === "") input.current.value = firstName;
	}, [firstName]);
	return (
		<Input
			ref={input}
			id="parentName"
			name="parentName"
			required
			maxLength={80}
			autoComplete="given-name"
			defaultValue={firstName}
		/>
	);
}

/** The signed-in user's first name in Clerk, to start "Your name" with; undefined until Clerk loads. */
function useFirstName(): string | undefined {
	const { user } = useUser();
	return user?.firstName?.trim() || undefined;
}
