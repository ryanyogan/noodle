import {
	type AnyColumn,
	and,
	eq,
	exists,
	gt,
	inArray,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import { checkSend, type InviteLinkState, inviteLinkState } from "./invite-token";
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

/** Changes the Household's name and time zone, which decides which month "today" is in. */
export async function setHouseholdDetails(
	db: Db,
	householdId: string,
	details: { name: string; timeZone: string },
): Promise<void> {
	await db.update(households).set(details).where(eq(households.id, householdId));
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

/** Not yet past its expiry (invites from before links have none). */
const notExpired = (now: Date) => or(isNull(invites.expiresAt), gt(invites.expiresAt, now));

export type InviteParentResult =
	| { ok: true; invite: Invite }
	| { ok: false; reason: "daily-limit" }
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
		/** The link's token, hashed (invite-token.ts), and when it stops working. */
		tokenHash: string;
		expiresAt: Date;
		/** When given, the email goes out now and the Household's daily limit applies (checkSend). */
		now?: Date;
	},
): Promise<InviteParentResult> {
	const email = normalizeEmail(input.email);
	if (input.inviterEmails.map(normalizeEmail).includes(email)) {
		return { ok: false, reason: "own-email" };
	}
	const parents = await listParents(db, input.householdId);
	if (parents.length >= MAX_PARENTS) return { ok: false, reason: "household-full" };
	let sendsThatDay = 1;
	if (input.now) {
		const earlier = await findOpenInvite(db, input.householdId);
		const check = checkSend(earlier && lastSend(earlier), input.now, { wait: false });
		if (!check.ok) return { ok: false, reason: "daily-limit" };
		sendsThatDay = check.sendsThatDay;
	}
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
					// Selected in the table's column order: insert … select is positional.
					tokenHash: sql<string>`${input.tokenHash}`.as("token_hash"),
					expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as("expires_at"),
					sentAt: sql<Date | null>`${input.now ? input.now.getTime() : null}`.as("sent_at"),
					sendsThatDay: sql<number>`${sendsThatDay}`.as("sends_that_day"),
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

/** When an invite's email last went out, and how many went out that day. */
export const lastSend = (invite: Invite) => ({
	sentAt: invite.sentAt ?? invite.createdAt,
	sendsThatDay: invite.sendsThatDay,
});

export type ResendInviteResult =
	| { ok: true; invite: Invite }
	| { ok: false; reason: "no-invite" | "too-soon" | "daily-limit" };

/**
 * Resends the Household's open invite (expired or not) with a new link: the new token's hash
 * replaces the old one, so the old link stops working, and the 7 days start again. At most once a
 * minute and INVITE_SENDS_PER_DAY a day (checkSend).
 */
export async function resendInvite(
	db: Db,
	input: { householdId: string; tokenHash: string; expiresAt: Date; now: Date },
): Promise<ResendInviteResult> {
	const invite = await findOpenInvite(db, input.householdId);
	if (!invite) return { ok: false, reason: "no-invite" };
	const check = checkSend(lastSend(invite), input.now, { wait: true });
	if (!check.ok) return check;
	await db
		.update(invites)
		.set({
			tokenHash: input.tokenHash,
			expiresAt: input.expiresAt,
			sentAt: input.now,
			sendsThatDay: check.sendsThatDay,
		})
		.where(and(eq(invites.id, invite.id), isNull(invites.acceptedByMemberId)));
	const resent = await findOpenInvite(db, input.householdId);
	if (resent?.id !== invite.id) return { ok: false, reason: "no-invite" };
	return { ok: true, invite: resent };
}

/** Cancels the Household's open invite: its link then finds nothing. */
export async function cancelInvite(db: Db, householdId: string): Promise<void> {
	await db
		.delete(invites)
		.where(and(eq(invites.householdId, householdId), isNull(invites.acceptedByMemberId)));
}

/** An open invite for the signed-in user to join a Household as its other Parent. */
export type InviteToJoin = { inviteId: string; householdName: string };

/** An open, unexpired invite addressed to any of the signed-in user's verified emails. */
export async function findInviteForEmails(
	db: Db,
	emails: string[],
	now: Date,
): Promise<InviteToJoin | null> {
	if (emails.length === 0) return null;
	const rows = await db
		.select({ inviteId: invites.id, householdName: households.name })
		.from(invites)
		.innerJoin(households, eq(households.id, invites.householdId))
		.where(
			and(
				inArray(invites.email, emails.map(normalizeEmail)),
				isNull(invites.acceptedByMemberId),
				notExpired(now),
			),
		)
		.orderBy(invites.createdAt)
		.limit(1);
	return rows[0] ?? null;
}

/** What an invite link finds: its state and, while it can be found, who it's for and where. */
export type InviteByLink =
	| {
			state: Exclude<InviteLinkState, "not-found">;
			email: string;
			householdId: string;
			householdName: string;
			hasRoom: boolean;
	  }
	| { state: "not-found" };

/**
 * The invite whose link token hashes to `tokenHash`. The row is found by its hash, and the hash
 * is compared again in constant time before anything about it is trusted. A replaced invite is
 * gone, so its link finds nothing.
 */
export async function findInviteByTokenHash(
	db: Db,
	tokenHash: string,
	now: Date,
): Promise<InviteByLink> {
	const [row] = await db
		.select({
			tokenHash: invites.tokenHash,
			expiresAt: invites.expiresAt,
			acceptedByMemberId: invites.acceptedByMemberId,
			email: invites.email,
			householdId: invites.householdId,
			householdName: households.name,
			parents: sql<number>`${parentCountOf(invites.householdId)}`,
		})
		.from(invites)
		.innerJoin(households, eq(households.id, invites.householdId))
		.where(eq(invites.tokenHash, tokenHash))
		.limit(1);
	const state = inviteLinkState(row ?? null, tokenHash, now);
	if (!row || state === "not-found") return { state: "not-found" };
	return {
		state,
		email: row.email,
		householdId: row.householdId,
		householdName: row.householdName,
		hasRoom: Number(row.parents) < MAX_PARENTS,
	};
}

export type AcceptInviteResult =
	| { ok: true; membership: ParentMembership }
	| { ok: false; reason: "invite-unusable" | "in-another-household" };

/**
 * Which invite is being accepted: the one with this ID addressed to one of the signed-in user's
 * verified `emails` (/welcome), or the one whose link token hashes to `tokenHash` (whoever holds
 * the link, whatever their email: the page asks them to confirm first).
 */
export type InviteKey = { inviteId: string; emails: string[] } | { tokenHash: string };

/**
 * Joins the invite's Household as its second Parent, atomically. The Parent row is
 * inserted only if, at write time, the invite is still open and unexpired, matches
 * `invite`, and the Household has fewer than MAX_PARENTS — so two concurrent accepts
 * can never produce a third Parent. The invite is closed only by the Parent row this
 * accept inserted. Retrying an accept that already succeeded returns the same membership.
 */
export async function acceptInvite(
	db: Db,
	input: {
		invite: InviteKey;
		clerkUserId: string;
		parentId: string;
		parentName: string;
		now: Date;
	},
): Promise<AcceptInviteResult> {
	const key = input.invite;
	const theInvite: SQL | undefined =
		"tokenHash" in key ? eq(invites.tokenHash, key.tokenHash) : eq(invites.id, key.inviteId);
	const existing = await findMembershipByClerkUser(db, input.clerkUserId);
	if (existing) {
		const [invite] = await db
			.select({ householdId: invites.householdId })
			.from(invites)
			.where(theInvite);
		return invite?.householdId === existing.household.id
			? { ok: true, membership: existing }
			: { ok: false, reason: "in-another-household" };
	}
	const emails = "emails" in key ? key.emails.map(normalizeEmail) : null;
	if (emails?.length === 0) return { ok: false, reason: "invite-unusable" };
	const usable = and(
		theInvite,
		isNull(invites.acceptedByMemberId),
		notExpired(input.now),
		emails ? inArray(invites.email, emails) : undefined,
	);
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
					.where(and(usable, sql`${parentCountOf(invites.householdId)} < ${MAX_PARENTS}`)),
			),
			db
				.update(invites)
				.set({ acceptedByMemberId: input.parentId })
				.where(
					and(
						theInvite,
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

export * from "./account-archive";
export {
	type BalanceCheckDue,
	isCardKeptByHand,
	listBalanceCheckHouseholds,
	loadBalanceChecksDue,
	loadBalanceChecksPutAway,
	markBalanceChecksNudged,
	putAwayBalanceCheck,
} from "./balance-checks";
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
	REMOVED_CREDENTIAL,
	recordBankWebhook,
	refreshBankBalances,
	releaseBankSync,
	removeBankConnection,
	saveBankImport,
	saveBankLinkSession,
	saveBankNotice,
	saveBankWebhookUrl,
	unpairAccount,
} from "./bank-connections";
export { type BankSyncResult, syncBankLines } from "./bank-sync";
export {
	type BetweenUsIncome,
	type IncomeTransferResult,
	loadBetweenUsIncome,
	markIncomeTransfer,
} from "./between-us";
export {
	BUCKET_DELETE_BLOCKERS,
	type BucketDeleteBlocker,
	bucketDeleteBlockers,
	deleteBucket,
} from "./bucket-delete";
export {
	addCapture,
	answerWalletCard,
	type CaptureResult,
	type CaptureTokenSummary,
	createCaptureToken,
	dismissWalletCard,
	findCaptureToken,
	loadCaptureToken,
	loadWalletQuestions,
	revokeCaptureToken,
	type WalletQuestion,
} from "./captures";
export {
	CARD_PAYMENT_PASS,
	type CardPaymentPassResult,
	householdsAwaitingCardPaymentPass,
	runCardPaymentPass,
	runCardPaymentPasses,
} from "./card-payment-pass";
export {
	type CardPaymentFiling,
	fileCardPayment,
	forgetCardPayment,
	loadCardPaymentRules,
	loadCreditCards,
	markCardPayment,
	markCardPayments,
	markRememberedCardPayments,
	undoCardPaymentFiling,
	undoCardPaymentMarks,
	undoCardPaymentRemembered,
} from "./card-payments";
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
	type CommitmentLinkInput,
	type CommitmentLinkResult,
	type CommitmentPaymentResult,
	commitmentLink,
	endCommitment,
	FOLLOWED_WITHIN_DAYS,
	followedCards,
	linkCommitment,
	loadCharges,
	loadChargesBetween,
	loadPaymentHistory,
	type PaymentHistory,
	updateCommitment,
} from "./commitments";
export {
	type ExportAccount,
	type ExportData,
	type ExportFile,
	loadExportData,
	monthsBetween,
} from "./export";
export {
	addIncome,
	decideExtraIncome,
	type IncomeRecord,
	type IncomeWriteResult,
	loadExtraToFree,
	loadIncome,
	removeIncome,
	undoExtraIncome,
} from "./extra-income";
export { addFeesBucket, type FeesBucketAdded } from "./fees-bucket";
export {
	loadFreeCarriedIn,
	loadFreeCarriedInto,
	loadFreeCarryMonths,
} from "./free-carry";
export * from "./fresh-start";
export {
	type AccountRecord,
	addAccount,
	addGoal,
	addPayoffGoal,
	archiveGoal,
	balanceCheckDue,
	checkStatementBalance,
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
	owedSql,
	renameAccount,
	restartPayoffGoal,
	setCardKept,
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
	refreshInsightEvidence,
} from "./insights";
export {
	checkSend,
	constantTimeEqual,
	hashInviteToken,
	INVITE_LINK_DAYS,
	INVITE_SENDS_PER_DAY,
	type InviteLinkState,
	inviteExpiresAt,
	isInviteTokenShape,
	newInviteToken,
	RESEND_WAIT_MS,
	type SendCheck,
} from "./invite-token";
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
	updateParent,
} from "./members";
export {
	countSameMerchant,
	hasUnnamedMerchants,
	loadMerchantNames,
	loadParentNames,
	loadUnnamedNotes,
	nameSameMerchant,
	nameTransactions,
	PARENT_NAME,
	saveMerchantNames,
	saveParentName,
} from "./merchants";
export {
	type AccountPairResult,
	changeMoneyInKind,
	deleteMoneyInRule,
	editMoneyIn,
	loadMoneyIn,
	loadMoneyInAccounts,
	loadMoneyInLine,
	loadMoneyInReview,
	loadMoneyInRules,
	type MoneyInEdit,
	type MoneyInFilter,
	type MoneyInKindResult,
	type MoneyInLine,
	rememberAccountPair,
	type StoredMoneyInRule,
	saveMoneyInRule,
	stateWhosePay,
} from "./money-in";
export {
	householdsAwaitingMoneyInPass,
	MONEY_IN_PASS,
	type MoneyInPassResult,
	runMoneyInPass,
} from "./money-in-pass";
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
	confirmPaidBack,
	loadOwedBack,
	loadPaidBack,
	loadUnmatchedPaidBack,
	type OwedBackFilter,
	type OwedBackItem,
	type OwedBackRemoveResult,
	type OwedBackResult,
	offerPaidBackFor,
	type PaidBackConfirmResult,
	type PaidBackLine,
	type PaidBackOffered,
	removeOwedBack,
	type StoredPaidBackMatch,
	sayOwedBack,
	type UnmatchedPaidBack,
} from "./owed-back";
export {
	applyOwedBackRules,
	forgetOwedBack,
	type OwedBackRemembered,
	type OwedBackRule,
	owedBackPercent,
	owedBackRuleFor,
	rememberOwedBack,
} from "./owed-back-rules";
export {
	addPerkSource,
	addPerkUse,
	decidePerkSource,
	ensureCardPerkSources,
	loadAccountNames,
	loadInsightPerks,
	loadPerkPage,
	loadPerkSources,
	loadPerkSourceToResearch,
	nameCardProduct,
	type PerkCard,
	type PerkItem,
	type PerkResearch,
	type PerkResearchOutcome,
	type PerkSourceItem,
	type PerkSourceToResearch,
	perkSourceAlreadyThere,
	perkSourcesToRecheck,
	recordPerkSourceSuggestions,
	removePerkUse,
	savePerkPage,
	saveResearch,
	setPerkSourceFee,
	setPerkValue,
	updatePerkSource,
} from "./perks";
export {
	addBucket,
	addBuckets,
	addPersonalAllowance,
	archiveBucket,
	bucketAdd,
	bucketsWithAllowanceChanges,
	loadPlanRecords,
	parentsWithPersonalAllowance,
	renameBucketGroup,
	reorderBuckets,
	restoreBucket,
	setAllowance,
	setAllowances,
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
export { loadBucketsInMonths } from "./range-buckets";
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
	linkMoneyInRefund,
	loadMoneyInRefund,
	type MoneyInRefund,
	type RefundLinkResult,
	type RefundPurchase,
	unlinkMoneyInRefund,
} from "./refund-links";
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
	resolveMerchant,
} from "./reports";
export {
	countFiledOnItsOwn,
	fileWithoutBucket,
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
	noteRuleStated,
	type RuleEditResult,
	type RuleRow,
	type RuleStated,
	type StoredRule,
	saveRule,
	stateRule,
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
export * from "./snapshot-carry";
export * from "./snapshots";
export {
	acceptSuggestionAdding,
	decideSuggestion,
	householdTimeZone,
	loadLearnInputs,
	loadOpenSuggestion,
	loadOpenSuggestions,
	loadSuggestionInputs,
	type SuggestionInputs,
	type SuggestionItem,
	type SuggestionTerms,
	saveSuggestions,
} from "./suggestions";
export {
	type Assignment,
	addQuickAdd,
	type BucketSpend,
	type DeletionSummary,
	deleteTransaction,
	deleteTransactions,
	type FiledBefore,
	type FilingResult,
	type FilingSkips,
	fileTransactions,
	loadBucketUses,
	loadSpending,
	loadSpendingBetween,
	loadSpendingEarlierInYear,
	loadTransaction,
	loadTransactionsPage,
	loadUnassignedBetween,
	type QuickAddResult,
	renameTransaction,
	type SplitInput,
	type SplitRow,
	splitTransaction,
	summarizeDeletion,
	type TransactionCursor,
	type TransactionEditResult,
	type TransactionRenameResult,
	type TransactionRow,
	type TransactionSelection,
	type TransactionSort,
	type TransactionWriteResult,
	transactionVersion,
	unfileTransactions,
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
	type TransferReason,
	type TransferView,
	unlinkRefund,
	unmarkTransfer,
} from "./transfers";
