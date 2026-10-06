import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AuthPage, authHead, clerkAppearance } from "../components/auth-page";
import { IntroVideo } from "../components/intro-video";
import { getInviteForSignUp } from "../server/invites";

export const Route = createFileRoute("/sign-up/$")({
	// An invite link (#60) sends someone signed out to /sign-up?invite=<token>. Anything else there is ignored.
	validateSearch: z.object({ invite: z.string().max(64).optional().catch(undefined) }),
	loaderDeps: ({ search }) => ({ invite: search.invite }),
	// A bad or used invite, or a lookup that fails, is plain sign-up.
	loader: ({ deps }) =>
		deps.invite ? getInviteForSignUp({ data: { invite: deps.invite } }).catch(() => null) : null,
	head: authHead("Create your account"),
	component: SignUpPage,
});

function SignUpPage() {
	const loaded = Route.useLoaderData();
	// Clerk's next step (/sign-up/verify-email-address) drops ?invite, so keep the first one: the
	// heading stays, and signing up still goes back to the invite.
	const [first] = useState(loaded);
	const invite = loaded ?? first;
	const back = invite ? `/invite/${invite.token}` : null;
	return (
		// The same way in to the one-minute intro as sign-in has (issue 74).
		<AuthPage intro={<IntroVideo className="self-start lg:mt-5" />}>
			<div className="flex w-full max-w-100 flex-col items-center gap-4">
				{invite ? (
					<p className="text-center text-lg font-semibold tracking-[-0.02em]" data-invite>
						Join {invite.householdName} on Noodle
					</p>
				) : null}
				{/* A new Parent has no Household yet: /welcome creates one, or joins the one they're invited to. */}
				<SignUp
					routing="path"
					path="/sign-up"
					signInUrl={back ? `/sign-in?redirect_url=${encodeURIComponent(back)}` : "/sign-in"}
					fallbackRedirectUrl="/welcome"
					forceRedirectUrl={back ?? undefined}
					appearance={clerkAppearance}
					initialValues={invite ? { emailAddress: invite.email } : undefined}
				/>
			</div>
		</AuthPage>
	);
}
