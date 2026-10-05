import { createClerkClient } from "@clerk/backend";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	request,
	test,
} from "@playwright/test";
import { ulid } from "ulid";
import { clerkRetry, deleteClerkUser } from "./clerk-retry";
import { openContext, type SavedSession, shareSession, signIn } from "./session";
import { timed } from "./timing";

// Test Parents are reused (#108). Each worker has a small pool of long-lived Clerk users; a test
// that asks for a Parent gets one of them with no Household, as a new Parent would have, and
// gives it back when it is done. Making and deleting a Clerk user per test, and signing each one
// in, spent the development instance's rate limits (100 Backend requests / 10 s for every CI run
// together, 5 sign-ins / 10 s per runner) and its 100-user cap.
//
// - Who: `e2e-pool-<pool>-w<worker>-p<slot>+clerk_test@example.com`. `<pool>` is E2E_POOL (the CI
//   job's shard: "s1"…"s6", shared by the chromium and phone jobs) or "local"; `<worker>` is
//   Playwright's parallelIndex, which a restarted worker keeps. So at most 6 shards x 3 workers
//   x POOL_SIZE users exist, however many runs there are.
// - Kept across runs, on purpose. A user is looked up by address and made only when missing, and
//   never deleted. Two runs at once may use the same user: each signs in with its own session
//   from its own browser, and a Household lives in the runner's local D1, keyed by the Clerk
//   user's id, so they share nothing but the Clerk user, which no test changes. Addresses unique
//   to a run would instead put a whole pool on the instance for every run in flight.
// - Signed in once per worker, not kept across runs: the worker keeps one page signed in as each
//   pooled Parent (made on first use), and `signedInPage` starts every test's context from its
//   cookies with a session token made in the last 25 seconds.
// - A clean slate: before a Parent is handed out, and again when it is given back,
//   /api/dev/reset-household deletes the Household it is in through the Delete Household steps
//   (banks, the Household Agent's storage and alarm, files, rows) and the emails "sent" to its
//   address. The pages `signedInPage` opened for it are closed first, so none follows the next
//   test's Household.
// - `createTestParent({ fresh: true })` still makes a brand-new Clerk user, deleted by `remove`:
//   for a test that signs out (that ends the worker's session too) or needs a user Clerk has
//   never seen. A test that asks for more Parents than the pool has gets fresh ones as well.

/** A Parent for a test. `remove` gives a pooled one back (its Household goes); a fresh one is deleted. */
export type TestParent = { email: string; userId: string; remove: () => Promise<void> };

/** Pooled Parents per worker: enough for a test where a second Parent joins. */
const POOL_SIZE = 2;

type ClerkInPage = {
	Clerk?: {
		session?: { getToken(options: { skipCache: boolean }): Promise<string | null> } | null;
	};
};

type Slot = {
	email: string;
	userId?: string;
	busy: boolean;
	/** The worker's own page signed in as this Parent, which stays open between tests. */
	keeper?: { browser: Browser; context: BrowserContext; page: Page };
	kept?: { session: SavedSession; at: number };
	/** Contexts `signedInPage` opened for this Parent in the test that has it. */
	opened: Set<BrowserContext>;
};

let slots: Slot[] | undefined;

function clerkClient() {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey)
		throw new Error("CLERK_SECRET_KEY is required for E2E (set it in apps/web/.dev.vars)");
	return createClerkClient({ secretKey });
}

const baseURL = () => test.info().project.use.baseURL;

/** The worker's pool, made on first use. */
function pool(): Slot[] {
	if (slots) return slots;
	const name = (process.env.E2E_POOL ?? "local").toLowerCase().replace(/[^a-z0-9]/g, "");
	const worker = test.info().parallelIndex;
	slots = Array.from({ length: POOL_SIZE }, (_, index) => {
		const slot: Slot = {
			email: `e2e-pool-${name}-w${worker}-p${index}+clerk_test@example.com`,
			busy: false,
			opened: new Set(),
		};
		shareSession(slot.email, {
			session: (browser) => sessionOf(slot, browser),
			opened: (context) => {
				slot.opened.add(context);
			},
		});
		return slot;
	});
	return slots;
}

const newUser = (email: string) => ({
	emailAddress: [email],
	password: `Noodle-${ulid()}!`,
	firstName: "Alex",
	skipPasswordChecks: true,
});

/** The pooled Clerk user with this address: looked up, and made only when there is none yet. */
async function pooledUserId(email: string): Promise<string> {
	const clerk = clerkClient();
	const find = async () =>
		(await clerkRetry(() => clerk.users.getUserList({ emailAddress: [email] }))).data[0]?.id;
	const found = await timed("parent-find", find);
	if (found) return found;
	try {
		const user = await timed("parent-make", () =>
			clerkRetry(() => clerk.users.createUser(newUser(email))),
		);
		return user.id;
	} catch (error) {
		// Another run, or a try of ours that Clerk answered with a 5xx, made it in between.
		const made = await find();
		if (made) return made;
		throw error;
	}
}

let api: APIRequestContext | undefined;
let resets: Promise<unknown> = Promise.resolve();

/** Puts the Parent back to no Household and no emails. One at a time: two Parents may share a Household. */
function reset(slot: Slot): Promise<void> {
	const run = () =>
		timed("household-reset", async () => {
			api ??= await request.newContext({ baseURL: baseURL() });
			const context = api;
			const post = () =>
				context.post("/api/dev/reset-household", {
					data: { clerkUserId: slot.userId, email: slot.email },
				});
			// The server may have closed the idle connection this is sent on (ECONNRESET): removing
			// the Household twice does no harm, so it is sent again.
			const response = await post().catch(post).catch(post);
			expect(response.ok(), await response.text()).toBe(true);
		});
	const done = resets.then(run, run);
	resets = done.catch(() => {});
	return done;
}

/** A session token good for the next minute, from the page that stays signed in. */
async function freshToken(page: Page) {
	for (let attempt = 0; attempt < 3; attempt++) {
		// A page on its way somewhere else can't answer: ask again once it has settled.
		const token = await page
			.evaluate(
				async () =>
					(await (window as unknown as ClerkInPage).Clerk?.session?.getToken({
						skipCache: true,
					})) ?? null,
			)
			.catch(() => null);
		if (token) return token;
		await page.waitForTimeout(500);
	}
	return null;
}

/**
 * The pooled Parent's cookies with a session token made in the last 25 seconds: the one Clerk
 * leaves in the cookie lasts a minute, and a worker runs for several. A test's first request goes
 * out at once, and from then on its own page keeps the token fresh. Asking Clerk for a token took
 * 0.9 s, so tests that start close together share one. The first call signs the Parent in (once
 * per worker); so does a call that finds the session ended.
 */
async function sessionOf(slot: Slot, browser: Browser): Promise<SavedSession> {
	if (slot.keeper && (slot.keeper.browser !== browser || !browser.isConnected())) {
		await slot.keeper.context.close().catch(() => {});
		slot.keeper = undefined;
		slot.kept = undefined;
	}
	if (slot.kept && Date.now() - slot.kept.at < 25_000) return slot.kept.session;
	const at = Date.now();
	const signInKeeper = (page: Page) =>
		timed("worker-sign-in", async () => {
			await signIn(page, slot.email);
			await page.waitForLoadState("networkidle");
		});
	if (!slot.keeper) {
		const context = await openContext(browser, { baseURL: baseURL() });
		const page = await context.newPage();
		await setupClerkTestingToken({ page });
		slot.keeper = { browser, context, page };
		await signInKeeper(page);
	}
	const { context, page } = slot.keeper;
	let token = await freshToken(page);
	if (!token) {
		await signInKeeper(page);
		token = await freshToken(page);
	}
	if (!token) throw new Error(`The pooled Parent ${slot.email} could not be signed in`);
	const fresh = token;
	const saved = await context.storageState();
	slot.kept = {
		at,
		session: {
			...saved,
			cookies: saved.cookies.map((cookie) =>
				/^__session(_|$)/.test(cookie.name) ? { ...cookie, value: fresh } : cookie,
			),
		},
	};
	return slot.kept.session;
}

/** Gives a pooled Parent back: its pages close, then its Household goes. Safe to call twice. */
async function release(slot: Slot) {
	if (!slot.busy) return;
	const opened = [...slot.opened];
	slot.opened.clear();
	// A page left open stays signed in as this Parent: it would join the next test's Household,
	// follow its live updates and load the server.
	await Promise.all(opened.map((context) => context.close().catch(() => {})));
	try {
		await reset(slot);
	} finally {
		slot.busy = false;
	}
}

/** A brand-new Clerk user, deleted by `remove`. */
async function createFreshParent(): Promise<TestParent> {
	const clerk = clerkClient();
	// A new address each try: a 5xx may still have made the user, and the address would be taken.
	let email = "";
	const user = await timed("parent-make", () =>
		clerkRetry(() => {
			email = newTestEmail();
			return clerk.users.createUser(newUser(email));
		}),
	);
	return {
		email,
		userId: user.id,
		remove: () => timed("parent-remove", () => deleteClerkUser(clerk, user.id)),
	};
}

/**
 * A Parent with no Household, for one test (or one file, from beforeAll): one of the worker's
 * pooled Parents, already signed in for `signedInPage`. Call `remove` when done. With `fresh`, or
 * when the pool has none free, a brand-new Clerk user instead.
 */
export async function createTestParent(options: { fresh?: boolean } = {}): Promise<TestParent> {
	const slot = options.fresh ? undefined : pool().find((candidate) => !candidate.busy);
	if (!slot) return createFreshParent();
	slot.busy = true;
	try {
		slot.userId ??= await pooledUserId(slot.email);
		await reset(slot);
	} catch (error) {
		slot.busy = false;
		throw error;
	}
	return { email: slot.email, userId: slot.userId, remove: () => release(slot) };
}

/** A fresh address in the shape removeStaleTestParents cleans up, for signing up through Clerk's page. */
export function newTestEmail() {
	return `e2e-${ulid().toLowerCase()}+clerk_test@example.com`;
}

/** Deletes the Clerk user with this email, if there is one: for someone who signed up on the page. */
export async function removeTestUserByEmail(email: string) {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) return;
	const clerk = createClerkClient({ secretKey });
	const { data } = await clerkRetry(() => clerk.users.getUserList({ emailAddress: [email] }));
	for (const user of data) await deleteClerkUser(clerk, user.id).catch(() => {});
}

// Fresh Parents only: a pooled one's address (e2e-pool-…) doesn't match, so it is never swept.
const TEST_PARENT_EMAIL = /^e2e-[0-9a-z]{26}\+clerk_test@example\.com$/;
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Deletes test Parents an earlier run left behind (a cancelled CI run never reaches its
 * afterEach), so they don't fill the Clerk development instance's 100-user limit. Only
 * addresses this file made, and only ones older than an hour, so runs in flight keep theirs.
 */
export async function removeStaleTestParents() {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) return 0;
	const clerk = createClerkClient({ secretKey });
	const { data } = await clerkRetry(() =>
		clerk.users.getUserList({ limit: 200, orderBy: "created_at" }),
	);
	const stale = data.filter(
		(user) =>
			user.createdAt < Date.now() - STALE_AFTER_MS &&
			user.emailAddresses.length === 1 &&
			TEST_PARENT_EMAIL.test(user.emailAddresses[0]?.emailAddress ?? ""),
	);
	for (const user of stale) await deleteClerkUser(clerk, user.id).catch(() => {});
	return stale.length;
}
