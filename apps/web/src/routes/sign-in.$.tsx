import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { CenteredPage } from "../components/centered-page";

export const Route = createFileRoute("/sign-in/$")({
	component: () => (
		<CenteredPage>
			<SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/month" />
		</CenteredPage>
	),
});
