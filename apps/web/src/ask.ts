import { useCallback, useRef, useState } from "react";
import { ulid } from "ulid";
import { askHousehold } from "./server/ask";
import type { AskFact, AskLink } from "./server/ask-tools";

// Ask's questions for this visit. Nothing is saved: the page keeps each question with its answer
// as it streams in, and sends the last few back so a follow-up has its context (ADR-0012).

export type AskStatus = "asking" | "answering" | "answered" | "failed";

export type AskTurnState = {
	id: string;
	question: string;
	status: AskStatus;
	/** What's been looked at so far, e.g. "Adding up spending". */
	steps: string[];
	facts: AskFact[];
	links: AskLink[];
	answer: string;
};

/** Earlier answered turns sent back with a question. */
const HISTORY = 3;

export function useAsk() {
	const [turns, setTurns] = useState<AskTurnState[]>([]);
	const turnsRef = useRef(turns);
	turnsRef.current = turns;

	const update = useCallback((id: string, change: (turn: AskTurnState) => AskTurnState) => {
		setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));
	}, []);

	const run = useCallback(
		async (id: string, question: string) => {
			const history = turnsRef.current
				.filter((turn) => turn.id !== id && turn.status === "answered")
				.slice(-HISTORY)
				.map((turn) => ({ question: turn.question, answer: turn.answer.slice(0, 2000) }));
			let finished = false;
			try {
				for await (const event of await askHousehold({ data: { question, history } })) {
					switch (event.type) {
						case "step":
							update(id, (turn) => ({ ...turn, steps: [...turn.steps, event.label] }));
							break;
						case "result":
							update(id, (turn) => ({ ...turn, facts: event.facts, links: event.links }));
							break;
						case "text":
							update(id, (turn) => ({
								...turn,
								status: "answering",
								answer: turn.answer + event.text,
							}));
							break;
						case "error":
							break;
						case "done":
							finished = true;
							update(id, (turn) => ({ ...turn, status: "answered" }));
							break;
					}
				}
			} catch {
				// Fall through: the question failed.
			}
			if (!finished) update(id, (turn) => ({ ...turn, status: "failed" }));
		},
		[update],
	);

	const ask = useCallback(
		(question: string) => {
			const id = ulid();
			setTurns((all) => [...all, blankTurn(id, question)]);
			void run(id, question);
		},
		[run],
	);

	const retry = useCallback(
		(id: string) => {
			const turn = turnsRef.current.find((t) => t.id === id);
			if (!turn) return;
			update(id, () => blankTurn(id, turn.question));
			void run(id, turn.question);
		},
		[run, update],
	);

	const busy = turns.some((turn) => turn.status === "asking" || turn.status === "answering");
	return { turns, ask, retry, busy };
}

const blankTurn = (id: string, question: string): AskTurnState => ({
	id,
	question,
	status: "asking",
	steps: [],
	facts: [],
	links: [],
	answer: "",
});
