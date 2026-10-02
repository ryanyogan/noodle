import { monthKeyAt, parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Logo } from "@noodle/ui/components/logo";
import { RadioGroup, RadioGroupCard } from "@noodle/ui/components/radio-group";
import { Spinner } from "@noodle/ui/components/spinner";
import { Stepper } from "@noodle/ui/components/stepper";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, Suspense, useId, useState } from "react";
import { BankConnections, useConnectBank } from "../../components/bank-connections";
import { AmountInput } from "../../components/goals";
import { formatMoney, formatMoneyInput } from "../../format";
import { useLiveUpdates } from "../../live-updates";
import { monthsKey, setupQuery } from "../../queries";
import { setTakeHomePay } from "../../server/plan";
import { type SetupState, saveSetup, startSetup } from "../../server/setup";
import {
	backgroundStatus,
	canSkip,
	minutesLeft,
	SETUP_STEP_COUNT,
	SETUP_STEPS,
	type SetupAnswers,
	type SetupPath,
} from "../../setup";

// The get-started wizard (#53): a full-screen, step-by-step setup after /welcome creates a
// Household. Progress (step, answers, skipped steps) is saved to D1 after every step, so leaving
// and coming back resumes where the Parent was. Choosing a bank or a statement on Hello starts the
// Setup Workflow, whose jobs the progress header reports as they finish. Steps 3 to 6 are filled
// in by later work; they can be skipped for now.

export const Route = createFileRoute("/_authed/setup")({
	beforeLoad: ({ context }) => {
		if (!context.household || !context.parentId) throw redirect({ to: "/welcome" });
		return { household: context.household };
	},
	loader: ({ context }) => context.queryClient.ensureQueryData(setupQuery()),
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
						onBack={back}
						onNext={(takeHomePayCents) => go(3, { takeHomePayCents })}
					/>
				) : step < SETUP_STEP_COUNT ? (
					<LaterStep
						step={step}
						onBack={back}
						onNext={() => go(step + 1)}
						onSkip={canSkip(step) ? () => go(step + 1, {}, true) : undefined}
					/>
				) : (
					<DoneStep
						answers={answers}
						onBack={back}
						onDone={() => save.mutateAsync({ step, answers, skipped, finished: true })}
					/>
				)}
			</div>
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
}) {
	const hydrated = useHydrated();
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		onSubmit();
	}
	return (
		<form onSubmit={submit} className="flex flex-1 flex-col">
			<div className="grid gap-5 pb-6">
				<div className="grid gap-2">
					<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">{title}</h1>
					{intro ? <p className="text-[15px] text-muted-foreground">{intro}</p> : null}
				</div>
				{children}
			</div>
			<div className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-border bg-background py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
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
					<Button type="submit" size="lg" disabled={!hydrated || pending || disabled}>
						{pending ? <Spinner /> : null}
						{primary}
					</Button>
				</div>
			</div>
		</form>
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
			"Download a statement from your bank (CSV, OFX or PDF) and upload it now and then. Noodle files what it can.",
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
	onBack,
	onNext,
}: {
	answers: SetupAnswers;
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
					path === "hand"
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
					onChange={(event) => setAmount(event.currentTarget.value)}
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
								onClick={() => setAmount(formatMoneyInput(monthly))}
							>
								Use {formatMoney(monthly)}
							</Button>
						</div>
					) : null}
				</Card>
			) : (
				<div>
					<Button
						type="button"
						variant="link"
						className="h-auto px-0"
						onClick={() => setBiweekly(true)}
					>
						Paid every two weeks?
					</Button>
				</div>
			)}
			{set.isError ? (
				<FormError>We couldn’t save your take-home pay. Please try again.</FormError>
			) : null}
			{path === "bank" ? (
				<Suspense fallback={null}>
					<ConnectBankCard />
				</Suspense>
			) : null}
		</StepFrame>
	);
}

/** Connecting the bank chosen on Hello, while setup goes on; the Setup Workflow waits for it. */
function ConnectBankCard() {
	const bank = useConnectBank();
	return <BankConnections bank={bank} />;
}

/** Steps 3 to 6, until later work fills them in. */
function LaterStep({
	step,
	onBack,
	onNext,
	onSkip,
}: {
	step: number;
	onBack?: () => void;
	onNext: () => Promise<unknown>;
	onSkip?: () => void;
}) {
	const { title } = SETUP_STEPS[step - 1] ?? SETUP_STEPS[0];
	return (
		<StepFrame
			title={title}
			intro="This step is coming soon. For now you can set it up from the Plan."
			primary="Continue"
			onBack={onBack}
			onSkip={onSkip}
			onSubmit={() => void onNext()}
		/>
	);
}

/** Step 7: what was set up, then This Month. */
function DoneStep({
	answers,
	onBack,
	onDone,
}: {
	answers: SetupAnswers;
	onBack?: () => void;
	onDone: () => Promise<unknown>;
}) {
	const router = useRouter();
	const finish = useMutation({
		mutationFn: async () => {
			await onDone();
			await router.navigate({ to: "/month" });
		},
	});
	return (
		<StepFrame
			title="You’re set up"
			intro="Here’s your Plan so far. You can change any of it from the Plan."
			primary="Go to This Month"
			onBack={onBack}
			pending={finish.isPending}
			onSubmit={() => finish.mutate()}
		>
			<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm">
				<span>Take-home pay</span>
				<span className="font-medium tabular-nums">
					{answers.takeHomePayCents === undefined
						? "Not set"
						: formatMoney(answers.takeHomePayCents)}
				</span>
			</Card>
		</StepFrame>
	);
}
