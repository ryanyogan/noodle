import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthPage, authHead, clerkAppearance } from "../components/auth-page";
import { IntroVideo } from "../components/intro-video";

export const Route = createFileRoute("/sign-in/$")({
	head: authHead("Sign in"),
	component: () => (
		<AuthPage
			intro={
				<>
					<IntroVideo className="self-start lg:mt-5" />
					{/* The Docs are open to anyone (issue 126), so they can be read before signing in. */}
					<Link
						to="/docs"
						className="self-start rounded-sm py-3 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
					>
						How Noodle works
					</Link>
				</>
			}
		>
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
