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
