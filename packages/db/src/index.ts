import { type AnyColumn, and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { type Household, households, type Invite, invites, type Member, members } from "./schema";

export type Db = DrizzleD1Database<typeof schema>;
export type { Household, Invite, Member };

/** A Household has at most two Parents. */
export const MAX_PARENTS = 2;

export function createDb(d1: D1Database): Db {
	return drizzle(d1, { schema });
}

export type ParentMembership = { household: Household; parent: Member };

/** The Household a signed-in Parent belongs to, or null if they have none yet. */
export async function findMembershipByClerkUser(
	db: Db,
	clerkUserId: string,
): Promise<ParentMembership | null> {
	const rows = await db
		.select({ household: households, parent: members })
		.from(members)
		.innerJoin(households, eq(households.id, members.householdId))
		.where(eq(members.clerkUserId, clerkUserId))
		.limit(1);
	return rows[0] ?? null;
}

/** Emails are compared trimmed and lowercased; invites store them this way. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** The Parents of a Household, given its id or a column holding it (for correlated subqueries). */
function parentsOf(householdId: string | AnyColumn) {
	return and(eq(members.householdId, householdId), eq(members.kind, "parent"));
}

/**
 * Runs a batch that adds the signed-in Parent to a Household, then returns their
 * membership. A concurrent request may win the unique clerk_user_id race, rolling
 * the batch back; the winner's membership is returned instead.
 */
async function addParent(
	db: Db,
	clerkUserId: string,
	write: () => Promise<unknown>,
): Promise<ParentMembership | null> {
	try {
		await write();
	} catch (error) {
		const raced = await findMembershipByClerkUser(db, clerkUserId);
		if (raced) return raced;
		throw error;
	}
	return findMembershipByClerkUser(db, clerkUserId);
}

/**
 * Creates a Household with the signed-in user as its first Parent, atomically.
 * Idempotent per Parent: if they already belong to a Household, that one is returned.
 */
export async function createHouseholdForParent(
	db: Db,
	input: {
		clerkUserId: string;
		householdId: string;
		householdName: string;
		timeZone: string;
		parentId: string;
		parentName: string;
	},
): Promise<ParentMembership> {
	const existing = await findMembershipByClerkUser(db, input.clerkUserId);
	if (existing) return existing;
	const created = await addParent(db, input.clerkUserId, () =>
		db.batch([
			db.insert(households).values({
				id: input.householdId,
				name: input.householdName,
				timeZone: input.timeZone,
			}),
			db.insert(members).values({
				id: input.parentId,
				householdId: input.householdId,
				kind: "parent",
				name: input.parentName,
				clerkUserId: input.clerkUserId,
			}),
		]),
	);
	if (!created) throw new Error("Household was not created");
	return created;
}

export async function listParents(db: Db, householdId: string): Promise<Member[]> {
	return db.select().from(members).where(parentsOf(householdId)).orderBy(members.createdAt);
}

export async function findOpenInvite(db: Db, householdId: string): Promise<Invite | null> {
	const rows = await db
		.select()
		.from(invites)
		.where(and(eq(invites.householdId, householdId), isNull(invites.acceptedByMemberId)))
		.limit(1);
	return rows[0] ?? null;
}

const parentCountOf = (householdId: AnyColumn) =>
	sql`(select count(*) from ${members} where ${parentsOf(householdId)})`;

export type InviteParentResult =
	| { ok: true; invite: Invite }
	| { ok: false; reason: "household-full" | "own-email" };

/**
 * Invites the other Parent by email, replacing any earlier open invite from this
 * Household. `inviterEmails` are the inviting Parent's verified emails; they can't
 * invite themselves. The two-Parent limit is checked first and re-guarded inside
 * the batch, so the invite is only written while the Household still has room.
 */
export async function inviteParent(
	db: Db,
	input: {
		inviteId: string;
		householdId: string;
		email: string;
		invitedByMemberId: string;
		inviterEmails: string[];
	},
): Promise<InviteParentResult> {
	const email = normalizeEmail(input.email);
	if (input.inviterEmails.map(normalizeEmail).includes(email)) {
		return { ok: false, reason: "own-email" };
	}
	const parents = await listParents(db, input.householdId);
	if (parents.length >= MAX_PARENTS) return { ok: false, reason: "household-full" };
	await db.batch([
		db
			.delete(invites)
			.where(and(eq(invites.householdId, input.householdId), isNull(invites.acceptedByMemberId))),
		// insert into invites select ... from households where <still has room>
		db.insert(invites).select(
			db
				.select({
					id: sql<string>`${input.inviteId}`.as("id"),
					householdId: households.id,
					email: sql<string>`${email}`.as("email"),
					invitedByMemberId: sql<string>`${input.invitedByMemberId}`.as("invited_by_member_id"),
					acceptedByMemberId: sql<string | null>`null`.as("accepted_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
				})
				.from(households)
				.where(
					and(
						eq(households.id, input.householdId),
						sql`${parentCountOf(households.id)} < ${MAX_PARENTS}`,
					),
				),
		),
	]);
	const invite = await findOpenInvite(db, input.householdId);
	if (!invite) return { ok: false, reason: "household-full" };
	return { ok: true, invite };
}

/** An open invite for the signed-in user to join a Household as its other Parent. */
export type InviteToJoin = { inviteId: string; householdName: string };

/** An open invite addressed to any of the signed-in user's verified emails. */
export async function findInviteForEmails(db: Db, emails: string[]): Promise<InviteToJoin | null> {
	if (emails.length === 0) return null;
	const rows = await db
		.select({ inviteId: invites.id, householdName: households.name })
		.from(invites)
		.innerJoin(households, eq(households.id, invites.householdId))
		.where(
			and(inArray(invites.email, emails.map(normalizeEmail)), isNull(invites.acceptedByMemberId)),
		)
		.orderBy(invites.createdAt)
		.limit(1);
	return rows[0] ?? null;
}

export type AcceptInviteResult =
	| { ok: true; membership: ParentMembership }
	| { ok: false; reason: "invite-unusable" | "in-another-household" };

/**
 * Joins the invite's Household as its second Parent, atomically. The Parent row is
 * inserted only if, at write time, the invite is still open, is addressed to one of
 * `emails`, and the Household has fewer than MAX_PARENTS — so two concurrent accepts
 * can never produce a third Parent. The invite is closed only by the Parent row this
 * accept inserted. Retrying an accept that already succeeded returns the same membership.
 */
export async function acceptInvite(
	db: Db,
	input: {
		inviteId: string;
		emails: string[];
		clerkUserId: string;
		parentId: string;
		parentName: string;
	},
): Promise<AcceptInviteResult> {
	const existing = await findMembershipByClerkUser(db, input.clerkUserId);
	if (existing) {
		const [invite] = await db
			.select({ householdId: invites.householdId })
			.from(invites)
			.where(eq(invites.id, input.inviteId));
		return invite?.householdId === existing.household.id
			? { ok: true, membership: existing }
			: { ok: false, reason: "in-another-household" };
	}
	const emails = input.emails.map(normalizeEmail);
	if (emails.length === 0) return { ok: false, reason: "invite-unusable" };
	const membership = await addParent(db, input.clerkUserId, () =>
		db.batch([
			// insert into members select ... from invites where <still valid>
			db.insert(members).select(
				db
					.select({
						id: sql<string>`${input.parentId}`.as("id"),
						householdId: invites.householdId,
						kind: sql<"parent">`'parent'`.as("kind"),
						name: sql<string>`${input.parentName}`.as("name"),
						clerkUserId: sql<string>`${input.clerkUserId}`.as("clerk_user_id"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						// Selected in the table's column order: insert … select is positional.
						color: sql<number | null>`null`.as("color"),
						removedAt: sql<Date | null>`null`.as("removed_at"),
					})
					.from(invites)
					.where(
						and(
							eq(invites.id, input.inviteId),
							isNull(invites.acceptedByMemberId),
							inArray(invites.email, emails),
							sql`${parentCountOf(invites.householdId)} < ${MAX_PARENTS}`,
						),
					),
			),
			db
				.update(invites)
				.set({ acceptedByMemberId: input.parentId })
				.where(
					and(
						eq(invites.id, input.inviteId),
						isNull(invites.acceptedByMemberId),
						exists(
							db
								.select({ one: sql`1` })
								.from(members)
								.where(
									and(
										eq(members.id, input.parentId),
										eq(members.clerkUserId, input.clerkUserId),
										eq(members.householdId, invites.householdId),
									),
								),
						),
					),
				),
		]),
	);
	return membership ? { ok: true, membership } : { ok: false, reason: "invite-unusable" };
}

export {
	type AddBankConnectionResult,
	addBankConnection,
	BANK_SYNC_STALE_MS,
	type BankAccountChoice,
	type BankConnectionStatus,
	type BankConnectionSummary,
	type BankConnectionToCompare,
	type BankConnectionToImport,
	type BankConnectionToMove,
	type BankConnectionToSync,
	type BankLinkSession,
	type BankProvider,
	type ChooseBankAccountsResult,
	chooseBankAccounts,
	claimBankSync,
	clearBankLinkSession,
	findBankConnectionsByExternal,
	loadBankConnections,
	loadBankConnectionsToCompare,
	loadBankConnectionsToMoveWebhook,
	loadBankConnectionsToSync,
	loadBankConnectionToImport,
	loadBankLinkSession,
	loadPairableAccounts,
	markBankConnectionDisconnected,
	markBankConnectionReconnect,
	markBankConnectionReconnected,
	markBankImportFailed,
	markBankNewAccounts,
	recordBankWebhook,
	refreshBankBalances,
	releaseBankSync,
	saveBankImport,
	saveBankLinkSession,
	saveBankNotice,
	saveBankWebhookUrl,
	unpairAccount,
} from "./bank-connections";
export { type BankSyncResult, syncBankLines } from "./bank-sync";
export {
	addCapture,
	type CaptureResult,
	type CaptureTokenSummary,
	createCaptureToken,
	findCaptureToken,
	loadCaptureToken,
	revokeCaptureToken,
} from "./captures";
export {
	type CategorizableBucket,
	type CategorizationDecision,
	fileCategorizations,
	loadCategorizableBuckets,
	loadCorrection,
	loadUncategorized,
	loadUncategorizedTransaction,
	settleCategorization,
	type Uncategorized,
} from "./categorize";
export {
	type CheckInParent,
	completeCheckIn,
	listCheckInHouseholds,
	loadCheckIns,
	setCheckInDay,
} from "./check-ins";
export {
	addCommitment,
	addCommitmentPayment,
	type CommitmentCharge,
	type CommitmentPaymentResult,
	endCommitment,
	loadCharges,
	loadChargesBetween,
	updateCommitment,
} from "./commitments";
export {
	addIncome,
	decideExtraIncome,
	type IncomeRecord,
	type IncomeWriteResult,
	loadIncome,
	removeIncome,
	undoExtraIncome,
} from "./extra-income";
export {
	type AccountRecord,
	addAccount,
	addGoal,
	addPayoffGoal,
	archiveGoal,
	claimForGoal,
	completeGoal,
	fundGoal,
	type GoalChange,
	type GoalRecord,
	type GoalRecords,
	type GoalWriteResult,
	loadGoalFunding,
	loadGoals,
	owedNow,
	renameAccount,
	restartPayoffGoal,
	setEmergencyGoal,
	spendGoal,
	undoGoalFunding,
	updateAccountBalance,
	updateGoal,
} from "./goals";
export {
	type ImportRecord,
	type ImportResult,
	importStatement,
	loadCsvMapping,
	loadImports,
} from "./imports";
export {
	decideInsight,
	type InsightItem,
	insightFingerprint,
	knownFingerprints,
	loadInsightSpends,
	loadInsights,
	type NewInsight,
	recordInsights,
} from "./insights";
export {
	loadMatch,
	type MatchPeer,
	type MatchResult,
	type MatchView,
	matchImported,
	matchTransactions,
	unmatch,
} from "./matches";
export {
	addChild,
	listMembers,
	type MemberSummary,
	removeChild,
	updateChild,
} from "./members";
export {
	type CloseMonthInput,
	closeMonth,
	listHouseholds,
	loadEmergencyGoalId,
	loadMonthClose,
	loadSweeps,
	type MonthCloseRecord,
	type MonthCloseResult,
	type PlanSweep,
} from "./month-close";
export {
	addCover,
	type CoverResult,
	loadMoves,
	loadMovesBetween,
	type PlanMove,
	undoMove,
} from "./moves";
export {
	forgetPushSubscription,
	loadNudgePreferences,
	loadNudgeRecipients,
	loadPushSubscriptions,
	loadQuickAddForNudge,
	type NudgeRecipient,
	type PushSubscriptionKeys,
	type QuickAddForNudge,
	removePushSubscription,
	saveNudgePreferences,
	savePushSubscription,
} from "./nudges";
export {
	addPerkSource,
	decidePerkSource,
	loadAccountNames,
	loadInsightPerks,
	loadPerkSources,
	loadPerkSourceToResearch,
	type PerkItem,
	type PerkResearch,
	type PerkResearchOutcome,
	type PerkSourceItem,
	type PerkSourceToResearch,
	perkSourcesToRecheck,
	recordPerkSourceSuggestions,
	saveResearch,
	updatePerkSource,
} from "./perks";
export {
	addBucket,
	addBuckets,
	addPersonalAllowance,
	archiveBucket,
	bucketAdd,
	loadPlanRecords,
	reorderBuckets,
	restoreBucket,
	setAllowance,
	setCarriesOver,
	setTakeHomePay,
	updateBucket,
} from "./plan";
export {
	type DraftBucketToAdd,
	type DraftCommitmentToAdd,
	decideDraft,
	finishDraft,
	loadPlanDraft,
	type PlanDraftState,
	saveDraftLabels,
} from "./plan-draft";
export { type Author, loadPlanChanges, type PlanHistory } from "./plan-log";
export { privateTotalId, type Viewer } from "./privacy";
export {
	type AddReceiptResult,
	addReceipt,
	findReceiptAddress,
	loadReceipt,
	loadReceiptAddress,
	loadReceiptCandidates,
	loadUnfiledReceipt,
	type ReceiptView,
	setReceiptAddress,
} from "./receipts";
export {
	loadAmountBands,
	loadBucketMonths,
	loadDailySpend,
	loadForCells,
	loadHistoryStart,
	loadIncomeCells,
	loadMerchants,
	loadReportItems,
	loadSpendCells,
	loadTargetsByMerchant,
	type MerchantTotal,
	privateTotalsFit,
	type ReportFilters,
	type ReportItem,
	type ReportScope,
} from "./reports";
export {
	countFiledOnItsOwn,
	loadReview,
	loadReviewToLookAgain,
	type ReviewItem,
	type ReviewQueue,
	returnToReview,
} from "./review";
export { loadBucketHistory, loadRolledOver } from "./rollover";
export {
	applyRule,
	deleteRule,
	editRule,
	listRules,
	loadRules,
	type RuleEditResult,
	type RuleRow,
	type StoredRule,
	saveRule,
} from "./rules";
export {
	applyChanges,
	deleteScenario,
	loadScenarios,
	ScenarioChangeNotApplicable,
	type ScenarioRecord,
	saveScenario,
} from "./scenarios";
export {
	hasTakeHomePay,
	loadSetupHistory,
	loadSetupJobs,
	loadSetupProgress,
	resetSetupJobs,
	restartSetupProgress,
	type SetupJob,
	type SetupJobStatus,
	type SetupProgress,
	saveSetupJob,
	saveSetupProgress,
} from "./setup";
export {
	type Assignment,
	addQuickAdd,
	type BucketSpend,
	deleteTransaction,
	loadBucketUses,
	loadSpending,
	loadSpendingBetween,
	loadSpendingEarlierInYear,
	loadTransaction,
	loadTransactionsPage,
	loadUnassignedBetween,
	type QuickAddResult,
	type SplitInput,
	type SplitRow,
	splitTransaction,
	type TransactionCursor,
	type TransactionEditResult,
	type TransactionRow,
	type TransactionSort,
	updateTransaction,
} from "./transactions";
export {
	detectTransfers,
	linkRefund,
	loadRefund,
	loadTransfer,
	type MoneyPeer,
	type MoneyResult,
	markTransfer,
	type RefundView,
	type TransferView,
	unlinkRefund,
	unmarkTransfer,
} from "./transfers";
