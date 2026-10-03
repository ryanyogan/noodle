import { useUser } from "@clerk/tanstack-react-start";
import { Input } from "@noodle/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { viewerQuery } from "../queries";

// What joining a Household needs, on /welcome (by verified email) and /invite/<token> (by link).

/**
 * After joining or creating, re-run the route guards so they see the new Household. A new
 * Household goes on to the get-started wizard; a Parent joining one skips it for a short look at what's there.
 */
export function useEnterHousehold(to: "/setup" | "/joined") {
	const router = useRouter();
	const queryClient = useQueryClient();
	return async () => {
		await queryClient.invalidateQueries({ queryKey: viewerQuery().queryKey, refetchType: "none" });
		await router.invalidate();
		await router.navigate({ to });
	};
}

/**
 * "Your name", started with Clerk's first name once it loads (after hydration) - unless the Parent
 * has typed in it already, so a late load never overwrites what they typed.
 */
export function ParentNameInput({ firstName }: { firstName: string | undefined }) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (firstName && input.current && input.current.value === "") input.current.value = firstName;
	}, [firstName]);
	return (
		<Input
			ref={input}
			id="parentName"
			name="parentName"
			required
			maxLength={80}
			autoComplete="given-name"
			defaultValue={firstName}
		/>
	);
}

/** The signed-in user's first name in Clerk, to start "Your name" with; undefined until Clerk loads. */
export function useFirstName(): string | undefined {
	const { user } = useUser();
	return user?.firstName?.trim() || undefined;
}
