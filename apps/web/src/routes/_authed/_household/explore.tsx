import { Button } from "@noodle/ui/components/button";
import { createFileRoute, Link, linkOptions, useSearch } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { SectionLayout, type SectionTab } from "../../../components/section-layout";

// Explore's pages: trying changes on the Plan, the Checks, and the saved Scenarios. The header
// and the tabs live here, once; each page renders only what's below them, and reads its own
// search (`?lever=`, `?kind=`, `?compare=`).
export const Route = createFileRoute("/_authed/_household/explore")({
	staticData: { wide: true },
	component: ExploreLayout,
});

/** The tabs, keeping the horizon (`?years=`) on the pages that look ahead by it. */
const exploreTabs = (years: 1 | 2 | 3 | 5 | undefined): SectionTab[] => {
	const search = { years };
	return [
		{ label: "Explore", link: linkOptions({ to: "/explore", search }) },
		{ label: "Can we afford it?", link: linkOptions({ to: "/explore/afford" }) },
		{ label: "Scenarios", link: linkOptions({ to: "/explore/scenarios", search }) },
	];
};

function ExploreLayout() {
	const { years } = useSearch({ strict: false });
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
			tabs={exploreTabs(years)}
		/>
	);
}
