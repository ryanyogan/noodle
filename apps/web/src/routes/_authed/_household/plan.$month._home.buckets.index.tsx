import { createFileRoute, redirect } from "@tanstack/react-router";
import { bucketsListRedirect } from "../../../plan-pages";

// The Buckets list had a tab and an address of its own; it is now on the Plan's first page
// (issue 109). The old address, in bookmarks and old links, opens that page at its Buckets.
export const Route = createFileRoute("/_authed/_household/plan/$month/_home/buckets/")({
	beforeLoad: ({ params }) => {
		throw redirect({ ...bucketsListRedirect(params.month), search: true, replace: true });
	},
});
