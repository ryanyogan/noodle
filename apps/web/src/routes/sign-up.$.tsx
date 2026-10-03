import { SignUp } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { AuthPage, authHead, clerkAppearance } from "../components/auth-page";

export const Route = createFileRoute("/sign-up/$")({
	head: authHead("Create your account"),
	component: () => (
		<AuthPage>
			{/* A new Parent has no Household yet: /welcome creates one, or joins the one they're invited to. */}
			<SignUp
				routing="path"
				path="/sign-up"
				signInUrl="/sign-in"
				fallbackRedirectUrl="/welcome"
				appearance={clerkAppearance}
			/>
		</AuthPage>
	),
});
