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
	},
	(t) => [index("buckets_household_idx").on(t.householdId)],
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

// A Move of planned money within one month's Plan (no real money moves): from a Bucket, or from
// Free to Spend when `from_bucket_id` is null, to a Bucket. Balances are derived from these rows
// (ADR-0004); undoing a Move deletes its row.
export const moves = sqliteTable(
	"moves",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		kind: text("kind", { enum: ["cover"] }).notNull(),
		month: text("month").notNull(),
		fromBucketId: text("from_bucket_id").references(() => buckets.id),
		toBucketId: text("to_bucket_id")
			.notNull()
			.references(() => buckets.id),
		amountCents: integer("amount_cents").notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("moves_household_month_idx").on(t.householdId, t.month)],
);

export type Household = typeof households.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Bucket = typeof buckets.$inferSelect;
