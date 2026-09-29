import { AI_MODELS } from "@noodle/ai";
import type { ReceiptLineKind } from "@noodle/domain";
import type { BucketChoice } from "./categorize-model";

// The model behind Receipts, behind one small interface so reading a Receipt is the same for
// Workers AI and for the deterministic fake E2E and unit tests use (ADR-0012). The model only
// reads: what the Receipt says each line is and costs, as printed, and a Bucket and For for each
// item from those offered. Every amount is parsed, checked against the total and shared out by
// @noodle/domain. Calls go through AI Gateway with `collectLog: false`: a Receipt says where a
// Parent spent and on what.

/** What a Receipt arrived as: text (an email's body, a PDF read as text) or a picture of it. */
export type ReceiptInput =
	| { kind: "text"; text: string }
	| { kind: "image"; bytes: Uint8Array; mimeType: string }
	| { kind: "pdf"; bytes: Uint8Array; name: string };

/** A Member an item may be For, by name. */
export type MemberChoice = { id: string; name: string };

/** One line as the model read it: its amount as printed, and for an item a Bucket and For. */
export type ReadLine = {
	text: string;
	kind: ReceiptLineKind;
	amount: string;
	bucketId: string | null;
	confidence: number;
	for: string[];
};

/** What the model read from a Receipt, everything as printed; null for what it couldn't find. */
export type ReceiptReading = {
	merchant: string | null;
	/** The purchase's date, as YYYY-MM-DD. */
	date: string | null;
	total: string | null;
	lines: ReadLine[];
};

export type ReceiptReader = {
	/** Reads a Receipt, choosing each item's Bucket from `buckets` and For from `members` only. */
	read(
		input: ReceiptInput,
		buckets: BucketChoice[],
		members: MemberChoice[],
	): Promise<ReceiptReading>;
};

/** Nothing read: what a Receipt that can't be read, or a failed model call, comes to. */
export const NOTHING_READ: ReceiptReading = { merchant: null, date: null, total: null, lines: [] };

/** How much of a Receipt's text the model sees: far more than any real receipt needs. */
const MAX_TEXT = 16_000;

/** How many lines of a Receipt are kept. */
export const MAX_LINES = 150;

// ---------------------------------------------------------------------------------------------
// Workers AI

const gateway = (gatewayId: string) => ({ gateway: { id: gatewayId, collectLog: false } });

const SYSTEM = `You read receipts for a US household's budget: a store receipt, an order confirmation
email, or a photo of a paper receipt. It may be a forwarded email with other text around it.
Give the store or merchant, the purchase date as YYYY-MM-DD, and the final total charged, as printed.
List every line that adds to or takes from the total, in order, with its amount exactly as printed:
"item" for something bought, "discount" for money off (a coupon, instant savings), "tax", or "fee"
(delivery, a deposit, a tip). Leave out subtotals, the total, payments and change.
For each item, choose the one Bucket it belongs to, only from the Buckets listed, by its code, or
"none"; give your confidence from 0 to 1, above 0.8 only when the Bucket clearly fits; and list who
it was for by Member code, only when the line names them, else an empty list.
Never add up or change amounts. Answer in JSON only.`;

/** The prompt's list of choices: Buckets and Members by short codes, so answers can't invent IDs. */
export function receiptChoices(buckets: BucketChoice[], members: MemberChoice[]): string {
	const bucketLines = buckets.map((bucket, i) => `b${i + 1}: ${bucket.name}`);
	const memberLines = members.map((member, i) => `p${i + 1}: ${member.name}`);
	return `Buckets:\n${bucketLines.join("\n")}\n\nMembers:\n${memberLines.join("\n") || "(none)"}`;
}

/** The JSON the model must answer with. */
function answerSchema(buckets: BucketChoice[], members: MemberChoice[]) {
	const memberCodes = members.map((_, i) => `p${i + 1}`);
	return {
		type: "object",
		properties: {
			merchant: { type: "string" },
			date: { type: "string" },
			total: { type: "string" },
			lines: {
				type: "array",
				maxItems: MAX_LINES,
				items: {
					type: "object",
					properties: {
						text: { type: "string" },
						amount: { type: "string" },
						kind: { type: "string", enum: ["item", "discount", "tax", "fee"] },
						bucket: { type: "string", enum: [...buckets.map((_, i) => `b${i + 1}`), "none"] },
						confidence: { type: "number", minimum: 0, maximum: 1 },
						for: {
							type: "array",
							items: memberCodes.length > 0 ? { type: "string", enum: memberCodes } : {},
						},
					},
					required: ["text", "amount", "kind", "bucket", "confidence", "for"],
				},
			},
		},
		required: ["merchant", "date", "total", "lines"],
	};
}

const KINDS = new Set<string>(["item", "discount", "tax", "fee"]);

const text = (value: unknown) =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/**
 * The model's answer read back: codes mapped to IDs, anything outside the lists dropped (no
 * Bucket, nobody), a line without text or a known kind left out. Tolerates a fenced or prefixed
 * JSON answer; one that isn't JSON reads as nothing.
 */
export function readReceiptAnswer(
	answer: string,
	buckets: BucketChoice[],
	members: MemberChoice[],
): ReceiptReading {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
	} catch {
		return NOTHING_READ;
	}
	if (!parsed || typeof parsed !== "object") return NOTHING_READ;
	const codeOf = (value: unknown, prefix: string) => {
		const match = typeof value === "string" ? new RegExp(`^${prefix}(\\d+)$`).exec(value) : null;
		return match ? Number(match[1]) - 1 : -1;
	};
	const lines: ReadLine[] = [];
	for (const line of Array.isArray(parsed.lines) ? parsed.lines.slice(0, MAX_LINES) : []) {
		if (!line || typeof line !== "object") continue;
		const { kind, amount, bucket, confidence } = line as Record<string, unknown>;
		const said = text((line as Record<string, unknown>).text);
		if (!said || typeof kind !== "string" || !KINDS.has(kind) || !text(amount)) continue;
		const chosen = buckets[codeOf(bucket, "b")];
		const forCodes = (line as Record<string, unknown>).for;
		lines.push({
			text: said,
			kind: kind as ReceiptLineKind,
			amount: text(amount) as string,
			bucketId: chosen?.id ?? null,
			confidence: chosen && Number.isFinite(Number(confidence)) ? Number(confidence) : 0,
			for: Array.isArray(forCodes)
				? forCodes.flatMap((code) => {
						const member = members[codeOf(code, "p")];
						return member ? [member.id] : [];
					})
				: [],
		});
	}
	return {
		merchant: text(parsed.merchant)?.slice(0, 80) ?? null,
		date: text(parsed.date),
		total: text(parsed.total),
		lines,
	};
}

/**
 * Receipts on Workers AI (AI_MODELS.classify, which reads pictures too), through the AI Gateway
 * `gatewayId`. A PDF is turned into text first (Workers AI's toMarkdown).
 */
export function workersAiReceiptReader(ai: Ai, gatewayId: string): ReceiptReader {
	return {
		async read(input, buckets, members) {
			const choices = receiptChoices(buckets, members);
			let content: string | ChatCompletionContentPart[];
			if (input.kind === "image") {
				// A picture goes to the model as it is, as a data URL.
				const url = `data:${input.mimeType};base64,${base64(input.bytes)}`;
				content = [
					{ type: "text", text: `${choices}\n\nThe receipt is in this picture.` },
					{ type: "image_url", image_url: { url } },
				];
			} else {
				content = `${choices}\n\nReceipt:\n${(await receiptText(ai, gatewayId, input)).slice(0, MAX_TEXT)}`;
			}
			const out = await ai.run(
				AI_MODELS.classify,
				{
					messages: [
						{ role: "system", content: SYSTEM },
						{ role: "user", content },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "receipt", schema: answerSchema(buckets, members) },
					},
					// JSON only, no thinking: the domain does the arithmetic.
					chat_template_kwargs: { enable_thinking: false },
					temperature: 0,
					max_completion_tokens: 6_000,
				},
				gateway(gatewayId),
			);
			const answer = out.choices[0]?.message?.content;
			return readReceiptAnswer(typeof answer === "string" ? answer : "", buckets, members);
		},
	};
}

/** A Receipt's text: as sent, or a PDF turned into text by Workers AI's toMarkdown. */
async function receiptText(
	ai: Ai,
	gatewayId: string,
	input: Exclude<ReceiptInput, { kind: "image" }>,
): Promise<string> {
	if (input.kind === "text") return input.text;
	const converted = await ai.toMarkdown(
		{
			name: input.name,
			blob: new Blob([input.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
		},
		gateway(gatewayId),
	);
	if (converted.format === "error") throw new Error(converted.error);
	return converted.data;
}

/** Bytes as base64, a chunk at a time so a large picture never overflows the call stack. */
export function base64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

// ---------------------------------------------------------------------------------------------
// The fake

/** Items the fake model knows, by the word a Bucket's name must contain to take them. */
const STUB_KNOWS: Record<string, string[]> = {
	grocer: ["milk", "eggs", "banana", "bread", "chicken", "apple", "cheese", "coffee", "cereal"],
	hockey: ["hockey", "puck", "skate", "stick tape"],
	kids: ["toy", "lego", "crayon", "backpack", "kids"],
	home: ["paper towel", "detergent", "soap", "batteries", "light bulb"],
	eat: ["latte", "burrito", "pizza"],
};

/** A line that ends in an amount: "BANANAS 1.49", "COUPON 4.00-", "Tax $0.72". */
const AMOUNT_LINE = /^(.*?)\s+(\(?-?\$?\d[\d,]*\.\d{2}-?\)?)$/;

/** The date a receipt prints, as YYYY-MM-DD: "2026-09-12" or "09/12/2026". */
function stubDate(receipt: string): string | null {
	const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(receipt);
	if (iso) return iso[0];
	const us = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(receipt);
	return us
		? `${us[3]}-${(us[1] as string).padStart(2, "0")}-${(us[2] as string).padStart(2, "0")}`
		: null;
}

/**
 * A deterministic stand-in for the model (AI_MODEL=stub, unit tests), for text only: every line
 * ending in an amount is read, by its words ("TOTAL", "TAX", "COUPON", "DELIVERY FEE"); an item
 * it knows goes, sure, to a Bucket whose name has the right word (milk to "Groceries"), one naming
 * a Bucket goes there, less sure, and one naming a Member is For them. The merchant is the first
 * line with no amount and no colon. A picture or PDF reads as nothing.
 */
export const stubReceiptReader: ReceiptReader = {
	async read(input, buckets, members) {
		if (input.kind !== "text") return NOTHING_READ;
		let merchant: string | null = null;
		let total: string | null = null;
		const lines: ReadLine[] = [];
		for (const raw of input.text.split("\n")) {
			const line = raw.replace(/\s+/g, " ").trim();
			const amountLine = AMOUNT_LINE.exec(line);
			if (!amountLine) {
				if (!merchant && /[a-z]/i.test(line) && !/[:>]|^-/.test(line)) merchant = line;
				continue;
			}
			const [, said = "", amount = ""] = amountLine;
			const lower = said.toLowerCase();
			if (/\bsub ?total\b|\bvisa\b|\bmastercard\b|\bchange\b|\bpaid\b/.test(lower)) continue;
			if (/\btotal\b/.test(lower)) {
				total ??= amount;
				continue;
			}
			const kind: ReceiptLineKind = /\btax\b/.test(lower)
				? "tax"
				: /coupon|discount|savings|promo/.test(lower) || /-\)?$|^\(?-/.test(amount)
					? "discount"
					: /\bfee\b|delivery|deposit|\btip\b/.test(lower)
						? "fee"
						: "item";
			let bucketId: string | null = null;
			let confidence = 0;
			if (kind === "item") {
				for (const [word, known] of Object.entries(STUB_KNOWS)) {
					const bucket = buckets.find((b) => b.name.toLowerCase().includes(word));
					if (bucket && known.some((name) => lower.includes(name))) {
						bucketId = bucket.id;
						confidence = 0.95;
						break;
					}
				}
				const named = bucketId ? null : buckets.find((b) => lower.includes(b.name.toLowerCase()));
				if (named) {
					bucketId = named.id;
					confidence = 0.5;
				}
			}
			lines.push({
				text: said,
				kind,
				amount,
				bucketId,
				confidence,
				for:
					kind === "item"
						? members
								.filter((member) => lower.includes(member.name.toLowerCase()))
								.map((member) => member.id)
						: [],
			});
		}
		return { merchant, date: stubDate(input.text), total, lines: lines.slice(0, MAX_LINES) };
	},
};
