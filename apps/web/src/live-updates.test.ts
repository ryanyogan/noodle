import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, test, vi } from "vitest";
import { catchUpOnReview } from "./live-updates";
import { reviewQuery } from "./queries";

// The first connection's catch-up (#82): Review as the page was rendered against Review as it is
// once this screen can hear the Household Agent.

type Queue = { total: number; items: { id: string; guess: null; merchantName: string | null }[] };
const queue = (...ids: string[]): Queue => ({
	total: ids.length,
	items: ids.map((id) => ({ id, guess: null, merchantName: null })),
});

let stop: (() => void) | undefined;
afterEach(() => stop?.());

/** A client whose Review was rendered as `rendered` and now reads `now` from the server. */
function clientWith(rendered: Queue | null, now: Queue) {
	const queryClient = new QueryClient();
	const { queryKey } = reviewQuery();
	const read = vi.fn(async () => now);
	// biome-ignore lint/suspicious/noExplicitAny: a stand-in for the server's Review
	const options = { queryKey, queryFn: read as any, staleTime: Number.POSITIVE_INFINITY };
	if (rendered) queryClient.setQueryData(queryKey, rendered as never);
	// On screen, like the Sidebar's badge: an invalidation refetches it.
	stop = new QueryObserver(queryClient, options).subscribe(() => {});
	return { queryClient, queryKey, read };
}

describe("catching up on Review at the first connection", () => {
	test("the count catches up when categorization finished before this screen could hear it", async () => {
		const { queryClient, queryKey, read } = clientWith(queue(), queue("a", "b"));
		const refetch = vi.fn();
		await catchUpOnReview(queryClient, refetch);
		expect(read).toHaveBeenCalledTimes(1);
		expect(queryClient.getQueryData(queryKey)?.total).toBe(2);
		// What it filed changed spending too.
		expect(refetch).toHaveBeenCalledWith(["months", "for-earlier", "bucket-uses"]);
	});

	test("nothing else is refetched when Review is as the page had it", async () => {
		const { queryClient, read } = clientWith(queue("a"), queue("a"));
		const refetch = vi.fn();
		await catchUpOnReview(queryClient, refetch);
		expect(read).toHaveBeenCalledTimes(1);
		expect(refetch).not.toHaveBeenCalled();
	});

	test("a page that never read Review reads nothing", async () => {
		const queryClient = new QueryClient();
		const refetch = vi.fn();
		await catchUpOnReview(queryClient, refetch);
		expect(refetch).not.toHaveBeenCalled();
	});
});
