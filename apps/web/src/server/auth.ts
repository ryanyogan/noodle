import { auth, clerkClient } from "@clerk/tanstack-react-start/server";

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

/** The user's verified email addresses, from Clerk (never from client input). */
export async function verifiedEmails(userId: string): Promise<string[]> {
	const user = await clerkClient().users.getUser(userId);
	return user.emailAddresses
		.filter((address) => address.verification?.status === "verified")
		.map((address) => address.emailAddress);
}
