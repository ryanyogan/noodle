import { createFileRoute } from "@tanstack/react-router";

// `/plan/$month`: the Plan's first page with no Bucket open. The page itself is the layout above
// (`plan.$month._home.tsx`), which stays mounted while a Bucket opens and closes over it.
export const Route = createFileRoute("/_authed/_household/plan/$month/_home/")({
	component: () => null,
});
