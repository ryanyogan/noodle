import type { AskMessage, AskModel } from "./ask-model";
import {
	type AskContext,
	type AskFact,
	type AskLink,
	askVocabulary,
	isToolName,
	runTool,
	TOOL_SPECS,
	ToolArgumentError,
	toolStep,
} from "./ask-tools";

// One Ask: the model picks tools, the tools compute the Household's figures for the asking Parent,
// and the model phrases an answer from them, streamed as it's written (ADR-0012). Nothing is kept:
// the Parent's page holds this visit's questions and sends the last few back for context.

/** What the Parent's page hears while a question is answered, in order. */
export type AskEvent =
	| { type: "step"; label: string }
	| { type: "result"; facts: AskFact[]; links: AskLink[] }
	| { type: "text"; text: string }
	| { type: "error" }
	| { type: "done" };

/** An earlier question in this visit, and the answer it got. */
export type AskTurn = { question: string; answer: string };

/** Tool rounds before the model must answer (a second lets it fix arguments a tool refused). */
const MAX_ROUNDS = 2;
const MAX_CALLS_PER_ROUND = 3;
const MAX_FACTS = 8;

const COULD_NOT_ANSWER =
	"I couldn't work that out from the Household's numbers. Try asking another way.";
const USE_A_TOOL =
	"Don't state amounts yourself. Call a tool for every figure, or ask the Parent for what's missing.";

/** Text quoting an amount: "$50", or a number like "1,200". */
const quotesAmounts = (text: string) => /\$\s?\d|\d+(,\d{3})+/.test(text);

export async function* runAsk(input: {
	ctx: AskContext;
	model: AskModel;
	question: string;
	history: AskTurn[];
}): AsyncGenerator<AskEvent> {
	const { ctx, model } = input;
	try {
		const messages: AskMessage[] = [
			{ role: "system", content: instructions(await askVocabulary(ctx)) },
			...input.history.flatMap((turn): AskMessage[] => [
				{ role: "user", content: turn.question },
				{ role: "assistant", content: turn.answer },
			]),
			{ role: "user", content: input.question },
		];

		const summaries: string[] = [];
		const facts: AskFact[] = [];
		const links: AskLink[] = [];
		for (let round = 0; round < MAX_ROUNDS; round++) {
			const { toolCalls, text } = await model.turn(messages, TOOL_SPECS);
			const calls = toolCalls.slice(0, MAX_CALLS_PER_ROUND);
			if (calls.length === 0) {
				if (summaries.length > 0) break;
				// No tools wanted: fine for a question back (a missing price), never for figures,
				// which only a tool may give. The model is told so once, then Ask gives up.
				if (!quotesAmounts(text)) {
					yield { type: "text", text: text.trim() || COULD_NOT_ANSWER };
					yield { type: "done" };
					return;
				}
				if (round === MAX_ROUNDS - 1) {
					yield { type: "text", text: COULD_NOT_ANSWER };
					yield { type: "done" };
					return;
				}
				messages.push({ role: "system", content: USE_A_TOOL });
				continue;
			}
			messages.push({ role: "assistant", content: null, toolCalls: calls });
			for (const call of calls) {
				let content: Record<string, unknown>;
				if (!isToolName(call.name)) {
					content = { error: `There is no tool named ${call.name}.` };
				} else {
					yield { type: "step", label: toolStep[call.name] };
					try {
						const outcome = await runTool(call.name, parseArguments(call.arguments), ctx);
						summaries.push(outcome.summary);
						facts.push(...outcome.facts);
						links.push(...outcome.links);
						content = { summary: outcome.summary, ...outcome.data };
					} catch (error) {
						if (!(error instanceof ToolArgumentError)) throw error;
						content = { error: error.message };
					}
				}
				messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(content) });
			}
		}

		if (summaries.length > 0) {
			yield {
				type: "result",
				facts: uniqueFacts(facts).slice(0, MAX_FACTS),
				links: uniqueLinks(links),
			};
		}
		let answered = false;
		for await (const text of model.answer(messages)) {
			if (!text) continue;
			answered = true;
			yield { type: "text", text };
		}
		if (!answered) {
			// The model said nothing: the tools' own sentences still answer the question.
			yield {
				type: "text",
				text: summaries.join(" ") || COULD_NOT_ANSWER,
			};
		}
		yield { type: "done" };
	} catch (error) {
		console.error("Ask failed", error);
		yield { type: "error" };
	}
}

function parseArguments(json: string): unknown {
	try {
		return JSON.parse(json || "{}");
	} catch {
		return {};
	}
}

const uniqueFacts = (facts: AskFact[]) => [
	...new Map(facts.map((fact) => [fact.label, fact])).values(),
];

const uniqueLinks = (links: AskLink[]) => [
	...new Map(links.map((link) => [JSON.stringify(link), link])).values(),
];

/** The model's instructions: the rules, today, and every name the tools accept. */
export function instructions(vocabulary: Awaited<ReturnType<typeof askVocabulary>>): string {
	const members = vocabulary.members.map(
		(m) =>
			`${m.name} (${m.kind === "parent" ? "Parent" : "Child"}${m.you ? ", the Parent asking" : ""})`,
	);
	const buckets = vocabulary.buckets.map((b) =>
		b.owner ? `${b.name} (Personal Allowance: ${b.owner})` : b.name,
	);
	return [
		"You answer a Parent's questions about their Household's budget in Noodle.",
		"Rules:",
		"- Get every figure from a tool. Quote amounts exactly as the tool gives them; never add, subtract or estimate yourself.",
		"- For an Affordability Check you need a price. If the Parent didn't give one, ask for it and call no tool.",
		"- For what ending or changing a Commitment, or changing a Bucket's allowance, would do, call a Scenario tool; the Parent can then try it in Explore.",
		"- If a tool can't answer, say what you can't see rather than guessing.",
		"- Another Parent's Personal Allowance is private: only its totals exist for you, never what was bought.",
		"- Answer in 1 to 3 plain sentences, no lists, no headings, no markdown.",
		"- Use Noodle's words: take-home pay, Bucket, Free to Spend, Commitment, Goal, set aside, Extra income, pace, Personal Allowance. Never say Baseline, Earmark, Windfall or Cushion.",
		"",
		`Today: ${vocabulary.today} (month ${vocabulary.month}).`,
		`Members: ${members.join("; ")}`,
		`Buckets: ${buckets.join("; ")}`,
		`Commitments: ${vocabulary.commitments.join("; ")}`,
		`Goals: ${vocabulary.goals.join("; ")}`,
	].join("\n");
}
