import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Tile } from "@noodle/ui/components/tile";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import { householdParentsQuery } from "../queries";
import { inviteParent } from "../server/invites";
import { CopyRow } from "./capture-settings";

// Inviting the other Parent by email, on Household and in the get-started wizard (#53). It is its
// own form, so it can't sit inside another one.

export function InviteOtherParent({ invitedEmail }: { invitedEmail: string | null }) {
	// The invite link, shown only right after inviting: Noodle keeps just a hash of it (#60).
	// `sent` says whether the email went out; Copy link is the second way, or the only one.
	const [link, setLink] = useState<{ email: string; url: string; sent: boolean } | null>(null);
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	// A fresh ID per attempt; reused by a retry of the same attempt.
	const [inviteId, setInviteId] = useState(() => ulid());
	const invite = useMutation({
		mutationFn: (email: string) => inviteParent({ data: { inviteId, email } }),
		onSuccess: async (result) => {
			if (result.ok) {
				setInviteId(ulid());
				setLink({ email: result.email, url: result.link, sent: result.sent });
			}
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
					// min-w-0 and wrapping anywhere, so a long email can't push past a phone's edge.
					<div className="grid min-w-0 gap-1 [overflow-wrap:anywhere]">
						<div className="flex flex-wrap items-center gap-2 font-medium">
							Invited {invitedEmail}
							<Badge variant="pace" dot>
								Waiting
							</Badge>
						</div>
						{link?.email === invitedEmail ? (
							link.sent ? (
								<p className="text-muted-foreground">
									We sent an invite to {invitedEmail}. The link in it works for 7 days. You can also
									copy it and send it yourself.
								</p>
							) : (
								<FormError>Couldn’t send. Copy the link instead. It works for 7 days.</FormError>
							)
						) : (
							<p className="text-muted-foreground">
								They can join from the link we emailed them, or by signing in to Noodle with that
								email. Lost the link? Invite them again for a new one.
							</p>
						)}
					</div>
				) : (
					<p className="self-center text-muted-foreground">
						We’ll email them a link to join your Household. It works for 7 days.
					</p>
				)}
			</div>
			{invitedEmail && link?.email === invitedEmail ? (
				<div className="border-b p-(--card-pad)">
					<CopyRow label="Invite link" value={link.url} copyLabel="Copy link" />
				</div>
			) : null}
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
