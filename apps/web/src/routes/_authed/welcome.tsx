import { createFileRoute, redirect, useHydrated, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ulid } from "ulid";
import { createHousehold } from "../../server/session";

export const Route = createFileRoute("/_authed/welcome")({
	beforeLoad: ({ context }) => {
		if (context.household) throw redirect({ to: "/month" });
	},
	component: Welcome,
});

function Welcome() {
	const navigate = useNavigate();
	// Until hydrated, a click would fall through to a native GET submit.
	const hydrated = useHydrated();
	// Client-generated IDs make a retried submit create one Household.
	const [ids] = useState(() => ({ householdId: ulid(), parentId: ulid() }));
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setPending(true);
		setError(null);
		try {
			await createHousehold({
				data: {
					...ids,
					householdName: String(form.get("householdName") ?? ""),
					parentName: String(form.get("parentName") ?? ""),
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
			});
			await navigate({ to: "/month" });
		} catch {
			setError("We couldn't create your Household. Please try again.");
			setPending(false);
		}
	}

	return (
		<main>
			<h1>Welcome to Noodle</h1>
			<p>Start by naming your Household. You can invite the other Parent later.</p>
			<form onSubmit={onSubmit}>
				<label>
					Household name
					<input name="householdName" required maxLength={80} autoComplete="off" />
				</label>
				<label>
					Your name
					<input name="parentName" required maxLength={80} autoComplete="given-name" />
				</label>
				{error ? <p role="alert">{error}</p> : null}
				<button type="submit" disabled={!hydrated || pending}>
					Create Household
				</button>
			</form>
		</main>
	);
}
