import { auth } from "@clerk/tanstack-react-start/server";

/** The signed-in Clerk user from the session cookie, or null. Never trusts client input. */
export async function currentUserId(): Promise<string | null> {
	const { isAuthenticated, userId } = await auth();
	return isAuthenticated && userId ? userId : null;
}

export async function requireUserId(): Promise<string> {
	const userId = await currentUserId();
	if (!userId) throw new Error("Not signed in");
	return userId;
}
