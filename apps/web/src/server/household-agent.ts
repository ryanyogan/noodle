import { DurableObject, env } from "cloudflare:workers";
import { clerkClient } from "@clerk/tanstack-react-start/server";
import {
	clearedSince,
	findMembershipByClerkUser,
	listMembers,
	loadNudgeRecipients,
} from "@noodle/db";
import { type DayKey, dayKeyAt } from "@noodle/domain";
import { type HouseholdChange, householdChangesMessage } from "../household-changes";
import { AI_BUDGET, budgetedInsightModel, ModelBudget, STUB_AI_BUDGET } from "./ai-budget";
import { AiCoalescer, type AiEvent, COALESCE, STUB_COALESCE } from "./ai-coalescer";
import { runAiBatch } from "./ai-run";
import { categorizeDeps, merchantNamer } from "./categorize";
import { getDb } from "./db";
import { clearAgentStorage } from "./fresh-start-clear";
import type { FreshStartProgress } from "./fresh-start-workflow";
import { insightDeps } from "./insights-nightly";
import { lookForHouseholdInsights } from "./insights-run";
import { type HouseholdEvent, HouseholdNudges } from "./nudge-agent";
import type { ScheduledNudge } from "./nudge-content";

/**
 * The Household Agent (ADR-0007): one per Household, named by its ID. Both Parents' open screens
 * hold a hibernating WebSocket to it, and after a write lands in D1 it tells them what changed.
 * It holds no Household data, so it can sleep between writes without dropping anyone. It also
 * decides the Household's Nudges, waking on its alarm to send them, and runs its background AI
 * (ADR-0027): events from writes are held a short while, then filed in one run on the same alarm.
 */
export class HouseholdAgent extends DurableObject<Env> {
	private readonly nudges: HouseholdNudges;
	private readonly ai: AiCoalescer;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.nudges = new HouseholdNudges(ctx.storage);
		this.ai = new AiCoalescer(ctx.storage, __AI_STUB__ ? STUB_COALESCE : COALESCE);
		// Screens ping to keep their connection alive and to notice when it silently drops;
		// the runtime answers without waking the Agent.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	/** A screen connecting. The Worker has already checked its Parent belongs to this Household. */
	override async fetch(): Promise<Response> {
		const { 0: client, 1: server } = new WebSocketPair();
		// Unlike `server.accept()`, lets the Agent hibernate while the connection stays open.
		this.ctx.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * Tells every open screen what changed; each refetches it through the normal read path. Then
	 * notes the write for Nudges, which are decided shortly after on the alarm.
	 */
	async notify(
		householdId: string,
		changes: HouseholdChange[],
		events: HouseholdEvent[] = [],
	): Promise<void> {
		this.broadcast(householdChangesMessage(changes));
		await this.nudges.raise(householdId, changes, events);
	}

	private broadcast(message: string) {
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(message);
			} catch {
				// Already closing: that screen reconnects and catches up on everything.
			}
		}
	}

	/**
	 * A fresh start (#63, ADR-0029): drops everything the Agent holds (Nudges waiting to go out,
	 * background AI held or retrying, the model budget, the alarm) and tells open screens to reload.
	 */
	async clearHousehold(): Promise<void> {
		await clearAgentStorage(this.ctx.storage);
		this.broadcast(JSON.stringify({ reload: true }));
	}

	/** Tells open screens how far the Fresh start Workflow has got. */
	async freshStartProgress(progress: FreshStartProgress): Promise<void> {
		this.broadcast(JSON.stringify({ freshStart: progress }));
	}

	/** Holds Nudges the nightly run decided (a statement's Balance check) until each is due. */
	async holdNudges(householdId: string, nudges: ScheduledNudge[]): Promise<void> {
		await this.nudges.hold(householdId, nudges);
	}

	/** Holds a week's Check-in Nudges until they're due; false when that week's were already taken. */
	async checkIn(householdId: string, week: DayKey, nudges: ScheduledNudge[]): Promise<boolean> {
		return this.nudges.checkIn(householdId, week, nudges);
	}

	/**
	 * A Parent's screen is connecting: if this Agent now runs another build than it last did, the
	 * app was updated, and the Household's other Parents are Nudged so (issue 140).
	 */
	async sawBuild(householdId: string, parentId: string): Promise<void> {
		await this.nudges.appUpdated(householdId, __BUILD_ID__, parentId);
	}

	/** Holds an event for the next background AI run (queueAi). */
	async queueAi(event: AiEvent): Promise<void> {
		await this.ai.queue(event);
	}

	/**
	 * The one alarm, shared: runs background AI when it's due (never throws; it retries itself),
	 * then decides and sends Nudges, retried by the runtime if that throws.
	 */
	override async alarm(): Promise<void> {
		await this.ai.run(async (batch) => {
			const budget = await ModelBudget.open(
				this.ctx.storage,
				__AI_STUB__ ? STUB_AI_BUDGET : AI_BUDGET,
			);
			try {
				return await this.runAi(batch, budget, Date.now());
			} finally {
				await budget.save();
			}
		});
		try {
			await this.nudges.run();
		} finally {
			// Nudges set the alarm for their own next time; bring it forward for the next AI run.
			await this.ai.wake();
		}
	}

	private runAi(
		batch: Parameters<Parameters<AiCoalescer["run"]>[0]>[0],
		budget: ModelBudget,
		startedAt: number,
	) {
		return runAiBatch(
			{
				...categorizeDeps(),
				budget,
				refreshInsights: async (within) => {
					const deps = insightDeps();
					// Cleared while this ran (a fresh start): nothing to look at, nothing to write.
					if (await clearedSince(deps.db, batch.householdId, startedAt)) return 0;
					const household = await loadNudgeRecipients(deps.db, batch.householdId);
					if (!household) return 0;
					return lookForHouseholdInsights(
						{ ...deps, model: budgetedInsightModel(deps.model, within) },
						batch.householdId,
						dayKeyAt(new Date(), household.timeZone),
					);
				},
				namer: merchantNamer(),
				again: () => this.ai.queue({ householdId: batch.householdId, kind: "backfill-merchants" }),
				parents: async (householdId) =>
					(await listMembers(getDb(), householdId))
						.filter((member) => member.kind === "parent" && !member.removed)
						.map((member) => member.id),
				notify: (changes) => this.notify(batch.householdId, changes),
			},
			batch,
		);
	}

	// Screens send nothing but pings, which the auto-response answers.
	override async webSocketMessage(): Promise<void> {}
}

/**
 * Connects a signed-in Parent's screen to their own Household's Agent. The Household comes from
 * the Clerk session, never from the request, so a Parent can only ever join their own.
 */
export async function connectToHouseholdAgent(request: Request): Promise<Response> {
	if (request.headers.get("Upgrade") !== "websocket") {
		return new Response("Expected a WebSocket", { status: 426 });
	}
	// Cookies ride along on WebSocket requests from other sites too, so only this app may connect.
	if (request.headers.get("Origin") !== new URL(request.url).origin) {
		return new Response("Forbidden", { status: 403 });
	}
	const state = await clerkClient().authenticateRequest(request, {
		acceptsToken: "session_token",
	});
	// An expired session is refused too; the screen retries once Clerk has refreshed it.
	const userId = state.isAuthenticated ? state.toAuth().userId : null;
	if (!userId) return new Response("Not signed in", { status: 401 });
	const membership = await findMembershipByClerkUser(getDb(), userId);
	if (!membership) return new Response("No Household for this Parent", { status: 403 });
	const agent = env.HOUSEHOLD_AGENT.getByName(membership.household.id);
	try {
		await agent.sawBuild(membership.household.id, membership.parent.id);
	} catch (error) {
		// Never keeps a screen from connecting.
		console.error("Couldn’t tell the Household Agent which build this is", error);
	}
	return agent.fetch(request);
}
