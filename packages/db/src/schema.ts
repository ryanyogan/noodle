import type { Lever } from "@noodle/domain";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

// IDs are client-generated ULIDs (they double as idempotency keys).
// Every Household-owned table carries household_id.

export const households = sqliteTable("households", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	// IANA zone; decides which month "today" is for this Household. Always set by
	// the app; the default only exists so SQLite can add the column.
	timeZone: text("time_zone").notNull().default("UTC"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

export const members = sqliteTable(
	"members",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		kind: text("kind", { enum: ["parent", "child"] }).notNull(),
		name: text("name").notNull(),
		// Set only for Parents. Unique so a Parent belongs to exactly one Household.
		clerkUserId: text("clerk_user_id").unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		// Set only for Children: 1–8, their identity colour (--bucket-N).
		color: integer("color"),
		// A removed Child leaves the Household's pickers, but Transactions For them keep it.
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
	},
	(t) => [index("members_household_idx").on(t.householdId)],
);

// A Parent's invitation for the other Parent to join the Household. It is accepted by
// whoever signs in with a verified email matching `email`.
export const invites = sqliteTable(
	"invites",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		// Stored lowercased.
		email: text("email").notNull(),
		invitedByMemberId: text("invited_by_member_id")
			.notNull()
			.references(() => members.id),
		acceptedByMemberId: text("accepted_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		// A Household has at most one open invite (there is only ever one other Parent to invite).
		uniqueIndex("invites_one_open_per_household")
			.on(t.householdId)
			.where(sql`${t.acceptedByMemberId} is null`),
		index("invites_email_idx").on(t.email),
	],
);

// The Plan is stored effective-dated (see planForMonth in @noodle/domain): a Baseline or
// allowance set for a month holds for later months until set again. Months are "YYYY-MM".
// Money is integer cents.

export const baselines = sqliteTable(
	"baselines",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		month: text("month").notNull(),
		amountCents: integer("amount_cents").notNull(),
	},
	(t) => [primaryKey({ columns: [t.householdId, t.month] })],
);

export const buckets = sqliteTable(
	"buckets",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		name: text("name").notNull(),
		// 1–8: the Bucket's identity colour (--bucket-N).
		color: integer("color").notNull(),
		position: integer("position").notNull(),
		// The first month the Bucket is in the Plan, and (once archived) the first it isn't.
		fromMonth: text("from_month").notNull(),
		archivedFromMonth: text("archived_from_month"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		// Set for a Personal Allowance: the Parent it belongs to. Its Transactions are private to
		// them; the other Parent only ever reads its totals (ADR-0003, see privacy.ts).
		ownerMemberId: text("owner_member_id").references(() => members.id),
	},
	(t) => [
		index("buckets_household_idx").on(t.householdId),
		// Each Parent has one Personal Allowance.
		uniqueIndex("buckets_one_personal_allowance")
			.on(t.ownerMemberId)
			.where(sql`${t.ownerMemberId} is not null`),
	],
);

export const bucketAllowances = sqliteTable(
	"bucket_allowances",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		bucketId: text("bucket_id")
			.notNull()
			.references(() => buckets.id),
		month: text("month").notNull(),
		amountCents: integer("amount_cents").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.bucketId, t.month] }),
		index("bucket_allowances_household_idx").on(t.householdId),
	],
);

// Whether a Bucket is Rolling (1) or Fresh-start (0) from `month` onward, effective-dated like an
// allowance. A Bucket with no row is Fresh-start.
export const bucketRolling = sqliteTable(
	"bucket_rolling",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		bucketId: text("bucket_id")
			.notNull()
			.references(() => buckets.id),
		month: text("month").notNull(),
		rolling: integer("rolling", { mode: "boolean" }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.bucketId, t.month] }),
		index("bucket_rolling_household_idx").on(t.householdId),
	],
);

// A recurring obligation in the Plan from `from_month` until (once ended) `ended_from_month`.
// What it expects is effective-dated like an allowance: terms set for a month hold for later
// months until set again, so changing it never rewrites an earlier month.
export const commitments = sqliteTable(
	"commitments",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		name: text("name").notNull(),
		fromMonth: text("from_month").notNull(),
		endedFromMonth: text("ended_from_month"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("commitments_household_idx").on(t.householdId)],
);

// `amount_cents` each time it's due; `cadence` and `due_date` (any one day it's due,
// "YYYY-MM-DD") set when that is (see dueDatesIn in @noodle/domain).
export const commitmentTerms = sqliteTable(
	"commitment_terms",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		commitmentId: text("commitment_id")
			.notNull()
			.references(() => commitments.id),
		month: text("month").notNull(),
		amountCents: integer("amount_cents").notNull(),
		cadence: text("cadence", { enum: ["monthly", "biweekly", "annual"] }).notNull(),
		dueDate: text("due_date").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.commitmentId, t.month] }),
		index("commitment_terms_household_idx").on(t.householdId),
	],
);

// A real-world place money lives or is owed, entered by hand. For credit cards and loans the
// balance is what's owed. `kind` is ACCOUNT_KINDS in @noodle/domain.
export const accounts = sqliteTable(
	"accounts",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		name: text("name").notNull(),
		kind: text("kind", { enum: ["checking", "savings", "credit-card", "loan"] }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("accounts_household_idx").on(t.householdId)],
);

// A balance a Parent entered for an Account. Appended, never updated: the latest one is the
// balance, less Goal spending recorded after it (see accountBalance in @noodle/domain).
export const accountBalances = sqliteTable(
	"account_balances",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id),
		amountCents: integer("amount_cents").notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("account_balances_account_idx").on(t.accountId)],
);

// A target the Household funds over time, held as an Earmark on one checking or savings Account
// (ADR-0002). `target_date` is optional ("YYYY-MM-DD"); `from_month` is the month it was added.
// A completed Goal keeps its Earmark; an archived one claims nothing.
export const goals = sqliteTable(
	"goals",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id),
		name: text("name").notNull(),
		targetCents: integer("target_cents").notNull(),
		targetDate: text("target_date"),
		fromMonth: text("from_month").notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("goals_household_idx").on(t.householdId)],
);

// Unclaimed Account money set aside for a Goal, or released back to Unclaimed (negative). Not a
// Move: the Plan is untouched. A Goal's Earmark is these, plus its Goal funding Moves, less the
// Transactions assigned to it.
export const earmarkClaims = sqliteTable(
	"earmark_claims",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		goalId: text("goal_id")
			.notNull()
			.references(() => goals.id),
		month: text("month").notNull(),
		amountCents: integer("amount_cents").notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("earmark_claims_goal_idx").on(t.goalId)],
);

// Real money in or out. `date` is the day it happened in the Household's time zone ("YYYY-MM-DD");
// `amount_cents` is money spent, so spending is positive. A Quick Add has no Account until it is
// Matched to an imported Transaction.
export const transactions = sqliteTable(
	"transactions",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		source: text("source", { enum: ["quick-add"] }).notNull(),
		date: text("date").notNull(),
		amountCents: integer("amount_cents").notNull(),
		// The Bucket it is assigned to as a whole; null while unassigned.
		bucketId: text("bucket_id").references(() => buckets.id),
		note: text("note"),
		// The Parent who entered it; null for imported Transactions.
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		// The Commitment it pays, as a whole, when it isn't assigned to a Bucket.
		commitmentId: text("commitment_id").references(() => commitments.id),
		// The Account it left; for Goal spending, the Goal's Account.
		accountId: text("account_id").references(() => accounts.id),
		// The Goal it's spent from, out of its Earmark (never a Bucket or Free to Spend).
		goalId: text("goal_id").references(() => goals.id),
	},
	(t) => [index("transactions_household_date_idx").on(t.householdId, t.date)],
);

// Who a Transaction was For: one row per Member it was spent on. No rows means the whole
// Household, so shared spending is never counted again under each Member.
export const transactionFor = sqliteTable(
	"transaction_for",
	{
		transactionId: text("transaction_id")
			.notNull()
			.references(() => transactions.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
	},
	(t) => [
		primaryKey({ columns: [t.transactionId, t.memberId] }),
		index("transaction_for_household_member_idx").on(t.householdId, t.memberId),
	],
);

// A portion of one Transaction with its own amount, assignment, and For. A split Transaction is
// assigned only through its Splits (its own bucket_id, commitment_id, and For are empty), and its
// Splits' amounts add up to its amount. Each Split is assigned to a Bucket, a Commitment, or a
// Goal (Goal spending, out of its Earmark). `position` keeps the order they were entered in.
export const splits = sqliteTable(
	"splits",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		transactionId: text("transaction_id")
			.notNull()
			.references(() => transactions.id),
		position: integer("position").notNull(),
		amountCents: integer("amount_cents").notNull(),
		bucketId: text("bucket_id").references(() => buckets.id),
		commitmentId: text("commitment_id").references(() => commitments.id),
		goalId: text("goal_id").references(() => goals.id),
	},
	(t) => [index("splits_household_transaction_idx").on(t.householdId, t.transactionId)],
);

// Who a Split was For, like transaction_for: one row per Member, none for the whole Household.
export const splitFor = sqliteTable(
	"split_for",
	{
		splitId: text("split_id")
			.notNull()
			.references(() => splits.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
	},
	(t) => [
		primaryKey({ columns: [t.splitId, t.memberId] }),
		index("split_for_household_member_idx").on(t.householdId, t.memberId),
	],
);

// A Move of planned money within one month's Plan (no real money moves): from a Bucket, or from
// Free to Spend when `from_bucket_id` is null, to a Bucket (a Cover) or, for Goal funding, from
// Free to Spend to a Goal's Earmark (`to_goal_id`, with `to_bucket_id` null). Balances are
// derived from these rows (ADR-0004); undoing a Move deletes its row.
export const moves = sqliteTable(
	"moves",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		kind: text("kind", { enum: ["cover", "goal-funding"] }).notNull(),
		month: text("month").notNull(),
		fromBucketId: text("from_bucket_id").references(() => buckets.id),
		toBucketId: text("to_bucket_id").references(() => buckets.id),
		amountCents: integer("amount_cents").notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		toGoalId: text("to_goal_id").references(() => goals.id),
	},
	(t) => [index("moves_household_month_idx").on(t.householdId, t.month)],
);

// Where a Parent's Nudges go: one Web Push subscription per browser or installed app that
// turned them on. The endpoint is the push service's URL for that device, unique to it, so a
// device a different Parent turns Nudges on for moves to them.
export const pushSubscriptions = sqliteTable(
	"push_subscriptions",
	{
		endpoint: text("endpoint").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		// The subscription's public key and auth secret (base64url), which encrypt what's sent to it.
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("push_subscriptions_member_idx").on(t.memberId)],
);

// Which Nudges a Parent wants and when they're quiet. No row means the defaults
// (defaultNudgePreferences in @noodle/domain). Quiet hours are minutes after local midnight in
// the Parent's own `time_zone`; null when they have none.
export const nudgePreferences = sqliteTable("nudge_preferences", {
	memberId: text("member_id")
		.primaryKey()
		.references(() => members.id),
	householdId: text("household_id")
		.notNull()
		.references(() => households.id),
	bucketPace: integer("bucket_pace", { mode: "boolean" }).notNull(),
	otherParentQuickAdds: integer("other_parent_quick_adds", { mode: "boolean" }).notNull(),
	windfalls: integer("windfalls", { mode: "boolean" }).notNull(),
	quietStart: integer("quiet_start"),
	quietEnd: integer("quiet_end"),
	timeZone: text("time_zone").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

// A Scenario: a named set of Levers (JSON, see Lever in @noodle/domain) on the Plan, explored
// against it and never part of it until a Parent applies it.
export const scenarios = sqliteTable(
	"scenarios",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		name: text("name").notNull(),
		levers: text("levers", { mode: "json" }).$type<Lever[]>().notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("scenarios_household_idx").on(t.householdId)],
);

export type Household = typeof households.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Bucket = typeof buckets.$inferSelect;
