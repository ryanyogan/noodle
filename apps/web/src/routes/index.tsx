import { Button } from "@noodle/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { CenteredHeading, CenteredPage } from "../components/centered-page";

export const Route = createFileRoute("/")({
	component: Landing,
});

function Landing() {
	return (
		<CenteredPage>
			<CenteredHeading title="A calm monthly Plan for your Household.">
				Know where you stand in half a second, and spend a few minutes a week on the rest.
			</CenteredHeading>
			<Button size="lg" className="justify-self-start" asChild>
				<Link to="/month">
					Open Noodle
					<ArrowRight />
				</Link>
			</Button>
		</CenteredPage>
	);
}
