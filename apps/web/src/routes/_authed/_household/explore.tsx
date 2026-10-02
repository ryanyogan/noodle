import { Button } from "@noodle/ui/components/button";
import { createFileRoute, Link, linkOptions } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { SectionLayout, type SectionTab } from "../../../components/section-layout";

// Explore's pages: trying changes on the Plan, the Checks, and the saved Scenarios. The header
// and the tabs live here, once; each page renders only what's below them, and reads its own
// search (`?lever=`, `?kind=`, `?compare=`).
export const Route = createFileRoute("/_authed/_household/explore")({
	component: ExploreLayout,
});

const EXPLORE_TABS: SectionTab[] = [
	{ label: "Explore", link: linkOptions({ to: "/explore" }) },
	{ label: "Can we afford it?", link: linkOptions({ to: "/explore/afford" }) },
	{ label: "Scenarios", link: linkOptions({ to: "/explore/scenarios" }) },
];

function ExploreLayout() {
	return (
		<SectionLayout
			title="Explore"
			leading={
				<Button variant="ghost" size="icon" asChild className="lg:hidden">
					<Link to="/goals" aria-label="Back to Goals">
						<ChevronLeft className="size-5" />
					</Link>
				</Button>
			}
			tabsLabel="Explore pages"
			tabs={EXPLORE_TABS}
		/>
	);
}
