import { createClerkClient } from "@clerk/backend";
import { ulid } from "ulid";

// Each test gets a brand-new Parent, so no Household state leaks between runs.
export async function createTestParent() {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey)
		throw new Error("CLERK_SECRET_KEY is required for E2E (set it in apps/web/.dev.vars)");
	const clerk = createClerkClient({ secretKey });
	const email = `e2e-${ulid().toLowerCase()}+clerk_test@example.com`;
	const user = await clerk.users.createUser({
		emailAddress: [email],
		password: `Noodle-${ulid()}!`,
		firstName: "Alex",
		skipPasswordChecks: true,
	});
	return {
		email,
		userId: user.id,
		remove: () => clerk.users.deleteUser(user.id),
	};
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
	const { data } = await clerk.users.getUserList({ emailAddress: [email] });
	for (const user of data) await clerk.users.deleteUser(user.id).catch(() => {});
}

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
	const { data } = await clerk.users.getUserList({ limit: 200, orderBy: "created_at" });
	const stale = data.filter(
		(user) =>
			user.createdAt < Date.now() - STALE_AFTER_MS &&
			user.emailAddresses.length === 1 &&
			TEST_PARENT_EMAIL.test(user.emailAddresses[0]?.emailAddress ?? ""),
	);
	for (const user of stale) await clerk.users.deleteUser(user.id).catch(() => {});
	return stale.length;
}
