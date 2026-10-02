import { SignIn } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { CenteredPage } from "../components/centered-page";

// Clerk's fields are 13 px, and iOS zooms the page into any field under 16 px when it gets focus.
// So on phones they're 16 px, as our own Input is (text-base md:text-sm).
const phoneSized = { fontSize: "1rem", "@media (min-width: 48rem)": { fontSize: "0.8125rem" } };
// And below lg its buttons and fields are 44 px tall, as our own controls are (COMPONENTS.md).
const phoneTall = { "@media (max-width: 63.99rem)": { minHeight: "2.75rem" } };
const appearance = {
	elements: {
		formFieldInput: { ...phoneSized, ...phoneTall },
		otpCodeFieldInput: phoneSized,
		formButtonPrimary: phoneTall,
		socialButtonsBlockButton: phoneTall,
	},
};

export const Route = createFileRoute("/sign-in/$")({
	component: () => (
		<CenteredPage>
			<SignIn routing="path" path="/sign-in" fallbackRedirectUrl="/month" appearance={appearance} />
		</CenteredPage>
	),
});
