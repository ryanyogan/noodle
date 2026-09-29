import {
	AFFORDABILITY_LIMITS,
	anythingCheck,
	type CarWay,
	type Cents,
	carCheck,
	dollars,
	estimateGrossIncome,
	homeCheck,
	type MonthKey,
	monthlyEquivalent,
	type PlanNow,
	planAhead,
	planForMonth,
	project,
	TAKE_HOME_SHARE,
	typicalFreeToSpend,
	type Verdict,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageHeader } from "@noodle/ui/components/page-header";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { ulid } from "ulid";
import { z } from "zod";
import {
	ANYTHING_DEFAULTS,
	CAR_DEFAULTS,
	type CommitmentRole,
	goalAccount,
	goalDate,
	guessRole,
	HOME_DEFAULTS,
	type NewCost,
	purchaseLevers,
	startMonth,
} from "../../../affordability";
import {
	Assumptions,
	Breakdown,
	CommitmentRoles,
	EarmarkPicker,
	FieldGroup,
	MoneyField,
	PercentField,
	SelectField,
	VerdictCard,
	VerdictLabel,
	verdictName,
} from "../../../components/affordability";
import { formatMoney } from "../../../format";
import { goalsView, useAddGoal } from "../../../goals";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../../../queries";
import { projectionGoals, useSaveScenario } from "../../../scenarios";

// Affordability Checks: a home, a car or anything else, checked against the Plan, Goals and
// Earmarks, each answered Comfortable, Stretch or Not Yet with its reasons, and one tap from a
// Goal or a Scenario. Like Explore, it renders only in the browser (data-only SSR).

const kinds = ["home", "car", "anything"] as const;
type Kind = (typeof kinds)[number];

export const Route = createFileRoute("/_authed/_household/explore_/afford")({
	ssr: "data-only",
	validateSearch: z.object({ kind: z.enum(kinds).optional().catch(undefined) }),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(planAheadQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
			// Exploring a Check as a Scenario adds to the cached list.
			context.queryClient.ensureQueryData(scenariosQuery()),
		]),
	component: AffordPage,
});

const kindName: Record<Kind, string> = { home: "Home", car: "Car", anything: "Anything" };

/** What every Check reads from the Plan and the Goals. */
type Context = {
	month: MonthKey;
	plan: PlanNow;
	commitments: { id: string; name: string; monthly: Cents }[];
	/** Active Goals, with their Earmarks. */
	goals: { id: string; name: string; saved: Cents; accountId: string }[];
	accounts: { id: string; holdsMoney: boolean }[];
};

function AffordPage() {
	const { kind = "home" } = Route.useSearch();
	const { month, records } = useSuspenseQuery(planAheadQuery()).data;
	const goalsData = useSuspenseQuery(goalsQuery()).data;
	const context = useMemo((): Context => {
		const plan = planForMonth(records, month);
		const ahead = planAhead(records, projectionGoals(goalsData), month, 12);
		const view = goalsView(goalsData);
		return {
			month,
			plan: {
				month,
				baseline: plan.baseline ?? 0,
				freeToSpend: typicalFreeToSpend(project(ahead)),
			},
			commitments: plan.commitments.map((c) => ({
				id: c.id,
				name: c.name,
				monthly: monthlyEquivalent(c),
			})),
			goals: view.goals
				.filter((g) => g.state === "active")
				.map((g) => ({ id: g.id, name: g.name, saved: g.progress.saved, accountId: g.accountId })),
			accounts: view.accounts,
		};
	}, [records, month, goalsData]);

	// Each Check keeps its answers while the Parent looks at another.
	const [home, setHome] = useState(() => initialHome(context));
	const [car, setCar] = useState(() => initialCar(context));
	const [anything, setAnything] = useState<AnythingForm>(() => ({
		...ANYTHING_DEFAULTS,
		goals: [],
		otherCash: 0,
		monthly: null,
	}));

	return (
		<>
			<PageHeader
				title="Can we afford it?"
				leading={
					<Button variant="ghost" size="icon" asChild>
						<Link to="/explore" aria-label="Back to Explore">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
			/>
			<div className="grid gap-6">
				<nav aria-label="What to check" className="flex gap-1">
					{kinds.map((k) => (
						<Link
							key={k}
							to="/explore/afford"
							search={{ kind: k }}
							aria-current={k === kind ? "page" : undefined}
							className={cn(
								"rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground",
								"aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card aria-[current=page]:ring-1 aria-[current=page]:ring-border",
							)}
						>
							{kindName[k]}
						</Link>
					))}
				</nav>
				{context.plan.baseline === 0 ? (
					<p className="text-sm text-muted-foreground">
						The Plan has no Baseline yet, so there’s no income to check against.{" "}
						<Link
							to="/month/$month/plan"
							params={{ month: context.month }}
							className="underline underline-offset-2"
						>
							Set the Plan
						</Link>
					</p>
				) : null}
				{kind === "home" ? (
					<HomeCheck context={context} form={home} onForm={setHome} />
				) : kind === "car" ? (
					<CarCheck context={context} form={car} onForm={setCar} />
				) : (
					<AnythingCheck context={context} form={anything} onForm={setAnything} />
				)}
			</div>
		</>
	);
}

/** The answer (sticky beside the form on wide screens) and the form, with a sticky verdict line. */
function CheckLayout({
	verdict,
	summary,
	answer,
	children,
}: {
	verdict: Verdict;
	summary: string;
	answer: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:items-start">
			<div className="grid gap-4 lg:sticky lg:top-6">{answer}</div>
			<div className="grid gap-3">
				<p className="sticky top-[env(safe-area-inset-top)] z-10 -mx-(--gutter) flex items-baseline justify-between gap-3 bg-background/85 px-(--gutter) py-2 backdrop-blur-xl lg:hidden">
					<VerdictLabel verdict={verdict} className="font-semibold" />
					<span className="truncate text-sm text-muted-foreground tabular-nums">{summary}</span>
				</p>
				<Card className="grid gap-7 p-(--card-pad)">{children}</Card>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Shared by the Checks

const chosenGoals = (context: Context, ids: string[]) =>
	context.goals.filter((g) => ids.includes(g.id));

const setAside = (context: Context, ids: string[], otherCash: Cents) =>
	chosenGoals(context, ids).reduce((sum, g) => sum + g.saved, 0) + otherCash;

/** The Commitments the Parent has given this role. */
const withRole = (context: Context, roles: Record<string, CommitmentRole>, role: CommitmentRole) =>
	context.commitments.filter((c) => (roles[c.id] ?? "stays") === role);

const total = (commitments: { monthly: Cents }[]) =>
	commitments.reduce((sum, c) => sum + c.monthly, 0);

const guessGoals = (context: Context, pattern: RegExp) =>
	context.goals.filter((g) => pattern.test(g.name)).map((g) => g.id);

const typicalLine = (plan: PlanNow) =>
	`Free to Spend is a typical month’s over the next year of the Plan (${dollars(plan.freeToSpend)}), with no interest, inflation or raises.`;

/** What becomes a Goal: the cash to set aside, by when it can be. */
type GoalIdea = { name: string; target: Cents; readyIn: MonthKey | null; chosen: string[] };

/** What becomes a Scenario: the new monthly costs, and the Commitments they replace. */
type ScenarioIdea = { name: string; costs: Omit<NewCost, "commitmentId">[]; replaced: string[] };

/** "Make it a Goal" and "Explore as a Scenario", each one tap. */
function CheckActions({
	context,
	goal,
	scenario,
	readyIn,
}: {
	context: Context;
	goal: GoalIdea;
	scenario?: ScenarioIdea;
	/** When the cash will be ready, to start a Scenario's costs then. */
	readyIn?: MonthKey | null;
}) {
	const navigate = useNavigate();
	const addGoal = useAddGoal({
		onSuccess: ({ goalId, name }) =>
			toast(`“${name}” is now a Goal`, {
				tone: "success",
				action: {
					label: "View",
					onClick: () => navigate({ to: "/goals/$goalId", params: { goalId } }),
				},
			}),
		onError: (_error, variables) =>
			toast(`Couldn’t add “${variables.name}” as a Goal.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => addGoal.mutate(variables) },
			}),
	});
	const save = useSaveScenario();
	const accountId = goalAccount(context.accounts, chosenGoals(context, goal.chosen));
	const from = startMonth(context.month, readyIn ?? null);
	const costs = scenario?.costs.filter((c) => c.amount > 0) ?? [];

	return (
		<div className="grid gap-2">
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					disabled={accountId === null || goal.target <= 0}
					onClick={() => {
						if (accountId === null) return;
						addGoal.mutate({
							goalId: ulid(),
							accountId,
							name: goal.name,
							targetCents: goal.target,
							targetDate: goalDate(context.month, goal.readyIn),
							claimId: ulid(),
							claimCents: 0,
						});
					}}
				>
					Make it a Goal
				</Button>
				{scenario ? (
					<Button
						type="button"
						variant="outline"
						disabled={costs.length === 0}
						onClick={() => {
							save.mutate({
								scenarioId: ulid(),
								name: scenario.name,
								levers: purchaseLevers({
									from,
									costs: costs.map((c) => ({ ...c, commitmentId: ulid() })),
									replaced: scenario.replaced,
								}),
							});
							navigate({ to: "/explore" });
						}}
					>
						Explore as a Scenario
					</Button>
				) : null}
			</div>
			<p className="text-xs text-subtle-foreground">
				{accountId === null
					? "A Goal needs a checking or savings Account: add one on Goals first."
					: goal.target <= 0
						? "There’s no cash to set aside for it."
						: `A Goal of ${formatMoney(goal.target)} for “${goal.name}”${
								goal.readyIn && goal.readyIn > context.month ? ", due when it can be ready" : ""
							}.`}
				{scenario
					? costs.length > 0
						? ` A Scenario adds the monthly costs from ${monthYear(from)}.`
						: " No monthly cost to explore as a Scenario."
					: null}
			</p>
		</div>
	);
}

const monthYear = (month: MonthKey) =>
	new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});

// ---------------------------------------------------------------------------------------------
// Home

type HomeForm = {
	price: Cents;
	downPayment: Cents;
	closingCostRate: number;
	rate: number;
	termYears: number;
	propertyTaxRate: number;
	insurancePerYear: Cents;
	pmiRate: number;
	hoaPerMonth: Cents;
	/** Gross monthly income as entered; null to estimate it from the Baseline. */
	gross: Cents | null;
	goals: string[];
	otherCash: Cents;
	roles: Record<string, CommitmentRole>;
};

const initialHome = (context: Context): HomeForm => ({
	...HOME_DEFAULTS,
	gross: null,
	goals: guessGoals(context, /\b(home|house|down ?payment)\b/i),
	otherCash: 0,
	roles: Object.fromEntries(context.commitments.map((c) => [c.id, guessRole(c.name, "home")])),
});

type FormProps<T> = { context: Context; form: T; onForm: (change: (form: T) => T) => void };

function HomeCheck({ context, form, onForm }: FormProps<HomeForm>) {
	const set = (change: Partial<HomeForm>) => onForm((f) => ({ ...f, ...change }));
	const replaced = withRole(context, form.roles, "replaced");
	const estimate = estimateGrossIncome(context.plan.baseline);
	const check = homeCheck({
		...form,
		cashAvailable: setAside(context, form.goals, form.otherCash),
		grossMonthlyIncome: form.gross ?? estimate,
		otherDebts: total(withRole(context, form.roles, "debt")),
		replaced: total(replaced),
		plan: context.plan,
	});
	const downShare = form.price > 0 ? Math.round((form.downPayment / form.price) * 1000) / 10 : 0;

	return (
		<CheckLayout
			verdict={check.verdict}
			summary={`${dollars(check.housing)} a month`}
			answer={
				<>
					<VerdictCard
						verdict={check.verdict}
						subject={`A ${dollars(form.price)} home`}
						reasons={check.reasons}
					>
						<div className="grid gap-4 sm:grid-cols-2">
							<Breakdown
								caption="Housing a month"
								rows={[
									{ label: "Principal and interest", amount: check.principalAndInterest },
									{ label: "Property tax", amount: check.propertyTax },
									{ label: "Insurance", amount: check.insurance },
									...(check.pmi > 0 ? [{ label: "PMI", amount: check.pmi }] : []),
									...(check.hoa > 0 ? [{ label: "HOA", amount: check.hoa }] : []),
									{ label: "Housing", amount: check.housing, total: true },
								]}
							/>
							<Breakdown
								caption="Cash to buy"
								rows={[
									{ label: "Down payment", amount: form.downPayment },
									{ label: "Closing costs", amount: check.closingCosts },
									{ label: "Cash needed", amount: check.cashNeeded, total: true },
								]}
							/>
						</div>
						<CheckActions
							context={context}
							goal={{
								name: "Home down payment",
								target: check.cashNeeded,
								readyIn: check.cashReadyIn,
								chosen: form.goals,
							}}
							scenario={{
								name: `${dollars(form.price)} home`,
								costs: [{ name: "New home", amount: check.housing, months: null }],
								replaced: replaced.map((c) => c.id),
							}}
							readyIn={check.cashReadyIn}
						/>
					</VerdictCard>
					<Assumptions
						lines={[
							`The mortgage is paid off in equal monthly payments over ${form.termYears} years at ${form.rate}% a year.`,
							`Lenders compare housing with gross income: up to ${AFFORDABILITY_LIMITS.frontEnd.comfortable}% is usual and ${AFFORDABILITY_LIMITS.frontEnd.stretch}% the FHA limit; all debt payments up to ${AFFORDABILITY_LIMITS.backEnd.comfortable}%, and ${AFFORDABILITY_LIMITS.backEnd.stretch}% at most.`,
							`PMI is counted while the down payment is under ${AFFORDABILITY_LIMITS.pmiBelow}% of the price.`,
							typicalLine(context.plan),
						]}
					/>
				</>
			}
		>
			<FieldGroup legend="The home">
				<MoneyField label="Price" value={form.price} onChange={(price) => set({ price })} />
				<MoneyField
					label="Down payment"
					hint={`${downShare}% of the price.`}
					value={form.downPayment}
					onChange={(downPayment) => set({ downPayment })}
				/>
				<PercentField
					label="Closing costs"
					hint={`About ${dollars(check.closingCosts)}, paid in cash.`}
					value={form.closingCostRate}
					max={20}
					onChange={(closingCostRate) => set({ closingCostRate })}
				/>
				<MoneyField
					label="HOA dues a month"
					value={form.hoaPerMonth}
					onChange={(hoaPerMonth) => set({ hoaPerMonth })}
				/>
			</FieldGroup>
			<FieldGroup legend="The mortgage">
				<div className="grid grid-cols-2 gap-4">
					<PercentField
						label="Rate"
						value={form.rate}
						max={30}
						onChange={(rate) => set({ rate })}
					/>
					<SelectField
						label="Term"
						value={form.termYears}
						options={[15, 20, 30].map((years) => ({ value: years, label: `${years} years` }))}
						onChange={(termYears) => set({ termYears })}
					/>
				</div>
				<PercentField
					label="PMI a year"
					hint={`Of the loan, only while under ${AFFORDABILITY_LIMITS.pmiBelow}% down.`}
					value={form.pmiRate}
					max={5}
					onChange={(pmiRate) => set({ pmiRate })}
				/>
				<div className="grid grid-cols-2 gap-4">
					<PercentField
						label="Property tax a year"
						value={form.propertyTaxRate}
						max={10}
						onChange={(propertyTaxRate) => set({ propertyTaxRate })}
					/>
					<MoneyField
						label="Insurance a year"
						value={form.insurancePerYear}
						onChange={(insurancePerYear) => set({ insurancePerYear })}
					/>
				</div>
			</FieldGroup>
			<FieldGroup legend="Income">
				<MoneyField
					label="Gross income a month"
					hint={
						form.gross === null ? (
							`Estimated from the ${dollars(context.plan.baseline)} Baseline, assuming take-home pay is ${TAKE_HOME_SHARE}% of gross. Enter yours for a truer answer.`
						) : (
							<>
								Before tax, for both Parents.{" "}
								<button
									type="button"
									className="underline underline-offset-2 hover:text-foreground"
									onClick={() => set({ gross: null })}
								>
									Use the estimate
								</button>
							</>
						)
					}
					value={form.gross ?? estimate}
					onChange={(gross) => set({ gross })}
				/>
			</FieldGroup>
			<EarmarkPicker
				goals={context.goals}
				chosen={form.goals}
				onChosen={(goals) => set({ goals })}
				otherCash={form.otherCash}
				onOtherCash={(otherCash) => set({ otherCash })}
			/>
			<CommitmentRoles
				commitments={context.commitments}
				roles={form.roles}
				allowed={["stays", "replaced", "debt"]}
				hint="Rent the home would replace, and debt payments lenders count."
				onRole={(id, role) => set({ roles: { ...form.roles, [id]: role } })}
			/>
		</CheckLayout>
	);
}

// ---------------------------------------------------------------------------------------------
// Car

type CarForm = {
	price: Cents;
	way: CarWay;
	loan: { downPayment: Cents; rate: number; months: number };
	lease: { monthly: Cents; months: number; dueAtSigning: Cents };
	running: Cents;
	depreciationRate: number;
	horizonMonths: number;
	goals: string[];
	otherCash: Cents;
	roles: Record<string, CommitmentRole>;
};

const initialCar = (context: Context): CarForm => ({
	...CAR_DEFAULTS,
	loan: { ...CAR_DEFAULTS.loan },
	lease: { ...CAR_DEFAULTS.lease },
	goals: guessGoals(context, /\b(car|vehicle|auto)\b/i),
	otherCash: 0,
	roles: Object.fromEntries(context.commitments.map((c) => [c.id, guessRole(c.name, "car")])),
});

const wayName: Record<CarWay, string> = { cash: "Cash", loan: "Loan", lease: "Lease" };
const ways: CarWay[] = ["cash", "loan", "lease"];

function CarCheck({ context, form, onForm }: FormProps<CarForm>) {
	const set = (change: Partial<CarForm>) => onForm((f) => ({ ...f, ...change }));
	const replaced = withRole(context, form.roles, "replaced");
	const check = carCheck({
		...form,
		cashAvailable: setAside(context, form.goals, form.otherCash),
		replaced: total(replaced),
		plan: context.plan,
	});
	const chosen = check[form.way];
	const horizon = form.horizonMonths / 12;
	const payment: Omit<NewCost, "commitmentId">[] =
		form.way === "loan"
			? [{ name: "Car loan", amount: chosen.payment, months: form.loan.months }]
			: form.way === "lease"
				? [{ name: "Car lease", amount: chosen.payment, months: null }]
				: [];

	return (
		<CheckLayout
			verdict={chosen.verdict}
			summary={
				form.way === "cash"
					? `${dollars(form.price)} up front`
					: `${dollars(chosen.payment)} a month`
			}
			answer={
				<>
					<VerdictCard
						verdict={chosen.verdict}
						subject={`A ${dollars(form.price)} car, ${
							form.way === "cash" ? "paid in cash" : form.way === "loan" ? "with a loan" : "leased"
						}`}
						reasons={chosen.reasons}
					>
						<CarComparison check={check} way={form.way} years={horizon} />
						<CheckActions
							context={context}
							goal={{
								name:
									form.way === "cash"
										? "Car"
										: form.way === "loan"
											? "Car down payment"
											: "Car lease",
								target: chosen.upfront,
								readyIn: chosen.cashReadyIn,
								chosen: form.goals,
							}}
							scenario={{
								name: `${dollars(form.price)} car (${wayName[form.way].toLowerCase()})`,
								costs: [
									...payment,
									{ name: "Car running costs", amount: form.running, months: null },
								],
								replaced: replaced.map((c) => c.id),
							}}
							readyIn={chosen.cashReadyIn}
						/>
					</VerdictCard>
					<Assumptions
						lines={[
							`Each way is compared over ${horizon === 1 ? "1 year" : `${horizon} years`}: what’s paid, plus running costs, less what the car is worth at the end (less anything still owed on it).`,
							`The car loses ${form.depreciationRate}% of its value a year. A lease ends with nothing to keep, and is signed again on the same terms.`,
							`Running a car (payment and running costs) up to ${AFFORDABILITY_LIMITS.carShare}% of the Baseline is Comfortable.`,
							typicalLine(context.plan),
						]}
					/>
				</>
			}
		>
			<FieldGroup legend="The car">
				<MoneyField label="Price" value={form.price} onChange={(price) => set({ price })} />
				<SelectField
					label="Pay by"
					value={form.way}
					options={ways.map((way) => ({ value: way, label: wayName[way] }))}
					onChange={(way) => set({ way })}
				/>
				<MoneyField
					label="Running costs a month"
					hint="Insurance, fuel and upkeep beyond what the Plan already has."
					value={form.running}
					onChange={(running) => set({ running })}
				/>
			</FieldGroup>
			<FieldGroup legend="Loan">
				<MoneyField
					label="Down payment"
					value={form.loan.downPayment}
					onChange={(downPayment) => set({ loan: { ...form.loan, downPayment } })}
				/>
				<div className="grid grid-cols-2 gap-4">
					<PercentField
						label="Rate"
						value={form.loan.rate}
						max={40}
						onChange={(rate) => set({ loan: { ...form.loan, rate } })}
					/>
					<SelectField
						label="Term"
						value={form.loan.months}
						options={[36, 48, 60, 72, 84].map((months) => ({
							value: months,
							label: `${months} months`,
						}))}
						onChange={(months) => set({ loan: { ...form.loan, months } })}
					/>
				</div>
			</FieldGroup>
			<FieldGroup legend="Lease">
				<div className="grid grid-cols-2 gap-4">
					<MoneyField
						label="A month"
						value={form.lease.monthly}
						onChange={(monthly) => set({ lease: { ...form.lease, monthly } })}
					/>
					<SelectField
						label="Term"
						value={form.lease.months}
						options={[24, 36, 39, 48].map((months) => ({
							value: months,
							label: `${months} months`,
						}))}
						onChange={(months) => set({ lease: { ...form.lease, months } })}
					/>
				</div>
				<MoneyField
					label="Due at signing"
					value={form.lease.dueAtSigning}
					onChange={(dueAtSigning) => set({ lease: { ...form.lease, dueAtSigning } })}
				/>
			</FieldGroup>
			<FieldGroup legend="Comparing">
				<div className="grid grid-cols-2 gap-4">
					<PercentField
						label="Value lost a year"
						value={form.depreciationRate}
						max={60}
						onChange={(depreciationRate) => set({ depreciationRate })}
					/>
					<SelectField
						label="Over"
						value={form.horizonMonths}
						options={[36, 48, 60, 72, 84].map((months) => ({
							value: months,
							label: `${months / 12} years`,
						}))}
						onChange={(horizonMonths) => set({ horizonMonths })}
					/>
				</div>
			</FieldGroup>
			<EarmarkPicker
				goals={context.goals}
				chosen={form.goals}
				onChosen={(goals) => set({ goals })}
				otherCash={form.otherCash}
				onOtherCash={(otherCash) => set({ otherCash })}
			/>
			<CommitmentRoles
				commitments={context.commitments}
				roles={form.roles}
				allowed={["stays", "replaced"]}
				hint="A car payment the new car would replace."
				onRole={(id, role) => set({ roles: { ...form.roles, [id]: role } })}
			/>
		</CheckLayout>
	);
}

/** Cash, loan and lease side by side, over the same years. */
function CarComparison({
	check,
	way,
	years,
}: {
	check: ReturnType<typeof carCheck>;
	way: CarWay;
	years: number;
}) {
	const rows: { label: string; value: (way: CarWay) => ReactNode; total?: boolean }[] = [
		{ label: "Up front", value: (w) => formatMoney(check[w].upfront) },
		{ label: "A month", value: (w) => formatMoney(check[w].payment) },
		{ label: "Paid in all", value: (w) => formatMoney(check[w].paid) },
		{ label: "Worth at the end", value: (w) => formatMoney(check[w].worthAtEnd) },
		{ label: "Costs all in", value: (w) => formatMoney(check[w].totalCost), total: true },
		{ label: "Verdict", value: (w) => verdictName[check[w].verdict] },
	];
	return (
		<div className="-mx-(--card-pad) overflow-x-auto px-(--card-pad)">
			<table className="w-full min-w-[20rem] text-sm tabular-nums">
				<caption className="pb-1.5 text-start text-[13px] font-medium text-muted-foreground">
					Over {years === 1 ? "1 year" : `${years} years`}
				</caption>
				<thead>
					<tr className="[&>*]:pb-1.5 [&>*]:font-medium">
						<td />
						{ways.map((w) => (
							<th
								key={w}
								scope="col"
								className={cn("text-end", w === way ? "text-foreground" : "text-muted-foreground")}
							>
								{wayName[w]}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.label}
							className={cn("[&>*]:py-1.5", row.total && "border-t font-semibold")}
						>
							<th
								scope="row"
								className={cn("text-start font-normal", !row.total && "text-muted-foreground")}
							>
								{row.label}
							</th>
							{ways.map((w) => (
								<td key={w} className={cn("text-end", w !== way && "text-muted-foreground")}>
									{row.value(w)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Anything

type AnythingForm = {
	name: string;
	price: Cents;
	/** At most one Goal whose Earmark goes toward it. */
	goals: string[];
	otherCash: Cents;
	/** Set aside each month; null for a typical month's Free to Spend. */
	monthly: Cents | null;
};

function AnythingCheck({ context, form, onForm }: FormProps<AnythingForm>) {
	const set = (change: Partial<AnythingForm>) => onForm((f) => ({ ...f, ...change }));
	const nameId = useId();
	const typical = Math.max(0, context.plan.freeToSpend);
	const monthly = form.monthly ?? typical;
	const saved = setAside(context, form.goals, form.otherCash);
	const check = anythingCheck({ price: form.price, saved, monthly, month: context.month });
	const name = form.name.trim();

	return (
		<CheckLayout
			verdict={check.verdict}
			summary={
				check.months === 0
					? "Set aside already"
					: check.affordableIn
						? `Ready ${monthYear(check.affordableIn)}`
						: "Nothing to set aside"
			}
			answer={
				<>
					<VerdictCard
						verdict={check.verdict}
						subject={
							name ? `${name}, ${dollars(form.price)}` : `Something for ${dollars(form.price)}`
						}
						reasons={check.reasons}
					>
						<Breakdown
							caption="Saving for it"
							rows={[
								{ label: "Price", amount: form.price },
								{ label: "Set aside", amount: Math.min(saved, form.price) },
								{ label: "Still to save", amount: check.shortfall, total: true },
							]}
						/>
						<CheckActions
							context={context}
							goal={{
								name: name || "Something new",
								target: form.price,
								readyIn: check.affordableIn,
								chosen: form.goals,
							}}
						/>
					</VerdictCard>
					<Assumptions
						lines={[
							`Setting aside ${dollars(monthly)} a month, with no interest.`,
							`Set aside already is Comfortable; within ${AFFORDABILITY_LIMITS.saveMonths} months of saving a Stretch; longer is Not Yet.`,
							typicalLine(context.plan),
						]}
					/>
				</>
			}
		>
			<FieldGroup legend="What it is">
				<Field label="Name" htmlFor={nameId}>
					<Input
						id={nameId}
						value={form.name}
						maxLength={40}
						placeholder="A new sofa"
						onChange={(event) => set({ name: event.currentTarget.value })}
					/>
				</Field>
				<MoneyField label="Price" value={form.price} onChange={(price) => set({ price })} />
			</FieldGroup>
			<EarmarkPicker
				goals={context.goals}
				chosen={form.goals}
				single
				onChosen={(goals) => set({ goals })}
				otherCash={form.otherCash}
				onOtherCash={(otherCash) => set({ otherCash })}
			/>
			<FieldGroup legend="Saving">
				<MoneyField
					label="Set aside a month"
					hint={
						form.monthly === null ? (
							"A typical month’s Free to Spend."
						) : (
							<>
								A typical month’s Free to Spend is {dollars(typical)}.{" "}
								<button
									type="button"
									className="underline underline-offset-2 hover:text-foreground"
									onClick={() => set({ monthly: null })}
								>
									Use it
								</button>
							</>
						)
					}
					value={monthly}
					onChange={(value) => set({ monthly: value })}
				/>
			</FieldGroup>
		</CheckLayout>
	);
}
