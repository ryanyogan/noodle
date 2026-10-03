import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `_authed` asks who's signed in afresh only on entering the authed app; staying in it and
// preloading a link reuse the cached answer, so a click never waits on that round trip (#55).
const getViewer = vi.fn();
vi.mock("./queries", () => ({
	viewerQuery: () => ({ queryKey: ["viewer"], queryFn: () => getViewer() }),
}));

const { Route } = await import("./routes/_authed");

type Cause = "enter" | "stay" | "preload";
type BeforeLoad = (options: {
	location: { href: string };
	cause: Cause;
	context: { queryClient: QueryClient };
}) => Promise<unknown>;
const beforeLoad = Route.options.beforeLoad as unknown as BeforeLoad;

const signedIn = { signedIn: true, household: { id: "h1" }, invite: null, parentId: "p1" };
let queryClient: QueryClient;
const run = (cause: Cause, href = "/month") =>
	beforeLoad({ location: { href }, cause, context: { queryClient } });

beforeEach(() => {
	getViewer.mockReset().mockResolvedValue(signedIn);
	queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
});

describe("_authed's viewer", () => {
	it("is asked for on entering, and reused while staying and on preloads", async () => {
		expect(await run("enter")).toEqual({ household: { id: "h1" }, invite: null, parentId: "p1" });
		expect(getViewer).toHaveBeenCalledTimes(1);
		await run("stay");
		await run("preload");
		await run("preload");
		expect(getViewer).toHaveBeenCalledTimes(1);
	});

	it("is asked for afresh on entering again, even with a fresh cached answer", async () => {
		await run("enter");
		await run("enter");
		expect(getViewer).toHaveBeenCalledTimes(2);
	});

	it("is asked for on a preload when nothing is cached yet", async () => {
		await run("preload");
		expect(getViewer).toHaveBeenCalledTimes(1);
	});

	it("sends a signed-out visitor to sign in, back to where they were going", async () => {
		getViewer.mockResolvedValue({ signedIn: false });
		await expect(run("enter", "/plan/2026-10?x=1")).rejects.toMatchObject({
			options: { href: "/sign-in?redirect_url=%2Fplan%2F2026-10%3Fx%3D1" },
		});
	});

	it("has no Parent before there's a Household", async () => {
		getViewer.mockResolvedValue({ ...signedIn, household: null });
		expect(await run("enter")).toMatchObject({ household: null, parentId: null });
	});
});
