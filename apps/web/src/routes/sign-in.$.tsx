import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { CenteredPage } from "../components/centered-page";

// Clerk's fields are 13 px, and iOS zooms the page into any field under 16 px when it gets focus.
// So on phones they're 16 px, as our own Input is (text-base md:text-sm).
const phoneSized = { fontSize: "1rem", "@media (min-width: 48rem)": { fontSize: "0.8125rem" } };
const appearance = {
	elements: { formFieldInput: phoneSized, otpCodeFieldInput: phoneSized },
};

export const Route = createFileRoute("/sign-in/$")({
	component: () => (
		<CenteredPage>
			<SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/month" appearance={appearance} />
		</CenteredPage>
	),
});
