import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuthPage, authHead, clerkAppearance } from "../components/auth-page";
import { getInviteForSignUp } from "../server/invites";

export const Route = createFileRoute("/sign-up/$")({
	// An invite link (#60) is /sign-up?invite=<invite ID>. Anything else there is ignored.
	validateSearch: z.object({ invite: z.string().max(64).optional().catch(undefined) }),
	loaderDeps: ({ search }) => ({ invite: search.invite }),
	// A bad or used invite, or a lookup that fails, is plain sign-up.
	loader: ({ deps }) =>
		deps.invite ? getInviteForSignUp({ data: { invite: deps.invite } }).catch(() => null) : null,
	head: authHead("Create your account"),
	component: SignUpPage,
});

function SignUpPage() {
	const invite = Route.useLoaderData();
	return (
		<AuthPage>
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
					signInUrl="/sign-in"
					fallbackRedirectUrl="/welcome"
					appearance={clerkAppearance}
					initialValues={invite ? { emailAddress: invite.email } : undefined}
				/>
			</div>
		</AuthPage>
	);
}
