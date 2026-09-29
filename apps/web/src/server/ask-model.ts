import { AI_MODELS } from "@noodle/ai";
import type { ToolSpec } from "./ask-tools";

// The language model behind Ask, behind a small interface so the ask loop is the same for Workers
// AI and for the deterministic fake E2E and unit tests use (ADR-0012). The model only picks tools
// and phrases what they computed; it never sees a number a tool didn't hand it.

/** A tool call the model asked for: its arguments are JSON text, as the model wrote them. */
export type ToolCall = { id: string; name: string; arguments: string };

/** A message of an Ask conversation, in the chat-completions shape. */
export type AskMessage =
	| { role: "system" | "user"; content: string }
	| { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
	| { role: "tool"; toolCallId: string; content: string };

export type AskModel = {
	/** One turn with tools on offer: the tools the model wants run, or its text if it wants none. */
	turn(messages: AskMessage[], tools: ToolSpec[]): Promise<{ toolCalls: ToolCall[]; text: string }>;
	/** The final answer, streamed as text as it's written. */
	answer(messages: AskMessage[]): AsyncIterable<string>;
};

// ---------------------------------------------------------------------------------------------
// Workers AI

function toChatMessage(message: AskMessage): ChatCompletionMessageParam {
	switch (message.role) {
		case "assistant":
			return {
				role: "assistant",
				content: message.content,
				...(message.toolCalls?.length
					? {
							tool_calls: message.toolCalls.map((call) => ({
								id: call.id,
								type: "function" as const,
								function: { name: call.name, arguments: call.arguments },
							})),
						}
					: {}),
			};
		case "tool":
			return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
		default:
			return { role: message.role, content: message.content };
	}
}

/**
 * Ask on Workers AI, through the AI Gateway `gatewayId`. `collectLog: false` on every request:
 * gateway logs are visible to anyone on the Cloudflare account, and must never hold a Parent's
 * questions about their own Personal Allowance.
 */
export function workersAiModel(ai: Ai, gatewayId: string): AskModel {
	const options = { gateway: { id: gatewayId, collectLog: false } };
	// The chat model's reasoning can't be switched off, only kept low.
	const common = { reasoning_effort: "low" as const, max_completion_tokens: 2048 };
	return {
		async turn(messages, tools) {
			const out = await ai.run(
				AI_MODELS.chat,
				{
					...common,
					messages: messages.map(toChatMessage),
					tools: tools.map((tool) => ({ type: "function" as const, function: tool })),
					tool_choice: "auto",
				},
				options,
			);
			const message = out.choices[0]?.message;
			const toolCalls = (message?.tool_calls ?? []).flatMap((call) =>
				call.type === "function"
					? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
					: [],
			);
			return { toolCalls, text: typeof message?.content === "string" ? message.content : "" };
		},
		async *answer(messages) {
			const stream = await ai.run(
				AI_MODELS.chat,
				{ ...common, messages: messages.map(toChatMessage), stream: true },
				options,
			);
			yield* textOfEvents(stream as ReadableStream<Uint8Array>);
		},
	};
}

/**
 * The answer's text from a streamed chat completion: server-sent events of
 * `data: {"choices":[{"delta":{"content":"…"}}]}` ending with `data: [DONE]` (or the older
 * Workers AI `data: {"response":"…"}`). The model's reasoning, sent as `delta.reasoning_content`,
 * is left out.
 */
export async function* textOfEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
	const decoder = new TextDecoder();
	let buffer = "";
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = done ? "" : (lines.pop() ?? "");
			for (const line of lines) {
				if (!line.startsWith("data:")) continue;
				const data = line.slice(5).trim();
				if (data === "[DONE]") return;
				const text = textOfEvent(data);
				if (text) yield text;
			}
			if (done) return;
		}
	} finally {
		reader.releaseLock();
	}
}

function textOfEvent(data: string): string {
	try {
		const event = JSON.parse(data) as {
			choices?: { delta?: { content?: unknown } }[];
			response?: unknown;
		};
		const content = event.choices?.[0]?.delta?.content ?? event.response;
		return typeof content === "string" ? content : "";
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------------------------
// The fake

/**
 * A deterministic stand-in for the model, for E2E and unit tests (AI_MODEL=stub): it picks a
 * tool from keywords in the question, and answers with the tools' own summaries.
 */
export const stubModel: AskModel = {
	async turn(messages) {
		if (messages.some((m) => m.role === "tool")) return { toolCalls: [], text: "" };
		const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
		const system = messages.find((m) => m.role === "system")?.content ?? "";
		const call = stubToolCall(question, system);
		if (!call)
			return { toolCalls: [], text: "What does it cost? Tell me the price and I'll check." };
		return { toolCalls: [{ id: "call-1", ...call }], text: "" };
	},
	async *answer(messages) {
		const summaries = messages.flatMap((m) => {
			if (m.role !== "tool") return [];
			const result = JSON.parse(m.content) as { summary?: string; error?: string };
			return result.summary ? [result.summary] : [];
		});
		for (const word of summaries.join(" ").split(/(?<= )/)) yield word;
	},
};

const priceIn = (text: string) => {
	const match = /\$\s?([\d,]+(?:\.\d{1,2})?)/.exec(text);
	return match?.[1] ? Number(match[1].replace(/,/g, "")) : undefined;
};

/** Names listed on a line of the instructions, e.g. `Buckets: Groceries; Hockey`. */
function namesOn(system: string, heading: string): string[] {
	const line = system.split("\n").find((l) => l.startsWith(`${heading}: `));
	return (line?.slice(heading.length + 2).split("; ") ?? []).map((n) => n.replace(/ \(.*\)$/, ""));
}

function stubToolCall(question: string, system: string): Omit<ToolCall, "id"> | undefined {
	const q = question.toLowerCase();
	const call = (name: string, args: Record<string, unknown>) => ({
		name,
		arguments: JSON.stringify(args),
	});
	const whatIf =
		/what if (?:the |our |my )?(.+?)\s+(?:(?:was|were|is|went|goes)\s+)?(?:(?:to|at)\s+)?\$([\d,]+)/i.exec(
			question,
		);
	const commitments = namesOn(system, "Commitments").filter(Boolean);
	const isCommitment = (name: string) =>
		commitments.some((c) => c.toLowerCase() === name.trim().toLowerCase());
	if (whatIf?.[1] && whatIf[2]) {
		const amount = Number(whatIf[2].replace(/,/g, ""));
		return isCommitment(whatIf[1])
			? call("commitment_scenario", { commitment: whatIf[1], amount })
			: call("allowance_scenario", { bucket: whatIf[1], allowance: amount });
	}
	const ending = /\b(?:cancel(?:led)?|end(?:ed)?|stop(?:ped)?|drop(?:ped)?)\s+(.+?)[?.!]*$/i.exec(
		question,
	);
	if (ending?.[1]) {
		const name = ending[1].replace(/^(?:the|our|my)\s+/i, "");
		if (isCommitment(name)) return call("commitment_scenario", { commitment: name });
	}
	if (q.includes("afford")) {
		const price = priceIn(question);
		if (price === undefined) return undefined;
		const name = question
			.replace(/^.*afford\s+/i, "")
			.replace(/\$\s?[\d,.]+/, "")
			.replace(/\s+(in|by|for|this|next)\b.*$/i, "")
			.replace(/^(a|an|the)\s+/i, "")
			.replace(/[?.!]+$/, "")
			.trim();
		return call("affordability_check", { price, ...(name ? { name } : {}) });
	}
	if (q.includes("goal")) return call("goals", {});
	if (/\b(spen[dt]|cost|paid)\b/.test(q)) {
		const names = [...namesOn(system, "Buckets"), ...namesOn(system, "Commitments")];
		const name = names.find((n) => n && q.includes(n.toLowerCase()));
		return call("spending", name ? { name } : {});
	}
	return call("month_overview", {});
}
