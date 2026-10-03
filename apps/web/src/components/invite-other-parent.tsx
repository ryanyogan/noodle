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
	const [link, setLink] = useState<{ email: string; url: string } | null>(null);
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	// A fresh ID per attempt; reused by a retry of the same attempt.
	const [inviteId, setInviteId] = useState(() => ulid());
	const invite = useMutation({
		mutationFn: (email: string) => inviteParent({ data: { inviteId, email } }),
		onSuccess: async (result) => {
			if (result.ok) {
				setInviteId(ulid());
				setLink({
					email: result.email,
					url: new URL(result.linkPath, window.location.origin).href,
				});
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
					<div className="grid gap-1">
						<div className="flex flex-wrap items-center gap-2 font-medium">
							Invited {invitedEmail}
							<Badge variant="pace" dot>
								Waiting
							</Badge>
						</div>
						<p className="text-muted-foreground">
							{link?.email === invitedEmail
								? "Send them this link. It works for 7 days."
								: "They can join by signing in to Noodle with that email. Lost the link? Invite them again for a new one."}
						</p>
					</div>
				) : (
					<p className="self-center text-muted-foreground">
						Once you’ve invited them, you’ll get a link to send them. It works for 7 days.
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
