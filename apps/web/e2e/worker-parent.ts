import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as base, expect } from "@playwright/test";
import { createTestParent } from "./parents";
import { openContext, type SavedSession, shareSession, signIn } from "./session";
import { timed } from "./timing";

// One Parent per worker, signed in once (#81): signing in cost every test about 2.4 s and four
// calls to Clerk's Backend API, which answers "Too Many Requests" when several CI runs overlap.
// The worker keeps a page signed in as that Parent; each test's `signedInPage` starts a fresh
// context from its cookies, and before each test the Parent's Household and everything in it are
// removed (/api/dev/reset-household), so the test starts with no Household, as a new Parent would.
//
// Not for specs that sign out, sign up, delete or clear the Household's Parent, or need the
// Parent to be new to Clerk: those make their own with `createTestParent`.

/** The worker's Parent: `signedInPage(browser, parent.email)` needs no sign-in. */
export type SharedParent = { email: string; userId: string };

type ClerkInPage = {
	Clerk?: {
		session?: { getToken(options: { skipCache: boolean }): Promise<string | null> } | null;
	};
};

type WorkerSession = { parent: SharedParent; reset: () => Promise<void> };

export const test = base.extend<{ sharedParent: SharedParent }, { workerSession: WorkerSession }>({
	workerSession: [
		async ({ browser }, use, workerInfo) => {
			const parent = await createTestParent();
			const context = await openContext(browser, { baseURL: workerInfo.project.use.baseURL });
			const keeper = await context.newPage();
			await setupClerkTestingToken({ page: keeper });
			await timed("worker-sign-in", async () => {
				await signIn(keeper, parent.email);
				await keeper.waitForLoadState("networkidle");
			});

			/** A session token good for the next minute, from the page that stays signed in. */
			const freshToken = async () => {
				for (let attempt = 0; attempt < 3; attempt++) {
					// A page on its way somewhere else can't answer: ask again once it has settled.
					const token = await keeper
						.evaluate(
							async () =>
								(await (window as unknown as ClerkInPage).Clerk?.session?.getToken({
									skipCache: true,
								})) ?? null,
						)
						.catch(() => null);
					if (token) return token;
					await keeper.waitForTimeout(500);
				}
				return null;
			};

			/**
			 * The session's cookies with a token made just now: the one Clerk leaves in the cookie
			 * lasts a minute, and a worker runs for several. Signed out (the session ended)? Signs
			 * in again.
			 */
			const session = async (): Promise<SavedSession> => {
				let token = await freshToken();
				if (!token) {
					await signIn(keeper, parent.email);
					await keeper.waitForLoadState("networkidle");
					token = await freshToken();
				}
				if (!token) throw new Error("The worker's Parent could not be signed in");
				const fresh = token;
				const saved = await context.storageState();
				return {
					...saved,
					cookies: saved.cookies.map((cookie) =>
						/^__session(_|$)/.test(cookie.name) ? { ...cookie, value: fresh } : cookie,
					),
				};
			};

			const reset = () =>
				timed("household-reset", async () => {
					const response = await keeper.request.post("/api/dev/reset-household", {
						data: { clerkUserId: parent.userId },
					});
					expect(response.ok(), await response.text()).toBe(true);
				});

			shareSession(parent.email, session);
			await use({ parent: { email: parent.email, userId: parent.userId }, reset });
			shareSession(parent.email, null);
			await context.close();
			await parent.remove();
		},
		{ scope: "worker" },
	],
	sharedParent: async ({ workerSession }, use) => {
		await workerSession.reset();
		await use(workerSession.parent);
	},
});
