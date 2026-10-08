import { createFileRoute, linkOptions } from "@tanstack/react-router";
import { SectionLayout, type SectionTab } from "../../../components/section-layout";

// Household settings (issue 157): the Household's name over three tabs that stay put, each a page
// with an address of its own: Settings (what a Parent sets), Logs (the Log: every change on
// record) and Changelog (what changed in Noodle itself).
export const Route = createFileRoute("/_authed/_household/household")({
	component: HouseholdLayout,
});

const tabs: SectionTab[] = [
	{ label: "Settings", link: linkOptions({ to: "/household" }) },
	{ label: "Logs", link: linkOptions({ to: "/household/logs" }) },
	{ label: "Changelog", link: linkOptions({ to: "/household/changelog" }) },
];

function HouseholdLayout() {
	const { household } = Route.useRouteContext();
	return (
		<SectionLayout
			eyebrow="Household settings"
			title={household.name}
			tabsLabel="Household settings pages"
			tabs={tabs}
		/>
	);
}
