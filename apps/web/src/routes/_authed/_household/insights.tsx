import { Badge } from "@noodle/ui/components/badge";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, linkOptions, useMatchRoute } from "@tanstack/react-router";
import { SectionLayout, type SectionTab } from "../../../components/section-layout";
import { perkSourcesQuery } from "../../../queries";

// Insights and the Perks they rest on: each page has its own header (Credit card perks has its own
// Sidebar entry too), and two tabs stay put below it as the way between them. The Perks tab says
// how many Perk Sources wait to be confirmed.
export const Route = createFileRoute("/_authed/_household/insights")({
	loader: ({ context }) => context.queryClient.ensureQueryData(perkSourcesQuery()),
	component: InsightsLayout,
});

function InsightsLayout() {
	const matchRoute = useMatchRoute();
	const onPerks = Boolean(matchRoute({ to: "/insights/perks" }));
	const toConfirm = useSuspenseQuery(perkSourcesQuery()).data.filter(
		(source) => source.status === "suggested",
	).length;
	const tabs: SectionTab[] = [
		{ label: "Insights", link: linkOptions({ to: "/insights" }) },
		{
			label: "Perks",
			link: linkOptions({ to: "/insights/perks" }),
			badge:
				toConfirm > 0 ? (
					<Badge variant="count">
						{toConfirm}
						<span className="sr-only"> to confirm</span>
					</Badge>
				) : null,
		},
	];
	return (
		<SectionLayout
			eyebrow="Understand"
			title={onPerks ? "Credit card perks" : "Insights"}
			tabsLabel="Insights pages"
			tabs={tabs}
		/>
	);
}
