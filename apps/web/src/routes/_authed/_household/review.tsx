import { Badge } from "@noodle/ui/components/badge";
import { createFileRoute, linkOptions } from "@tanstack/react-router";
import { SectionLayout, type SectionTab } from "../../../components/section-layout";
import { useReviewWaiting } from "../../../money-in";
import { reviewQuery } from "../../../queries";

// Review and its Rules: one header and two tabs that stay put, with the page below them. The
// Review tab says how many are waiting.
export const Route = createFileRoute("/_authed/_household/review")({
	loader: ({ context }) => context.queryClient.ensureQueryData(reviewQuery()),
	component: ReviewLayout,
});

function ReviewLayout() {
	const total = useReviewWaiting();
	const tabs: SectionTab[] = [
		{
			label: "Review",
			link: linkOptions({ to: "/review" }),
			badge:
				total > 0 ? (
					<Badge variant="count" aria-label={`${total} to review`}>
						{total}
					</Badge>
				) : null,
		},
		{ label: "Rules", link: linkOptions({ to: "/review/rules" }) },
	];
	return (
		<SectionLayout eyebrow="Transactions" title="Review" tabsLabel="Review pages" tabs={tabs} />
	);
}
