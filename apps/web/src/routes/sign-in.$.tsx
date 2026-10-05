import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { AuthPage, authHead, clerkAppearance } from "../components/auth-page";
import { IntroVideo } from "../components/intro-video";

export const Route = createFileRoute("/sign-in/$")({
	head: authHead("Sign in"),
	component: () => (
		<AuthPage intro={<IntroVideo className="self-start lg:mt-5" />}>
			<SignIn
				routing="path"
				path="/sign-in"
				signUpUrl="/sign-up"
				fallbackRedirectUrl="/month"
				appearance={clerkAppearance}
			/>
		</AuthPage>
	),
});
