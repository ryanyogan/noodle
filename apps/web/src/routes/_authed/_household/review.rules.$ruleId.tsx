import { canAssign } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { DetailHeader, DetailPager, DetailPending } from "../../../components/master-detail";
import { RuleForm } from "../../../components/rule-form";
import { membersQuery, monthQuery, rulesQuery } from "../../../queries";

/**
 * A Rule picked from the Rules list: its editor in the panel from the right from lg (issue 107),
 * a page with Back on a phone. Saving or deleting goes back to the list.
 */
export const Route = createFileRoute("/_authed/_household/review/rules/$ruleId")({
	pendingComponent: DetailPending,
	component: RulePane,
});

function RulePane() {
	const { ruleId } = Route.useParams();
	const { current, parentId } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const rules = useSuspenseQuery(rulesQuery()).data;
	const members = useSuspenseQuery(membersQuery()).data;
	const commitments = useSuspenseQuery(monthQuery(current)).data.plan.commitments;
	const buckets = useSuspenseQuery(monthQuery(current)).data.plan.buckets.filter((b) =>
		canAssign(b, parentId),
	);
	const rule = rules.find((r) => r.id === ruleId);
	const back = (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/review/rules" aria-label="Back to Rules">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
	if (!rule) {
		return (
			<>
				<DetailHeader inPanel title="Rule" leading={back} />
				<p className="text-sm text-muted-foreground">This Rule isn’t here any more.</p>
			</>
		);
	}
	return (
		<div className="max-w-xl">
			<DetailHeader
				inPanel
				eyebrow={rule.private ? "Rule · only you see it" : "Rule"}
				title={`“${rule.pattern}”`}
				leading={back}
				pager={
					<DetailPager
						ids={rules.map((r) => r.id)}
						id={rule.id}
						noun="Rule"
						link={(id) => ({ to: "/review/rules/$ruleId", params: { ruleId: id } })}
					/>
				}
			/>
			<RuleForm
				key={rule.id}
				inline
				rule={rule}
				buckets={buckets}
				commitments={commitments}
				members={members}
				onDone={() => void navigate({ to: "/review/rules" })}
			/>
		</div>
	);
}
