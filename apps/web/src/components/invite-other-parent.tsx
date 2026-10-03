import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@noodle/ui/components/alert-dialog";
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
import { shortDayAt } from "../format";
import { inviteTiming } from "../invite-timing";
import { householdParentsQuery } from "../queries";
import { cancelInvite, inviteParent, resendInvite } from "../server/invites";
import { CopyRow } from "./capture-settings";

// Inviting the other Parent by email, on Household and in the get-started wizard (#53). It is its
// own form, so it can't sit inside another one.

/** The Household's open invite: who to, when it was last sent and when it runs out (epoch ms). */
export type OpenInvite = { email: string; sentAt: number; expiresAt: number | null };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const DAILY_LIMIT = "You’ve sent 5 invites today. You can send another tomorrow.";

export function InviteOtherParent({ invite: open }: { invite: OpenInvite | null }) {
	// The invite link, shown only right after inviting or resending: Noodle keeps just a hash of
	// it (#60). `sent` says whether the email went out; Copy link is the second way, or the only one.
	const [link, setLink] = useState<{ email: string; url: string; sent: boolean } | null>(null);
	const [confirmCancel, setConfirmCancel] = useState(false);
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: householdParentsQuery().queryKey });
	// A fresh ID per attempt; reused by a retry of the same attempt.
	const [inviteId, setInviteId] = useState(() => ulid());
	const invite = useMutation({
		mutationFn: (email: string) => inviteParent({ data: { inviteId, email } }),
		onSuccess: async (result) => {
			if (result.ok) {
				setInviteId(ulid());
				setLink({ email: result.email, url: result.link, sent: result.sent });
			}
			await refresh();
		},
	});
	const resend = useMutation({
		mutationFn: () => resendInvite(),
		onSuccess: async (result) => {
			if (result.ok) setLink({ email: result.email, url: result.link, sent: result.sent });
			await refresh();
		},
	});
	const cancel = useMutation({
		mutationFn: () => cancelInvite(),
		onSuccess: async () => {
			setLink(null);
			resend.reset();
			await refresh();
		},
	});
	const refused = invite.data?.ok === false ? invite.data.reason : null;
	const resendRefused = resend.data?.ok === false ? resend.data.reason : null;
	const timing = open ? inviteTiming(open, Date.now()) : null;
	const fresh = open !== null && link?.email === open.email;

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
				{open && timing ? (
					// min-w-0 and wrapping anywhere, so a long email can't push past a phone's edge.
					<div className="grid min-w-0 gap-1 [overflow-wrap:anywhere]">
						<div className="flex flex-wrap items-center gap-2 font-medium">
							Invited {open.email}
							{timing.state === "expired" ? (
								<Badge variant="over" dot>
									Ran out
								</Badge>
							) : (
								<Badge variant="pace" dot>
									Waiting
								</Badge>
							)}
						</div>
						{timing.state === "open" ? (
							<p className="text-muted-foreground">
								{capitalize(timing.expires ? `${timing.sent} · ${timing.expires}` : timing.sent)}
							</p>
						) : null}
						{fresh && link ? (
							link.sent ? (
								<p className="text-muted-foreground">
									We sent an invite to {open.email}. The link in it works for 7 days. You can also
									copy it and send it yourself.
								</p>
							) : (
								<FormError>Couldn’t send. Copy the link instead. It works for 7 days.</FormError>
							)
						) : timing.state === "expired" ? (
							<p className="text-muted-foreground" suppressHydrationWarning>
								The invite to {open.email} ran out on {shortDayAt(timing.ranOutAt)}. Resend it for a
								new link that works for 7 days.
							</p>
						) : (
							<p className="text-muted-foreground">
								They can join from the link we emailed them, or by signing in to Noodle with that
								email. Lost the link? Resend it for a new one. The old one then stops working.
							</p>
						)}
					</div>
				) : (
					<p className="self-center text-muted-foreground">
						We’ll email them a link to join your Household. It works for 7 days.
					</p>
				)}
			</div>
			{fresh && link ? (
				<div className="border-b p-(--card-pad)">
					<CopyRow label="Invite link" value={link.url} copyLabel="Copy link" />
				</div>
			) : null}
			{open ? (
				<div className="grid gap-2 border-b p-(--card-pad)">
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							disabled={!hydrated || resend.isPending || cancel.isPending}
							onClick={() => resend.mutate()}
						>
							Resend
						</Button>
						<Button
							variant="ghost"
							disabled={!hydrated || cancel.isPending}
							onClick={() => setConfirmCancel(true)}
						>
							Cancel invite
						</Button>
					</div>
					{resendRefused === "too-soon" ? <FormError>You can resend in a minute.</FormError> : null}
					{resendRefused === "daily-limit" ? <FormError>{DAILY_LIMIT}</FormError> : null}
					{resend.isError || cancel.isError ? (
						<FormError>That didn’t work. Please try again.</FormError>
					) : null}
					<AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Cancel the invite?</AlertDialogTitle>
								<AlertDialogDescription className="[overflow-wrap:anywhere]">
									The link we sent {open.email} will stop working. You can invite them again any
									time.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Keep it</AlertDialogCancel>
								<AlertDialogAction onClick={() => cancel.mutate()}>Cancel invite</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
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
							{open ? "Invite someone else" : "Invite"}
						</Button>
					</div>
				</Field>
				{refused === "own-email" ? (
					<FormError>That’s your own email. Enter the other Parent’s email.</FormError>
				) : null}
				{refused === "daily-limit" ? <FormError>{DAILY_LIMIT}</FormError> : null}
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
