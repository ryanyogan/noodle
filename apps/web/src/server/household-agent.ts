import { DurableObject, env } from "cloudflare:workers";
import { clerkClient } from "@clerk/tanstack-react-start/server";
import { findMembershipByClerkUser } from "@noodle/db";
import { type HouseholdChange, householdChangesMessage } from "../household-changes";
import { getDb } from "./db";
import { type HouseholdEvent, HouseholdNudges } from "./nudge-agent";

/**
 * The Household Agent (ADR-0007): one per Household, named by its ID. Both Parents' open screens
 * hold a hibernating WebSocket to it, and after a write lands in D1 it tells them what changed.
 * It holds no Household data, so it can sleep between writes without dropping anyone. It also
 * decides the Household's Nudges, waking on its alarm to send them.
 */
export class HouseholdAgent extends DurableObject<Env> {
	private readonly nudges: HouseholdNudges;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.nudges = new HouseholdNudges(ctx.storage);
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
		const message = householdChangesMessage(changes);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(message);
			} catch {
				// Already closing: that screen reconnects and catches up on everything.
			}
		}
		await this.nudges.raise(householdId, changes, events);
	}

	/** Decides and sends Nudges; retried by the runtime if it throws. */
	override async alarm(): Promise<void> {
		await this.nudges.run();
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
	return env.HOUSEHOLD_AGENT.getByName(membership.household.id).fetch(request);
}
