import { allowancesByKind, monthKeyAt, monthState, parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Logo } from "@noodle/ui/components/logo";
import { RadioGroup, RadioGroupCard } from "@noodle/ui/components/radio-group";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Spinner } from "@noodle/ui/components/spinner";
import { Stepper } from "@noodle/ui/components/stepper";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, Suspense, useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import { GlossaryDialog } from "../../components/glossary";
import { AmountInput } from "../../components/goals";
import { InviteOtherParent } from "../../components/invite-other-parent";
import { SetupBills } from "../../components/setup-bills";
import { SetupBankCard, SetupStatementCard } from "../../components/setup-spending";
import { CarriesOverHelp, StarterBucketPicker } from "../../components/starter-buckets";
import { TermHelp } from "../../components/term-help";
import { formatMoney, formatMoneyInput } from "../../format";
import { useGoals } from "../../goals";
import { useLiveUpdates } from "../../live-updates";
import {
	goalsQuery,
	householdParentsQuery,
	monthQuery,
	monthsKey,
	planDraftQuery,
	setupQuery,
	useMonthState,
} from "../../queries";
import { addCommitment, endCommitment, updateCommitment } from "../../server/commitments";
import { addAccount, addGoal, setEmergencyGoal } from "../../server/goals";
import {
	addBucket,
	addPersonalAllowance,
	archiveBucket,
	setAllowance,
	setCarriesOver,
	setTakeHomePay,
	updateBucket,
} from "../../server/plan";
import { acceptDraft } from "../../server/plan-draft";
import { type SetupState, saveSetup, startSetup } from "../../server/setup";
import {
	backgroundStatus,
	canSkip,
	minutesLeft,
	SETUP_STEP_COUNT,
	SETUP_STEPS,
	type SetupAnswers,
	type SetupBill,
	type SetupBucket,
	type SetupGoal,
	type SetupGoalKind,
	type SetupJobView,
	type SetupPath,
	setupUnsaved,
} from "../../setup";
import {
	type BillRow,
	billsMonthly,
	dueDateFor,
	mergeDraftBills,
	planBillWrites,
	startingBills,
} from "../../setup-bills";
import {
	type BucketRow,
	bucketsTotal,
	mergeDraftBuckets,
	planBucketWrites,
	scaleBuckets,
	startingBuckets,
} from "../../starter-buckets";

// The get-started wizard (#53): a full-screen, step-by-step setup after /welcome creates a
// Household. Progress (step, answers, skipped steps) is saved to D1 after every step, so leaving
// and coming back resumes where the Parent was. Choosing a bank or a statement on Hello starts the
// Setup Workflow, whose jobs the progress header reports as they finish; when its plan draft lands,
// Take-home pay, Bills and Buckets fill in from it without replacing anything the Parent typed.
// Each step writes to the Plan through the Plan's own server functions, with ids kept in the saved
// answers, so going back or running it again changes what's there instead of adding to it. Done
// reads the Plan itself, checks every answer is on it, and only then marks setup finished.

export const Route = createFileRoute("/_authed/setup")({
	beforeLoad: ({ context }) => {
		if (!context.household || !context.parentId) throw redirect({ to: "/welcome" });
		return { household: context.household, parentId: context.parentId };
	},
	loader: async ({ context }) => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		await Promise.all([
			context.queryClient.ensureQueryData(setupQuery()),
			// What the Plan has now, so a re-run changes it instead of adding to it.
			context.queryClient.ensureQueryData(monthQuery(month)),
			context.queryClient.ensureQueryData(householdParentsQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
		]);
	},
	head: () => ({ meta: [{ title: "Set up · Noodle" }] }),
	component: SetupWizard,
});

/** Saves progress after a step, and keeps the cached copy in step so a reload resumes there. */
function useSaveProgress() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (next: Pick<SetupState, "step" | "answers" | "skipped"> & { finished?: boolean }) =>
			saveSetup({ data: next }),
		onMutate: (next) => {
			queryClient.setQueryData(setupQuery().queryKey, (old) =>
				old ? { ...old, ...next, finished: next.finished ?? old.finished } : old,
			);
		},
	});
}

function SetupWizard() {
	useLiveUpdates();
	const { data } = useSuspenseQuery(setupQuery());
	const save = useSaveProgress();
	const { step, answers, skipped } = data;
	const status = backgroundStatus(data.jobs);

	const go = (next: number, changes: Partial<SetupAnswers> = {}, skip = false) =>
		save.mutateAsync({
			step: next,
			answers: { ...answers, ...changes },
			skipped: skip ? [...skipped, step] : skipped.filter((s) => s !== step),
		});
	const back = step > 1 ? () => void go(step - 1) : undefined;

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-(--gutter) pt-[calc(env(safe-area-inset-top)+20px)]">
			<header className="grid gap-5 pb-6">
				<div className="flex items-center justify-between gap-4">
					<Logo />
					<Button asChild variant="ghost" size="sm">
						<Link to="/month">Set up later</Link>
					</Button>
				</div>
				<Stepper
					step={step}
					total={SETUP_STEP_COUNT}
					minutesLeft={minutesLeft(step)}
					status={status}
					aria-label="Setup progress"
				/>
			</header>
			{save.isError ? (
				<FormError>We couldn’t save that step. Check your connection and try again.</FormError>
			) : null}
			<div key={step} className="flex flex-1 animate-enter flex-col">
				{step === 1 ? (
					<HelloStep answers={answers} onNext={(path) => go(2, { path })} />
				) : step === 2 ? (
					<TakeHomePayStep
						answers={answers}
						jobs={data.jobs}
						onBack={back}
						onNext={(takeHomePayCents) => go(3, { takeHomePayCents })}
					/>
				) : step === 3 ? (
					<BillsStep
						answers={answers}
						jobs={data.jobs}
						onBack={back}
						onSkip={() => go(4, {}, true)}
						onNext={(bills) => go(4, { bills })}
					/>
				) : step === 4 ? (
					<BucketsStep
						answers={answers}
						jobs={data.jobs}
						onBack={back}
						onSkip={() => go(5, {}, true)}
						onNext={(buckets) => go(5, { buckets })}
					/>
				) : step === 5 ? (
					<GoalStep
						answers={answers}
						onBack={back}
						onSkip={() => go(6, {}, true)}
						onNext={(goal) => go(6, goal ? { goal } : {})}
					/>
				) : step < SETUP_STEP_COUNT ? (
					<InviteStep
						onBack={back}
						onNext={() => go(step + 1)}
						onSkip={canSkip(step) ? () => go(step + 1, {}, true) : undefined}
					/>
				) : (
					<DoneStep
						answers={answers}
						onBack={back}
						onGo={(to) => void go(to)}
						onDone={() => save.mutateAsync({ step, answers, skipped, finished: true })}
					/>
				)}
			</div>
			<GlossaryDialog />
		</main>
	);
}

/** A step's heading, its body, and its buttons, which stay at the bottom of a phone's screen. */
function StepFrame({
	title,
	intro,
	children,
	onSubmit,
	onBack,
	onSkip,
	primary,
	pending,
	disabled,
	aside,
	formless,
	lead,
}: {
	title: string;
	intro?: ReactNode;
	children?: ReactNode;
	onSubmit: () => void;
	onBack?: () => void;
	onSkip?: () => void;
	primary: string;
	pending?: boolean;
	disabled?: boolean;
	/** A short live figure kept beside the buttons, e.g. what's left to plan. */
	aside?: ReactNode;
	/** For a step whose body has a form of its own: the primary button is then a plain button. */
	formless?: boolean;
	/**
	 * Shown first, outside the step's form: for a card with a form or a sheet of its own (connecting
	 * a bank, uploading a statement), whose submit must not also submit the step.
	 */
	lead?: ReactNode;
}) {
	const hydrated = useHydrated();
	const formId = useId();
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		onSubmit();
	}
	return (
		<div className="flex flex-1 flex-col">
			<div className="grid gap-5 pb-6">
				<div className="grid gap-2">
					<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
					{intro ? <p className="text-[15px] text-muted-foreground">{intro}</p> : null}
				</div>
				{lead}
				{formless ? (
					children
				) : (
					<form id={formId} onSubmit={submit} className="grid gap-5">
						{children}
					</form>
				)}
			</div>
			<div className="sticky bottom-0 z-10 mt-auto grid gap-2 border-t border-border bg-background py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
				{aside}
				<div className="flex items-center gap-2">
					{onBack ? (
						<Button type="button" variant="ghost" size="lg" disabled={!hydrated} onClick={onBack}>
							Back
						</Button>
					) : null}
					<div className="ml-auto flex items-center gap-2">
						{onSkip ? (
							<Button type="button" variant="ghost" size="lg" disabled={!hydrated} onClick={onSkip}>
								Skip
							</Button>
						) : null}
						<Button
							type={formless ? "button" : "submit"}
							form={formless ? undefined : formId}
							size="lg"
							disabled={!hydrated || pending || disabled}
							onClick={formless ? onSubmit : undefined}
						>
							{pending ? <Spinner /> : null}
							{primary}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

const PATHS: { value: SetupPath; label: string; description: string }[] = [
	{
		value: "bank",
		label: "Connect a bank",
		description:
			"Noodle brings in what you spend every day and files most of it for you. You check the few it isn’t sure of.",
	},
	{
		value: "statement",
		label: "Upload a statement",
		description:
			"Download a statement from your bank (CSV, OFX or QFX) and upload it now and then. Noodle files what it can.",
	},
	{
		value: "hand",
		label: "I’ll add things by hand",
		description:
			"You add each purchase with Quick Add, or forward receipts by email. Nothing is connected.",
	},
];

/** Step 1: what Noodle does, the intro video's place, and how spending will come in. */
function HelloStep({
	answers,
	onNext,
}: {
	answers: SetupAnswers;
	onNext: (path: SetupPath) => Promise<unknown>;
}) {
	const id = useId();
	const [path, setPath] = useState<SetupPath | undefined>(answers.path);
	const start = useMutation({
		mutationFn: async (chosen: SetupPath) => {
			// The slow work starts now, in the background, while the Parent goes on.
			if (chosen !== "hand") await startSetup({ data: { path: chosen } });
			await onNext(chosen);
		},
	});
	return (
		<StepFrame
			title="Let’s set up your money"
			intro="Noodle helps you plan each month: what comes in, what the bills take, and what’s left to spend. This takes about 8 minutes."
			primary="Continue"
			pending={start.isPending}
			disabled={!path}
			onSubmit={() => path && start.mutate(path)}
		>
			{/* The 1-minute intro video (#54) goes here once it lands. */}
			<Card data-slot="intro-video" className="p-(--card-pad) text-sm text-muted-foreground">
				A 1-minute intro video is coming soon.
			</Card>
			<fieldset className="grid gap-3">
				<legend className="pb-3 text-sm font-medium">How will you bring in what you spend?</legend>
				<RadioGroup
					value={path ?? ""}
					onValueChange={(value) => setPath(value as SetupPath)}
					aria-label="How will you bring in what you spend?"
				>
					{PATHS.map((choice) => (
						<RadioGroupCard
							key={choice.value}
							id={`${id}-${choice.value}`}
							value={choice.value}
							label={
								<span className="flex items-center gap-2">
									{choice.label}
									{choice.value === "bank" ? <Badge variant="brand">Recommended</Badge> : null}
								</span>
							}
							description={choice.description}
						/>
					))}
				</RadioGroup>
				<p className="text-[13px] text-muted-foreground">You can change this later.</p>
			</fieldset>
			{start.isError ? <FormError>We couldn’t start that. Please try again.</FormError> : null}
		</StepFrame>
	);
}

/** Step 2: take-home pay, set on the Plan from this month on through `setTakeHomePay`. */
function TakeHomePayStep({
	answers,
	jobs,
	onBack,
	onNext,
}: {
	answers: SetupAnswers;
	jobs: SetupJobView[];
	onBack?: () => void;
	onNext: (cents: number) => Promise<unknown>;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const { household } = Route.useRouteContext();
	const [amount, setAmount] = useState(() =>
		answers.takeHomePayCents === undefined ? "" : formatMoneyInput(answers.takeHomePayCents),
	);
	const [biweekly, setBiweekly] = useState(false);
	// A guess from the plan draft fills the field until the Parent types; it never replaces what they typed.
	const [typed, setTyped] = useState(answers.takeHomePayCents !== undefined);
	const [suggested, setSuggested] = useState(false);
	const { draft } = useSetupDraft(jobs);
	const guess = draft?.baseline?.amount;
	useEffect(() => {
		if (typed || !guess) return;
		setAmount(formatMoneyInput(guess));
		setSuggested(true);
	}, [typed, guess]);
	const type = (value: string) => {
		setTyped(true);
		setSuggested(false);
		setAmount(value);
	};
	const [paycheck, setPaycheck] = useState("");
	const cents = parseDollars(amount);
	const paycheckCents = parseDollars(paycheck);
	const monthly = paycheckCents === null ? null : Math.round((paycheckCents * 26) / 12);
	const path = answers.path;

	const set = useMutation({
		mutationFn: async (amountCents: number) => {
			const month = monthKeyAt(new Date(), household.timeZone);
			await setTakeHomePay({ data: { month, amountCents, scope: "from-on" } });
			void queryClient.invalidateQueries({ queryKey: monthsKey });
			await onNext(amountCents);
		},
	});

	return (
		<StepFrame
			title="Take-home pay"
			lead={<SpendingCard path={path} jobs={jobs} />}
			intro="Your usual monthly pay after taxes and deductions. Add both Parents’ pay together. The Plan is built on it."
			primary="Continue"
			onBack={onBack}
			pending={set.isPending}
			disabled={cents === null || cents <= 0}
			onSubmit={() => cents !== null && cents > 0 && set.mutate(cents)}
		>
			<Field
				label="What lands in your account in a normal month, after tax?"
				htmlFor={`${id}-amount`}
				hint={
					suggested
						? "Suggested from your spending. Change it if it’s off."
						: path === "hand"
							? undefined
							: "We’ll check it against your spending once it’s in. You can change it any time."
				}
			>
				<AmountInput
					id={`${id}-amount`}
					placeholder="0"
					enterKeyHint="done"
					value={amount}
					aria-invalid={(amount !== "" && cents === null) || undefined}
					onChange={(event) => type(event.currentTarget.value)}
				/>
			</Field>
			{biweekly ? (
				<Card className="grid gap-3 p-(--card-pad)">
					<Field
						label="One paycheck"
						htmlFor={`${id}-paycheck`}
						hint="Paid every two weeks means 26 paychecks a year, so a month is one paycheck × 26 ÷ 12."
					>
						<AmountInput
							id={`${id}-paycheck`}
							placeholder="0"
							value={paycheck}
							onChange={(event) => setPaycheck(event.currentTarget.value)}
						/>
					</Field>
					{monthly !== null && monthly > 0 ? (
						<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
							<span>
								That’s about{" "}
								<span className="font-medium tabular-nums">{formatMoney(monthly)}</span> a month.
							</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => type(formatMoneyInput(monthly))}
							>
								Use {formatMoney(monthly)}
							</Button>
						</div>
					) : null}
				</Card>
			) : (
				<div>
					<Button type="button" variant="link" onClick={() => setBiweekly(true)}>
						Paid every two weeks?
					</Button>
				</div>
			)}
			{set.isError ? (
				<FormError>We couldn’t save your take-home pay. Please try again.</FormError>
			) : null}
		</StepFrame>
	);
}

/**
 * How the spending chosen on Hello comes in, right in the step (#53): connecting the bank, or
 * uploading a statement. The Setup Workflow waits for either, while the Parent goes on.
 */
function SpendingCard({ path, jobs }: { path: SetupPath | undefined; jobs: SetupJobView[] }) {
	if (path !== "bank" && path !== "statement") return null;
	return (
		<Suspense fallback={<Skeleton className="h-28" />}>
			{path === "bank" ? <SetupBankCard jobs={jobs} /> : <SetupStatementCard jobs={jobs} />}
		</Suspense>
	);
}

/**
 * Step 6: inviting the other Parent, with the same invite as on Household. Nothing to do once both
 * Parents are in; with an invite out, it shows who was invited and can't be skipped past unseen.
 */
function InviteStep({
	onBack,
	onNext,
	onSkip,
}: {
	onBack?: () => void;
	onNext: () => Promise<unknown>;
	onSkip?: () => void;
}) {
	const { data } = useSuspenseQuery(householdParentsQuery());
	const next = useMutation({ mutationFn: onNext });
	const invited = data.hasAllParents || data.invitedEmail !== null;
	return (
		<StepFrame
			formless
			title="Invite the other Parent"
			intro={
				data.hasAllParents
					? "Both Parents are in this Household. You share one Plan."
					: "You share one Plan: you both see the same bills and Buckets, and each adds what they spend. You can also do this later, from Household settings."
			}
			primary="Continue"
			onBack={onBack}
			onSkip={invited ? undefined : onSkip}
			pending={next.isPending}
			onSubmit={() => next.mutate()}
		>
			{data.hasAllParents ? (
				<Card className="p-(--card-pad) text-sm">
					<span className="font-medium">
						{data.parents.map((parent) => parent.name).join(" and ")}
					</span>
				</Card>
			) : (
				<InviteOtherParent invite={data.invite} />
			)}
		</StepFrame>
	);
}

/** One line of Done's summary: what it is, a word on it, and its amount. */
function SummaryRow({
	label,
	detail,
	amount,
	total,
	over,
	...props
}: {
	label: ReactNode;
	detail?: string;
	amount: string;
	total?: boolean;
	over?: boolean;
	"data-summary"?: string;
}) {
	return (
		<div
			className="flex items-baseline justify-between gap-4 border-t px-(--card-pad) py-3 first:border-t-0"
			{...props}
		>
			<dt className="grid min-w-0 gap-0.5">
				<span className={total ? "font-semibold" : undefined}>{label}</span>
				{detail ? (
					<span className="break-words text-[13px] text-muted-foreground">{detail}</span>
				) : null}
			</dt>
			<dd
				className={`shrink-0 tabular-nums ${total ? "text-base font-semibold" : "font-medium"} ${over ? "text-over-foreground" : ""}`}
			>
				{amount}
			</dd>
		</div>
	);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Step 7: the Plan as it now stands, from take-home pay down to Free to Spend, then This Month.
 * The numbers are the Plan's own (the month's state), not the wizard's answers: steps 2 to 5 each
 * wrote to the Plan as the Parent went. Before finishing, Done reads the Plan afresh and checks
 * every answer is on it; a step that isn't sends the Parent back to save it again.
 */
function DoneStep({
	answers,
	onBack,
	onGo,
	onDone,
}: {
	answers: SetupAnswers;
	onBack?: () => void;
	onGo: (step: number) => void;
	onDone: () => Promise<unknown>;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { household } = Route.useRouteContext();
	const month = monthKeyAt(new Date(), household.timeZone);
	const state = useMonthState(month);
	const goals = useGoals().goals.filter((g) => g.state === "active");
	const { buckets, personalAllowances } = allowancesByKind(state);
	const shared = state.buckets.filter((bucket) => !bucket.owner).length;
	const finish = useMutation({
		mutationFn: async () => {
			// Look at the Plan as the server has it now, not at what this screen last loaded.
			const now = monthState(await queryClient.fetchQuery({ ...monthQuery(month), staleTime: 0 }));
			if (setupUnsaved(answers, now).length > 0) return;
			await onDone();
			await router.navigate({ to: "/month" });
		},
	});
	const unsaved = setupUnsaved(answers, state);
	const minus = (cents: number) => `− ${formatMoney(cents)}`;
	return (
		<StepFrame
			title="You’re set up"
			intro="Here’s your Plan for a month. You can change any of it from the Plan."
			primary="Go to This Month"
			onBack={onBack}
			pending={finish.isPending}
			onSubmit={() => finish.mutate()}
		>
			<Card>
				<dl className="text-sm">
					<SummaryRow
						label="Take-home pay"
						amount={state.baseline === null ? "Not set" : formatMoney(state.baseline)}
					/>
					<SummaryRow
						label={
							<>
								Bills (Commitments) <TermHelp term="commitment" />
							</>
						}
						detail={count(state.commitments.length, "bill", "bills")}
						amount={minus(state.committed)}
					/>
					<SummaryRow
						label="Buckets"
						detail={count(shared, "Bucket", "Buckets")}
						amount={minus(buckets)}
					/>
					{personalAllowances === null ? null : (
						<SummaryRow
							label={
								<>
									Personal Allowances <TermHelp term="personal-allowance" />
								</>
							}
							amount={minus(personalAllowances)}
						/>
					)}
					<SummaryRow
						label="Goals"
						detail={
							goals.length === 0
								? "None yet. You can add one from Goals."
								: goals.map((goal) => goal.name).join(", ")
						}
						amount={minus(state.fundedGoals)}
					/>
					<SummaryRow
						data-summary="free-to-spend"
						total
						over={state.freeToSpend < 0}
						label={
							<>
								Free to Spend <TermHelp term="free-to-spend" />
							</>
						}
						detail={
							state.freeToSpend < 0
								? "The Plan uses more than your take-home pay."
								: "What’s left after all of that."
						}
						amount={formatMoney(state.freeToSpend)}
					/>
				</dl>
			</Card>
			{unsaved.length > 0 ? (
				<Card className="grid gap-3 p-(--card-pad) text-sm">
					<FormError>
						Some of what you entered isn’t on the Plan yet. Open the step and press Continue to save
						it again.
					</FormError>
					<div className="flex flex-wrap gap-2">
						{unsaved.map((step) => (
							<Button
								key={step}
								type="button"
								variant="outline"
								size="sm"
								onClick={() => onGo(step)}
							>
								Go to {SETUP_STEPS[step - 1]?.title}
							</Button>
						))}
					</div>
				</Card>
			) : null}
			{finish.isError ? (
				<FormError>We couldn’t finish setup. Check your connection and try again.</FormError>
			) : null}
		</StepFrame>
	);
}

/**
 * The plan draft, once the Setup Workflow has built it; `waiting` while the Workflow still reads
 * the spending (bank or statement). By hand, there's neither.
 */
function useSetupDraft(jobs: SetupJobView[]) {
	const ready = jobs.some((job) => job.job === "draft" && job.status === "done");
	const { data } = useQuery({ ...planDraftQuery(), enabled: ready });
	return { draft: ready ? (data ?? null) : null, waiting: jobs.length > 0 && !ready };
}

const formatAmount = (cents: number) => formatMoneyInput(cents);

/** Said while the spending is still being read: the starter list now, amounts later. */
function SuggestLater({ jobs }: { jobs: SetupJobView[] }) {
	const { waiting } = useSetupDraft(jobs);
	return waiting ? (
		<p className="text-[13px] text-muted-foreground" role="status">
			We’ll suggest amounts when your spending is in.
		</p>
	) : null;
}

const toBill = ({ amount: _a, suggested: _s, ...bill }: BillRow): SetupBill => ({
	...bill,
	name: bill.name.trim(),
});
const toBucket = ({ amount: _a, suggested: _s, ...bucket }: BucketRow): SetupBucket => ({
	...bucket,
	name: bucket.name.trim(),
});

/** Step 3: the bills, as Commitments on the Plan from this month on. */
function BillsStep({
	answers,
	jobs,
	onBack,
	onSkip,
	onNext,
}: {
	answers: SetupAnswers;
	jobs: SetupJobView[];
	onBack?: () => void;
	onSkip: () => void;
	onNext: (bills: SetupBill[]) => Promise<unknown>;
}) {
	const queryClient = useQueryClient();
	const { household } = Route.useRouteContext();
	const month = monthKeyAt(new Date(), household.timeZone);
	const plan = useMonthState(month);
	const [rows, setRows] = useState(() => startingBills(answers.bills, formatAmount));
	const { draft } = useSetupDraft(jobs);
	useEffect(() => {
		if (draft?.commitments.length) {
			setRows((current) => mergeDraftBills(current, draft.commitments, formatAmount));
		}
	}, [draft]);
	const ticked = rows.filter((row) => row.ticked);
	const invalid = ticked.some((row) => !row.name.trim() || row.amountCents <= 0);

	const save = useMutation({
		mutationFn: async () => {
			const next = rows.filter((row) => row.name.trim()).map(toBill);
			const writes = planBillWrites(answers.bills, next, plan.commitments);
			const terms = (bill: SetupBill) => ({
				commitmentId: bill.id,
				month,
				name: bill.name,
				amountCents: bill.amountCents,
				cadence: bill.cadence,
				dueDate: dueDateFor(bill, month),
			});
			await Promise.all([
				...writes.add.map((bill) => addCommitment({ data: terms(bill) })),
				...writes.update.map((bill) =>
					updateCommitment({ data: { ...terms(bill), scope: "from-on" } }),
				),
				...writes.end.map((commitmentId) => endCommitment({ data: { commitmentId, month } })),
				writes.accept.length
					? acceptDraft({
							data: {
								commitments: writes.accept.map((bill) => ({
									key: bill.draftKey ?? bill.key,
									...terms(bill),
								})),
							},
						})
					: null,
			]);
			void queryClient.invalidateQueries({ queryKey: monthsKey });
			await onNext(writes.rows);
		},
	});

	return (
		<StepFrame
			title="Bills"
			lead={
				// Still offered here while nothing has come in, for a Parent who went past it.
				jobs.some((job) => job.job === "history" && job.status === "done") ? null : (
					<SpendingCard path={answers.path} jobs={jobs} />
				)
			}
			intro={
				<>
					Tick the bills you pay, with what each one usually costs and the day it’s due. Noodle
					calls these Commitments <TermHelp term="commitment" />: money spoken for before anything
					else.
				</>
			}
			primary="Continue"
			onBack={onBack}
			onSkip={onSkip}
			pending={save.isPending}
			disabled={invalid}
			onSubmit={() => !invalid && save.mutate()}
			aside={
				<p className="text-sm text-muted-foreground">
					Bills:{" "}
					<span className="font-medium text-foreground tabular-nums">
						{formatMoney(billsMonthly(ticked))}
					</span>{" "}
					a month
				</p>
			}
		>
			<SuggestLater jobs={jobs} />
			<SetupBills rows={rows} onChange={setRows} />
			{save.isError ? <FormError>We couldn’t save your bills. Please try again.</FormError> : null}
		</StepFrame>
	);
}

/** Step 4: the starter Buckets, with suggested amounts and what's left to plan. */
function BucketsStep({
	answers,
	jobs,
	onBack,
	onSkip,
	onNext,
}: {
	answers: SetupAnswers;
	jobs: SetupJobView[];
	onBack?: () => void;
	onSkip: () => void;
	onNext: (buckets: SetupBucket[]) => Promise<unknown>;
}) {
	const queryClient = useQueryClient();
	const { household, parentId } = Route.useRouteContext();
	const month = monthKeyAt(new Date(), household.timeZone);
	const plan = useMonthState(month);
	const { data: people } = useSuspenseQuery(householdParentsQuery());
	const me = people.parents.find((parent) => parent.id === parentId);
	const takeHome = answers.takeHomePayCents ?? plan.baseline ?? 0;
	const afterBills = takeHome - billsMonthly(answers.bills ?? []);
	const [rows, setRows] = useState(() => {
		const starting = startingBuckets(answers.buckets, me?.name, formatAmount);
		// Saved rows keep what was written; only a first visit's list is scaled from what's left.
		return answers.buckets?.length ? starting : scaleBuckets(starting, afterBills, formatAmount);
	});
	const { draft } = useSetupDraft(jobs);
	useEffect(() => {
		if (draft?.buckets.length) {
			setRows((current) => mergeDraftBuckets(current, draft.buckets, formatAmount));
		}
	}, [draft]);
	const left = afterBills - bucketsTotal(rows);
	const invalid = rows.some((row) => row.kept && !row.name.trim());

	const save = useMutation({
		mutationFn: async () => {
			const next = rows.filter((row) => row.name.trim()).map(toBucket);
			const writes = planBucketWrites(answers.buckets, next, plan.buckets, parentId ?? "");
			const color = (bucket: SetupBucket) => (next.indexOf(bucket) % 8) + 1;
			await Promise.all([
				...writes.add.map((bucket) =>
					addBucket({
						data: {
							bucketId: bucket.id,
							month,
							name: bucket.name,
							color: color(bucket),
							allowanceCents: bucket.amountCents,
							rolling: bucket.rolling,
						},
					}),
				),
				...writes.addPersonal.map((bucket) =>
					addPersonalAllowance({
						data: {
							bucketId: bucket.id,
							month,
							name: bucket.name,
							color: color(bucket),
							allowanceCents: bucket.amountCents,
						},
					}),
				),
				writes.accept.length
					? acceptDraft({
							data: {
								buckets: writes.accept.map((bucket) => ({
									key: bucket.draftKey ?? bucket.key,
									bucketId: bucket.id,
									name: bucket.name,
									allowanceCents: bucket.amountCents,
								})),
							},
						})
					: null,
			]);
			await Promise.all([
				...writes.rename.map((bucket) =>
					updateBucket({ data: { bucketId: bucket.id, name: bucket.name } }),
				),
				...writes.amount.map((bucket) =>
					setAllowance({
						data: { bucketId: bucket.id, month, amountCents: bucket.amountCents, scope: "from-on" },
					}),
				),
				...writes.rolling.map((bucket) =>
					setCarriesOver({ data: { bucketId: bucket.id, month, rolling: bucket.rolling } }),
				),
				...writes.archive.map((bucketId) => archiveBucket({ data: { bucketId, month } })),
			]);
			void queryClient.invalidateQueries({ queryKey: monthsKey });
			await onNext(writes.rows);
		},
	});

	return (
		<StepFrame
			title="Buckets"
			intro={
				<>
					A Bucket <TermHelp term="bucket" /> is what you plan to spend on one kind of thing each
					month. Start with these, and change the names and amounts to fit.
				</>
			}
			primary="Continue"
			onBack={onBack}
			onSkip={onSkip}
			pending={save.isPending}
			disabled={invalid}
			onSubmit={() => !invalid && save.mutate()}
			aside={
				<p className="text-sm text-muted-foreground" aria-live="polite">
					Left to plan:{" "}
					<span
						className={`font-medium tabular-nums ${left < 0 ? "text-over-foreground" : "text-foreground"}`}
					>
						{formatMoney(left)}
					</span>
					{left < 0 ? " (more than you bring in)" : null}
				</p>
			}
		>
			<SuggestLater jobs={jobs} />
			<CarriesOverHelp />
			<StarterBucketPicker rows={rows} onChange={setRows} />
			{save.isError ? (
				<FormError>We couldn’t save your Buckets. Please try again.</FormError>
			) : null}
		</StepFrame>
	);
}

const GOAL_KINDS: { value: SetupGoalKind; label: string; description: string }[] = [
	{
		value: "emergency",
		label: "Emergency fund",
		description: "Money set aside for surprises, like a car repair or a big bill. Most start here.",
	},
	{
		value: "save",
		label: "Save for something",
		description: "A trip, a new couch, a holiday: a target amount, saved a little each month.",
	},
	{
		value: "payoff",
		label: "Pay off a card or loan",
		description: "Extra payments each month until what’s owed is $0.",
	},
];

/** Step 5: one Goal, if the Parent wants one now (ADR-0019 for paying off a card or loan). */
function GoalStep({
	answers,
	onBack,
	onSkip,
	onNext,
}: {
	answers: SetupAnswers;
	onBack?: () => void;
	onSkip: () => void;
	onNext: (goal: SetupGoal | null) => Promise<unknown>;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const added = answers.goal;
	const [kind, setKind] = useState<SetupGoalKind | undefined>(added?.kind);
	const [name, setName] = useState("");
	const [target, setTarget] = useState("");
	const [owed, setOwed] = useState<"credit-card" | "loan">("credit-card");
	// Money for a Goal can stay in a savings Account the Household already has (from a bank or a
	// statement), so setup doesn't add a second one.
	const savings = useSuspenseQuery(goalsQuery()).data.accounts.filter(
		(account) => account.kind === "savings",
	);
	const [keptIn, setKeptIn] = useState(() => savings[0]?.id ?? "new");
	const targetCents = parseDollars(target);
	const goalName = kind === "emergency" ? "Emergency fund" : name.trim();
	const ready = !!kind && !!goalName && targetCents !== null && targetCents > 0;
	const threeMonths = billsMonthly(answers.bills ?? []) * 3;

	const save = useMutation({
		mutationFn: async () => {
			if (added) return onNext(added);
			if (!kind || !ready || targetCents === null) return;
			const existing =
				kind === "payoff" ? undefined : savings.find((account) => account.id === keptIn);
			const goal: SetupGoal = {
				kind,
				goalId: ulid(),
				accountId: existing?.id ?? ulid(),
				balanceId: ulid(),
				claimId: ulid(),
				name: goalName,
				accountName:
					existing?.name.trim().slice(0, 40) || (kind === "payoff" ? goalName : "Savings"),
				targetCents,
				accountKind: kind === "payoff" ? owed : "savings",
			};
			if (!existing) {
				await addAccount({
					data: {
						accountId: goal.accountId,
						name: goal.accountName,
						kind: goal.accountKind,
						balanceCents: kind === "payoff" ? targetCents : null,
						balanceId: goal.balanceId,
					},
				});
			}
			const result = await addGoal({
				data: {
					goalId: goal.goalId,
					kind: kind === "payoff" ? "payoff" : "save",
					accountId: goal.accountId,
					name: goal.name,
					targetCents,
					targetDate: null,
					claimId: goal.claimId,
					claimCents: 0,
				},
			});
			if (!result.ok) throw new Error("refused");
			if (kind === "emergency") await setEmergencyGoal({ data: { goalId: goal.goalId } });
			void queryClient.invalidateQueries({ queryKey: monthsKey });
			await onNext(goal);
		},
	});

	return (
		<StepFrame
			title="One Goal"
			intro={
				<>
					A Goal <TermHelp term="goal" /> is something you’re saving for, or a card or loan you’re
					paying off. Pick one to start, or skip this for now.
				</>
			}
			primary={added ? "Continue" : "Add Goal"}
			onBack={onBack}
			onSkip={added ? undefined : onSkip}
			pending={save.isPending}
			disabled={!added && !ready}
			onSubmit={() => save.mutate()}
		>
			{added ? (
				<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm">
					<span>{added.name}</span>
					<span className="font-medium tabular-nums">{formatMoney(added.targetCents)}</span>
				</Card>
			) : (
				<>
					<RadioGroup
						value={kind ?? ""}
						onValueChange={(value) => setKind(value as SetupGoalKind)}
						aria-label="What kind of Goal?"
					>
						{GOAL_KINDS.map((choice) => (
							<RadioGroupCard
								key={choice.value}
								id={`${id}-${choice.value}`}
								value={choice.value}
								label={choice.label}
								description={choice.description}
							/>
						))}
					</RadioGroup>
					{kind === "payoff" ? (
						<RadioGroup
							value={owed}
							onValueChange={(value) => setOwed(value as "credit-card" | "loan")}
							aria-label="A card or a loan?"
							className="grid-cols-2"
						>
							<RadioGroupCard id={`${id}-card`} value="credit-card" label="Credit card" />
							<RadioGroupCard id={`${id}-loan`} value="loan" label="Loan" />
						</RadioGroup>
					) : null}
					{kind && kind !== "payoff" && savings.length > 0 ? (
						<fieldset className="grid gap-3">
							<legend className="pb-3 text-sm font-medium">Where will you keep this money?</legend>
							<RadioGroup
								value={keptIn}
								onValueChange={setKeptIn}
								aria-label="Where will you keep this money?"
							>
								{savings.map((account) => (
									<RadioGroupCard
										key={account.id}
										id={`${id}-in-${account.id}`}
										value={account.id}
										label={account.name}
										description="A savings Account you already have."
									/>
								))}
								<RadioGroupCard
									id={`${id}-in-new`}
									value="new"
									label="A new savings Account"
									description="Noodle adds one called Savings."
								/>
							</RadioGroup>
						</fieldset>
					) : null}
					{kind && kind !== "emergency" ? (
						<Field
							label={kind === "payoff" ? "Which card or loan?" : "What for?"}
							htmlFor={`${id}-name`}
						>
							<Input
								id={`${id}-name`}
								value={name}
								maxLength={40}
								placeholder={kind === "payoff" ? "e.g. Visa" : "e.g. Summer trip"}
								onChange={(event) => setName(event.currentTarget.value)}
							/>
						</Field>
					) : null}
					{kind ? (
						<Field
							label={kind === "payoff" ? "What’s owed on it now?" : "How much?"}
							htmlFor={`${id}-target`}
							hint={
								kind === "emergency" && threeMonths > 0
									? `Three months of bills is about ${formatMoney(threeMonths)}.`
									: undefined
							}
						>
							<AmountInput
								id={`${id}-target`}
								placeholder="0"
								value={target}
								onChange={(event) => setTarget(event.currentTarget.value)}
							/>
						</Field>
					) : null}
				</>
			)}
			{save.isError ? <FormError>We couldn’t add that Goal. Please try again.</FormError> : null}
		</StepFrame>
	);
}
