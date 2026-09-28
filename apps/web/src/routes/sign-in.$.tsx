import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in/$")({
	component: () => (
		<main>
			<SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/month" />
		</main>
	),
});
