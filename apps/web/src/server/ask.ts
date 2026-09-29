import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { stubModel, workersAiModel } from "./ask-model";
import { runAsk } from "./ask-run";
import { getDb } from "./db";
import { householdMiddleware } from "./household";

// Ask (ADR-0012): a streaming server function, stateless. The Parent's page keeps this visit's
// questions and sends the last few back, so a follow-up ("and last year?") has its context.

export const askHousehold = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			question: z.string().trim().min(1).max(500),
			history: z
				.array(z.object({ question: z.string().max(500), answer: z.string().max(2000) }))
				.max(3),
		}),
	)
	.handler(async function* ({ data, context }) {
		yield* runAsk({
			ctx: {
				db: getDb(),
				household: context.household,
				parentId: context.parent.id,
				now: new Date(),
			},
			model: __ASK_STUB__ ? stubModel : workersAiModel(env.AI, env.AI_GATEWAY_ID),
			question: data.question,
			history: data.history,
		});
	});
