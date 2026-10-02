import { monthKeyAt, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useHydrated } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { nextBucketColor } from "../../buckets";
import { CenteredHeading, CenteredPage } from "../../components/centered-page";
import { GlossaryDialog } from "../../components/glossary";
import { AmountInput } from "../../components/goals";
import { TermHelp } from "../../components/term-help";
import { formatMoney } from "../../format";
import { useGoals } from "../../goals";
import {
	goalsQuery,
	householdParentsQuery,
	monthQuery,
	monthsKey,
	useMonthState,
} from "../../queries";
import { addPersonalAllowance } from "../../server/plan";

// "Here's your Household" (#53): what the other Parent sees after joining, instead of the
// get-started wizard. The Household's Plan is already there, so it shows who is in it and what's
// set up, offers the one thing that is theirs alone to add (their Personal Allowance, ADR-0003),
// and goes on to This Month.

export const Route = createFileRoute("/_authed/joined")({
	beforeLoad: ({ context }) => {
		if (!context.household || !context.parentId) throw redirect({ to: "/welcome" });
		return { household: context.household, parentId: context.parentId };
	},
	loader: async ({ context }) => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		await Promise.all([
			context.queryClient.ensureQueryData(monthQuery(month)),
			context.queryClient.ensureQueryData(householdParentsQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
		]);
	},
	head: () => ({ meta: [{ title: "Your Household · Noodle" }] }),
	component: Joined,
});

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Joined() {
	const { household, parentId } = Route.useRouteContext();
	const month = monthKeyAt(new Date(), household.timeZone);
	const state = useMonthState(month);
	const { data: people } = useSuspenseQuery(householdParentsQuery());
	const goals = useGoals().goals.filter((g) => g.state === "active");
	const mine = state.buckets.find((bucket) => bucket.owner === parentId);
	const shared = state.buckets.filter((bucket) => !bucket.owner).length;
	const me = people.parents.find((parent) => parent.id === parentId);
	return (
		<CenteredPage>
			<CenteredHeading title="Here’s your Household">
				You’ve joined {household.name}. You both see and change the same Plan. This is what’s set up
				so far.
			</CenteredHeading>
			<Card>
				<dl className="text-sm">
					<Row label="Parents">{people.parents.map((parent) => parent.name).join(" and ")}</Row>
					<Row label="Take-home pay">
						{state.baseline === null ? "Not set yet" : `${formatMoney(state.baseline)} a month`}
					</Row>
					<Row label="Bills (Commitments)">{count(state.commitments.length, "bill", "bills")}</Row>
					<Row label="Buckets">{count(shared, "Bucket", "Buckets")}</Row>
					<Row label="Goals">{count(goals.length, "Goal", "Goals")}</Row>
				</dl>
			</Card>
			{mine ? (
				<Card className="flex items-baseline justify-between gap-4 p-(--card-pad) text-sm">
					<span>{mine.name}</span>
					<span className="font-medium tabular-nums">{formatMoney(mine.allowance)} a month</span>
				</Card>
			) : state.editable ? (
				<AddMyAllowance
					month={month}
					name={me ? `${me.name.split(/\s+/)[0]}’s Personal Allowance` : "Personal Allowance"}
					color={nextBucketColor(state.buckets.map((bucket) => bucket.color))}
				/>
			) : null}
			<Button asChild size="lg">
				<Link to="/month">Go to This Month</Link>
			</Button>
			<GlossaryDialog />
		</CenteredPage>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-4 border-t px-(--card-pad) py-3 first:border-t-0">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0 break-words text-end font-medium tabular-nums">{children}</dd>
		</div>
	);
}

/** The signed-in Parent's own Personal Allowance, added to the Plan from this month on. */
function AddMyAllowance({
	month,
	name,
	color,
}: {
	month: ReturnType<typeof monthKeyAt>;
	name: string;
	color: number;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const queryClient = useQueryClient();
	// Reused by a retry of the same attempt, so it's added once.
	const [bucketId] = useState(() => ulid());
	const [amount, setAmount] = useState("");
	const cents = parseDollars(amount);
	const add = useMutation({
		mutationFn: async (allowanceCents: number) => {
			await addPersonalAllowance({ data: { bucketId, month, name, color, allowanceCents } });
			await queryClient.invalidateQueries({ queryKey: monthsKey });
		},
	});
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (cents !== null && cents > 0) add.mutate(cents);
	}
	return (
		<Card>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<p className="text-sm text-muted-foreground">
					A Personal Allowance <TermHelp term="personal-allowance" /> is money that’s yours to spend
					each month. The other Parent sees only its totals, never what you spent it on. You can
					also add it later, from the Plan.
				</p>
				<Field label="Your Personal Allowance each month" htmlFor={`${id}-allowance`}>
					<AmountInput
						id={`${id}-allowance`}
						placeholder="0"
						value={amount}
						aria-invalid={(amount !== "" && cents === null) || undefined}
						onChange={(event) => setAmount(event.currentTarget.value)}
					/>
				</Field>
				<Button
					type="submit"
					variant="secondary"
					disabled={!hydrated || add.isPending || cents === null || cents <= 0}
				>
					Add your Personal Allowance
				</Button>
				{add.isError ? (
					<FormError>We couldn’t add your Personal Allowance. Please try again.</FormError>
				) : null}
			</form>
		</Card>
	);
}
