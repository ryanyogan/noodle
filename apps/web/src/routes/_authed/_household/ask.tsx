import { monthKeyAt } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { ArrowUp, LoaderCircle, RotateCcw, Telescope } from "lucide-react";
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

	return (
		<>
			<PageHeader className="max-w-2xl" title="Ask" />
			<div className="grid max-w-2xl gap-8">
				{turns.length === 0 ? (
					<div className="grid gap-3">
						<p className="text-sm text-muted-foreground">
							Ask about your Plan, spending, Goals, or whether you can afford something. Answers use
							your Household's real numbers.
						</p>
						<div className="flex flex-wrap gap-2">
							{SUGGESTIONS.map((suggestion) => (
								<Button
									key={suggestion}
									variant="outline"
									size="sm"
									disabled={!hydrated}
									onClick={() => ask(suggestion)}
								>
									{suggestion}
								</Button>
							))}
						</div>
					</div>
				) : (
					<div className="grid gap-8">
						{turns.map((turn) => (
							<Turn key={turn.id} turn={turn} onRetry={() => retry(turn.id)} />
						))}
					</div>
				)}
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
						disabled={!hydrated}
					/>
					<Button
						type="submit"
						size="icon"
						className="size-9 shrink-0 rounded-xl"
						aria-label="Ask"
						disabled={!hydrated || busy || !question.trim()}
					>
						<ArrowUp />
					</Button>
				</form>
				<div ref={end} />
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
								<LoaderCircle className="size-3.5 animate-spin" aria-hidden />
								{turn.steps.at(-1) ?? "Thinking"}
							</p>
							<Skeleton className="h-4 w-4/5" />
							<Skeleton className="h-4 w-3/5" />
						</div>
					) : (
						<p className="text-[15px] leading-relaxed whitespace-pre-line">{turn.answer}</p>
					)}
					{turn.facts.length > 0 ? (
						<List aria-label="Figures">
							{turn.facts.map((fact) => (
								<ListRow
									key={fact.label}
									title={<span className="font-normal text-muted-foreground">{fact.label}</span>}
									trailing={
										<span className="text-sm font-medium tabular-nums">
											{formatMoney(fact.amount)}
										</span>
									}
									className="py-2.5"
								/>
							))}
						</List>
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
