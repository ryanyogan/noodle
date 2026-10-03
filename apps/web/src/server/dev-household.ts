import { env } from "cloudflare:workers";
import { createClerkClient } from "@clerk/backend";
import {
	addBuckets,
	addChild,
	addCommitment,
	addPersonalAllowance,
	createHouseholdForParent,
	saveRule,
	saveSetupProgress,
	setTakeHomePay,
} from "@noodle/db";
import { members } from "@noodle/db/schema";
import { CADENCES, type DayKey, MAX_CENTS, monthKeyAt } from "@noodle/domain";
import { ulid } from "ulid";
import { z } from "zod";
import { getDb } from "./db";

// A Household made in one request, for E2E: signing up and clicking through /welcome, "Set up
// later" and the Plan's Add Buckets sheet took 20-40s a test before it checked anything. Only
// with AI_MODEL=stub (server.ts), so not in production builds. It writes through the same
// @noodle/db functions the welcome screen and the Plan call, so the rows are the ones the UI makes.

export const DEV_HOUSEHOLD_PATH = "/api/dev/household";

const nameSchema = z.string().trim().min(1).max(80);
const centsSchema = z.number().int().min(0).max(MAX_CENTS);

const devHouseholdSchema = z.object({
	householdName: nameSchema,
	parentName: nameSchema,
	timeZone: z.string().default("America/Los_Angeles"),
	/** This month's Plan: take-home pay, Buckets (in order) and Commitments. */
	plan: z
		.object({
			takeHomePayCents: centsSchema,
			buckets: z
				.array(z.object({ name: z.string().trim().min(1).max(40), allowanceCents: centsSchema }))
				.max(40)
				.default([]),
			commitments: z
				.array(
					z.object({
						name: z.string().trim().min(1).max(40),
						amountCents: centsSchema,
						cadence: z.enum(CADENCES),
						/** Day of this month it's due. */
						dueDay: z.number().int().min(1).max(28),
					}),
				)
				.max(40)
				.default([]),
		})
		.optional(),
	children: z.array(nameSchema).max(8).default([]),
	/** The get-started wizard marked finished, so This Month shows no "Continue setup". */
	finishSetup: z.boolean().default(false),
	/** The signed-in Parent's Personal Allowance this month, named "<name>’s Personal Allowance". */
	personalAllowanceCents: centsSchema.optional(),
	/** A second Parent who never signs in (no Clerk user), with their own Personal Allowance. */
	otherParent: z
		.object({ name: nameSchema, personalAllowanceCents: centsSchema.optional() })
		.optional(),
	/** Household Rules, each filing a merchant into one of the Plan's Buckets, named. */
	rules: z
		.array(z.object({ pattern: z.string().trim().min(1).max(80), bucket: z.string() }))
		.max(20)
		.default([]),
});

/** The signed-in Clerk user, from the request's session cookie (never from its body). */
async function signedInUser(request: Request): Promise<string | null> {
	const clerk = createClerkClient({
		secretKey: env.CLERK_SECRET_KEY,
		publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY,
	});
	const state = await clerk.authenticateRequest(request);
	return state.isAuthenticated ? state.toAuth().userId : null;
}

/**
 * POST {householdName, parentName, timeZone, plan?, children?, finishSetup?, personalAllowanceCents?,
 * otherParent?, rules?} as a signed-in user.
 */
export async function handleDevHousehold(request: Request): Promise<Response> {
	if (request.method !== "POST") return new Response("POST only", { status: 405 });
	const clerkUserId = await signedInUser(request);
	if (!clerkUserId) return new Response("Not signed in", { status: 401 });
	const parsed = devHouseholdSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json(parsed.error.issues, { status: 400 });
	const {
		householdName,
		parentName,
		timeZone,
		plan,
		children,
		finishSetup,
		personalAllowanceCents,
		otherParent,
		rules,
	} = parsed.data;

	const db = getDb();
	const { household, parent } = await createHouseholdForParent(db, {
		clerkUserId,
		householdId: ulid(),
		parentId: ulid(),
		householdName,
		parentName,
		timeZone,
	});
	const householdId = household.id;
	const month = monthKeyAt(new Date(), household.timeZone);
	const author = { householdId, memberId: parent.id };

	const bucketIds: Record<string, string> = {};
	const commitmentIds: Record<string, string> = {};
	if (plan) {
		await setTakeHomePay(db, { ...author, month, amountCents: plan.takeHomePayCents });
		const buckets = plan.buckets.map(({ name, allowanceCents }, index) => {
			bucketIds[name] = ulid();
			return { bucketId: bucketIds[name], name, allowanceCents, color: (index % 8) + 1 };
		});
		if (buckets.length > 0) await addBuckets(db, { ...author, month, buckets });
		for (const { name, amountCents, cadence, dueDay } of plan.commitments) {
			commitmentIds[name] = ulid();
			await addCommitment(db, {
				...author,
				commitmentId: commitmentIds[name],
				month,
				name,
				amountCents,
				cadence,
				dueDate: `${month}-${String(dueDay).padStart(2, "0")}` as DayKey,
			});
		}
	}
	const childIds: Record<string, string> = {};
	for (const [index, name] of children.entries()) {
		childIds[name] = ulid();
		await addChild(db, { householdId, memberId: childIds[name], name, color: (index % 8) + 1 });
	}
	const allowances: [memberId: string, name: string, cents: number | undefined][] = [
		[parent.id, parentName, personalAllowanceCents],
	];
	if (otherParent) {
		const otherId = ulid();
		await db
			.insert(members)
			.values({ id: otherId, householdId, kind: "parent", name: otherParent.name });
		allowances.push([otherId, otherParent.name, otherParent.personalAllowanceCents]);
	}
	for (const [index, [memberId, name, allowanceCents]] of allowances.entries()) {
		if (allowanceCents === undefined || !plan) continue;
		const bucketName = `${name}’s Personal Allowance`;
		bucketIds[bucketName] = ulid();
		await addPersonalAllowance(db, {
			householdId,
			memberId,
			bucketId: bucketIds[bucketName],
			name: bucketName,
			color: index + 1,
			month,
			allowanceCents,
		});
	}
	for (const { pattern, bucket } of rules) {
		const bucketId = bucketIds[bucket];
		if (!bucketId) return new Response(`No Bucket named ${bucket}`, { status: 400 });
		await saveRule(db, { id: ulid(), householdId, memberId: parent.id, pattern, bucketId });
	}
	if (finishSetup) {
		await saveSetupProgress(db, householdId, { step: 1, answers: {}, skipped: [], finished: true });
	}
	return Response.json({
		householdId,
		parentId: parent.id,
		month,
		bucketIds,
		commitmentIds,
		childIds,
		url: `/month/${month}`,
	});
}
