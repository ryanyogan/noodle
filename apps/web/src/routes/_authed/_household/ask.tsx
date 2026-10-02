import { monthKeyAt } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Spinner } from "@noodle/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { ArrowUp, RotateCcw, Telescope } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type AskTurnState, useAsk } from "../../../ask";
import { formatMoney, monthName } from "../../../format";
import { type ExploreTry, useTryInExplore } from "../../../scenarios";
import type { AskLink } from "../../../server/ask-tools";

// Ask: plain-language questions about the Household's money, answered from its real numbers
// (ADR-0012). Each answer shows the exact figures it drew on and links to the screens with more.

export const Route = createFileRoute("/_authed/_household/ask")({
	component: AskPage,
});

const SUGGESTIONS = [
	"How are we doing this month?",
	"How much have we spent this year?",
	"Are our Goals on track?",
	"Can we afford a $2,000 trip?",
];

function AskPage() {
	const { turns, ask, retry, busy } = useAsk();
	const hydrated = useHydrated();
	const [question, setQuestion] = useState("");
	const end = useRef<HTMLDivElement>(null);

	// Keep the latest question and its answer in view as it streams in.
	const last = turns.at(-1);
	useEffect(() => {
		if (last) end.current?.scrollIntoView({ block: "nearest" });
	}, [last]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const text = question.trim();
		if (!text || busy) return;
		ask(text);
		setQuestion("");
	};

	// Screen readers hear the finished answer once; the streaming article stays quiet.
	const announcement =
		last?.status === "answered"
			? `Answer: ${last.answer}`
			: last?.status === "failed"
				? "Ask couldn't answer. Retry is below the question."
				: "";

	const suggestions = (
		<div className="flex flex-wrap gap-2">
			{SUGGESTIONS.map((suggestion) => (
				<Button
					key={suggestion}
					variant="outline"
					size="sm"
					disabled={!hydrated || busy}
					onClick={() => ask(suggestion)}
				>
					{suggestion}
				</Button>
			))}
		</div>
	);

	return (
		<>
			<PageHeader title="Ask" />
			<div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
				<div className="grid max-w-3xl gap-8">
					{turns.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Ask about your Plan, spending, Goals, or whether you can afford something. Answers use
							your Household's real numbers.
						</p>
					) : (
						<div className="grid gap-8">
							{turns.map((turn) => (
								<Turn key={turn.id} turn={turn} onRetry={() => retry(turn.id)} />
							))}
						</div>
					)}
					<p role="status" className="sr-only">
						{announcement}
					</p>
					<div
						ref={end}
						className="sticky bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+8px)] z-10 -mx-2 grid gap-2.5 rounded-2xl bg-background/90 px-2 pt-2 pb-2 backdrop-blur lg:bottom-4"
					>
						{suggestions}
						<form onSubmit={submit} className="flex items-center gap-2">
							<label htmlFor="ask-question" className="sr-only">
								Question
							</label>
							<Input
								id="ask-question"
								value={question}
								onChange={(event) => setQuestion(event.target.value)}
								placeholder="Ask about your money"
								maxLength={500}
								autoComplete="off"
								aria-describedby="ask-kept"
								disabled={!hydrated}
							/>
							<Button
								type="submit"
								size="icon-lg"
								aria-label="Ask"
								disabled={!hydrated || busy || !question.trim()}
							>
								<ArrowUp />
							</Button>
						</form>
						<p id="ask-kept" className="text-xs text-muted-foreground">
							Questions aren't saved. They're gone when you leave this page.
						</p>
					</div>
				</div>
				<aside
					aria-labelledby="ask-sees"
					className="hidden rounded-2xl border bg-card p-(--card-pad) shadow-card xl:sticky xl:top-6 xl:grid xl:gap-3"
				>
					<h2 id="ask-sees" className="text-sm font-semibold">
						What Ask can see
					</h2>
					<ul className="grid list-disc gap-1.5 ps-4 text-sm text-muted-foreground">
						<li>Your Plan, Buckets and Commitments</li>
						<li>Spending and Transactions</li>
						<li>Goals and how they're tracking</li>
						<li>Whether you can afford something</li>
					</ul>
					<p className="text-sm text-muted-foreground">
						Each answer lists the figures it used, with links to the screens that have more.
					</p>
				</aside>
			</div>
		</>
	);
}

function Turn({ turn, onRetry }: { turn: AskTurnState; onRetry: () => void }) {
	const waiting = turn.status === "asking";
	return (
		<article className="grid gap-3" aria-busy={waiting || turn.status === "answering"}>
			<p className="justify-self-end rounded-2xl border bg-card px-3.5 py-2 text-sm">
				{turn.question}
			</p>
			{turn.status === "failed" ? (
				<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
					<span>Couldn't answer that just now.</span>
					<Button variant="outline" size="sm" onClick={onRetry}>
						<RotateCcw />
						Retry
					</Button>
				</div>
			) : (
				<>
					{waiting ? (
						<div className="grid gap-2">
							<p className="flex items-center gap-2 text-[13px] text-muted-foreground">
								<Spinner className="size-3.5" />
								{turn.steps.at(-1) ?? "Thinking"}
							</p>
							<Skeleton className="h-4 w-4/5" />
							<Skeleton className="h-4 w-3/5" />
						</div>
					) : (
						<p className="text-[15px] leading-relaxed whitespace-pre-line">{turn.answer}</p>
					)}
					{turn.facts.length > 0 ? (
						<div className="rounded-2xl border bg-card px-(--card-pad) py-1 shadow-card">
							<Table aria-label="Figures">
								<TableCaption className="sr-only">The figures this answer used</TableCaption>
								<TableHeader>
									<TableRow>
										<TableHead scope="col">Figure</TableHead>
										<TableHead scope="col" numeric>
											Amount
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{turn.facts.map((fact) => (
										<TableRow key={fact.label}>
											<th
												scope="row"
												className="py-2.5 text-start text-sm font-normal text-muted-foreground"
											>
												{fact.label}
											</th>
											<TableCell numeric className="py-2.5 text-sm font-medium">
												{formatMoney(fact.amount)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					) : null}
					{turn.links.length > 0 ? (
						<div className={cn("flex flex-wrap gap-2", waiting && "invisible")}>
							{turn.links.map((link) => (
								<AskLinkButton key={JSON.stringify(link)} link={link} />
							))}
						</div>
					) : null}
				</>
			)}
		</article>
	);
}

function AskLinkButton({ link }: { link: AskLink }) {
	const button = (children: ReactNode) => (
		<Button variant="outline" size="sm" asChild>
			{children}
		</Button>
	);
	switch (link.kind) {
		case "month":
			return button(
				<Link to="/month/$month" params={{ month: link.month }}>
					Open {monthName(link.month)}
				</Link>,
			);
		case "transactions":
			return button(
				<Link to="/transactions/$month" params={{ month: link.month }}>
					See Transactions
				</Link>,
			);
		case "goals":
			return button(<Link to="/goals">Open Goals</Link>);
		case "explore":
			return link.lever ? (
				<TryInExplore change={{ name: link.name ?? "Scenario", preset: link.lever }} />
			) : (
				button(<Link to="/explore">Open in Explore</Link>)
			);
		case "afford":
			return button(
				<Link
					to="/explore/afford"
					search={{ kind: "anything", name: link.name || undefined, price: link.price }}
				>
					Open Can we afford it?
				</Link>,
			);
	}
}

/** A Scenario of the change the answer is about, saved and opened in Explore; the Plan stays as it is. */
function TryInExplore({ change }: { change: ExploreTry }) {
	const { household } = Route.useRouteContext();
	const hydrated = useHydrated();
	const tryInExplore = useTryInExplore(monthKeyAt(new Date(), household.timeZone));
	return (
		<Button variant="outline" size="sm" disabled={!hydrated} onClick={() => tryInExplore(change)}>
			<Telescope />
			Try in Explore
		</Button>
	);
}
