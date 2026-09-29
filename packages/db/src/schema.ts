import {
	type CsvMapping,
	DEFAULT_CHECK_IN_DAY,
	INSIGHT_KINDS,
	type LeverV1,
	PERK_KINDS,
	PERK_SOURCE_KINDS,
	PLAN_CHANGE_KINDS,
	type PlanChangeValue,
	type ReceiptLine,
	type ScenarioJson,
	type Weekday,
} from "@noodle/domain";
import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	primaryKey,
	real,
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
	// The Goal the Household keeps for emergencies: suggested for Windfalls, and where Fresh-start
	// leftovers are Swept when nobody decides at month-close.
	emergencyGoalId: text("emergency_goal_id").references((): AnySQLiteColumn => goals.id),
	// The day of the week the Household's Check-in falls on, 0 for Sunday to 6 for Saturday.
	checkInDay: integer("check_in_day").$type<Weekday>().notNull().default(DEFAULT_CHECK_IN_DAY),
	// What goes after the + of the Household's Receipt address (`receipts+<this>@…`): random, so
	// the address can't be guessed; made the first time a Parent asks for it.
	receiptAddress: text("receipt_address").unique(),
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

// A batch of Transactions brought in from an Account: today from a statement file a Parent
// uploaded (kept in R2 under `file_key`), later from a Bank Connection too. Its lines land as
// Transactions (money out, and money back on a card or loan) and income (money into a checking or
// savings Account), each keyed by its line's ID in the Account, so an overlapping Import adds
// nothing twice. The counts are of lines this Import added; `duplicate_count` were already in.
export const imports = sqliteTable(
	"imports",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id),
		source: text("source", { enum: ["csv", "ofx"] }).notNull(),
		fileName: text("file_name"),
		fileKey: text("file_key"),
		status: text("status", { enum: ["processing", "imported"] }).notNull(),
		transactionCount: integer("transaction_count").notNull().default(0),
		incomeCount: integer("income_count").notNull().default(0),
		duplicateCount: integer("duplicate_count").notNull().default(0),
		// The statement's first and last days, and the balance it says the Account ended at.
		firstDate: text("first_date"),
		lastDate: text("last_date"),
		closingBalanceCents: integer("closing_balance_cents"),
		closingBalanceDate: text("closing_balance_date"),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("imports_account_idx").on(t.accountId)],
);

// How an Account's CSV statements are laid out (a CsvMapping from @noodle/domain, as JSON),
// remembered from its last CSV Import.
export const csvMappings = sqliteTable("csv_mappings", {
	accountId: text("account_id")
		.primaryKey()
		.references(() => accounts.id),
	householdId: text("household_id")
		.notNull()
		.references(() => households.id),
	mapping: text("mapping", { mode: "json" }).$type<CsvMapping>().notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

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
		source: text("source", { enum: ["quick-add", "import"] }).notNull(),
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
		// The Import that brought it in, and its line's ID in the Account (see imports).
		importId: text("import_id").references(() => imports.id),
		externalId: text("external_id"),
		// How a Quick Add came in when it wasn't typed into the app: "shortcut" for one the iPhone
		// Shortcut captured at the tap (see capture_tokens), "receipt" for one a Receipt made when
		// no Transaction was there for it yet. Still a Quick Add, Matched the same way.
		capturedVia: text("captured_via", { enum: ["shortcut", "receipt"] }),
	},
	(t) => [
		index("transactions_household_date_idx").on(t.householdId, t.date),
		uniqueIndex("transactions_account_external_idx").on(t.accountId, t.externalId),
	],
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

// A Match: a Quick Add and the imported Transaction that is its bank copy, so the spend counts
// once. The Quick Add is what counts (its amount, assignment, Splits and For); the imported copy
// counts nowhere and is shown only through it (counting.ts). Appended by an Import (no
// `created_by_member_id`) or a Parent; unmatching sets `removed_at`, and a pair once unmatched is
// never Matched again automatically. Each Transaction is in at most one Match at a time.
export const matches = sqliteTable(
	"matches",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		quickAddId: text("quick_add_id")
			.notNull()
			.references(() => transactions.id),
		importedId: text("imported_id")
			.notNull()
			.references(() => transactions.id),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
		removedByMemberId: text("removed_by_member_id").references(() => members.id),
	},
	(t) => [
		index("matches_household_idx").on(t.householdId),
		uniqueIndex("matches_one_per_quick_add").on(t.quickAddId).where(sql`${t.removedAt} is null`),
		uniqueIndex("matches_one_per_imported").on(t.importedId).where(sql`${t.removedAt} is null`),
	],
);

// A Transfer: money moving between two of the Household's own Accounts, so neither side counts as
// spending or income (counting.ts). The side leaving an Account is a Transaction (money out); the
// side arriving is money back onto a card or loan (a negative Transaction) or income. Either side
// may be missing: a Parent can mark one side alone, when the other Account isn't imported.
// Appended by an Import (no created_by) or a Parent; unmarking sets removed_at, and a removed pair
// is never marked again automatically. Each Transaction or income row is in one Transfer at a time.
export const transfers = sqliteTable(
	"transfers",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		outTransactionId: text("out_transaction_id").references(() => transactions.id),
		inTransactionId: text("in_transaction_id").references(() => transactions.id),
		inIncomeId: text("in_income_id").references(() => income.id),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
		removedByMemberId: text("removed_by_member_id").references(() => members.id),
	},
	(t) => [
		index("transfers_household_idx").on(t.householdId),
		uniqueIndex("transfers_one_per_out").on(t.outTransactionId).where(sql`${t.removedAt} is null`),
		uniqueIndex("transfers_one_per_in").on(t.inTransactionId).where(sql`${t.removedAt} is null`),
		uniqueIndex("transfers_one_per_income").on(t.inIncomeId).where(sql`${t.removedAt} is null`),
	],
);

// A Refund: money back (a negative Transaction) linked to the purchase it's for. While linked, the
// money back carries the purchase's assignment and For, so it restores that Bucket (or Commitment,
// or Goal) in the month it lands. Unlinking sets removed_at and clears that assignment again.
export const refunds = sqliteTable(
	"refunds",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		refundTransactionId: text("refund_transaction_id")
			.notNull()
			.references(() => transactions.id),
		originalTransactionId: text("original_transaction_id")
			.notNull()
			.references(() => transactions.id),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
		removedByMemberId: text("removed_by_member_id").references(() => members.id),
	},
	(t) => [
		index("refunds_household_idx").on(t.householdId),
		index("refunds_original_idx").on(t.originalTransactionId),
		uniqueIndex("refunds_one_per_refund")
			.on(t.refundTransactionId)
			.where(sql`${t.removedAt} is null`),
	],
);

// A Move of planned money within one month's Plan (no real money moves): from a Bucket, or from
// Free to Spend when `from_bucket_id` is null, to a Bucket (a Cover) or, for Goal funding, from
// Free to Spend to a Goal's Earmark (`to_goal_id`, with `to_bucket_id` null). A `windfall` Move
// comes from the month's Windfall (`from_bucket_id` null) to a Bucket or a Goal, never out of
// Free to Spend. A `sweep` is a Fresh-start Bucket's leftover at the end of `month` (`from_bucket_id`)
// into a Goal's Earmark (`to_goal_id`). Balances are derived from these rows (ADR-0004); undoing a
// Move deletes its row.
export const moves = sqliteTable(
	"moves",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		kind: text("kind", { enum: ["cover", "goal-funding", "windfall", "sweep"] }).notNull(),
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
		levers: text("levers", { mode: "json" }).$type<ScenarioJson | LeverV1[]>().notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		/** When it was last applied to the Plan, and by which Parent; null until it is. */
		appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
		appliedByMemberId: text("applied_by_member_id").references(() => members.id),
	},
	(t) => [index("scenarios_household_idx").on(t.householdId)],
);

// The Plan's history: one row appended per Plan change (ADR-0014), in the same batch as the
// write it describes, and never updated or deleted. `before`/`after` hold only the values the
// kind has (PlanChangeValue in @noodle/domain); `owner_member_id` is set when the change is to
// a Personal Allowance, so reads can hide it from the other Parent (ADR-0003).
export const planChanges = sqliteTable(
	"plan_changes",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		kind: text("kind", { enum: PLAN_CHANGE_KINDS }).notNull(),
		/** The Bucket, Commitment or Goal; null for the Baseline. */
		targetId: text("target_id"),
		/** The first month it takes effect. */
		month: text("month").notNull(),
		scope: text("scope", { enum: ["from-on", "just"] }).notNull(),
		before: text("before", { mode: "json" }).$type<PlanChangeValue>(),
		after: text("after", { mode: "json" }).$type<PlanChangeValue>(),
		ownerMemberId: text("owner_member_id").references(() => members.id),
		source: text("source", { enum: ["plan", "scenario"] }).notNull(),
		scenarioId: text("scenario_id"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		index("plan_changes_household_month_idx").on(t.householdId, t.month),
		index("plan_changes_household_target_idx").on(t.householdId, t.targetId),
	],
);

// Income received: money in that isn't a Refund of a purchase (a paycheck, a bonus, a tax
// refund). `date` is the day it came in, in the Household's time zone; `amount_cents` is what
// came in, so it's positive. Kept apart from Transactions, whose amounts are money spent, so no
// spending total can ever count it; Imports will write deposits here too. Income beyond the
// month's Baseline is its Windfall.
export const income = sqliteTable(
	"income",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		date: text("date").notNull(),
		amountCents: integer("amount_cents").notNull(),
		note: text("note"),
		// The Parent who recorded it; null for imported income.
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		// For imported income: the Account it came into, the Import, and its line's ID there.
		accountId: text("account_id").references(() => accounts.id),
		importId: text("import_id").references(() => imports.id),
		externalId: text("external_id"),
	},
	(t) => [
		index("income_household_date_idx").on(t.householdId, t.date),
		uniqueIndex("income_account_external_idx").on(t.accountId, t.externalId),
	],
);

// A month closed: the Parents decided its Sweeps and Windfall at month-close, or nobody did in time
// and the defaults were applied (`decided_by_member_id` null). One per Household and month; the
// Moves it decided are written in the same batch, only while there is none yet.
export const monthCloses = sqliteTable(
	"month_closes",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		month: text("month").notNull(),
		decidedByMemberId: text("decided_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [uniqueIndex("month_closes_household_month_idx").on(t.householdId, t.month)],
);

// A Rule: a stated mapping from a merchant pattern (a merchantKey from @noodle/domain, matched as
// whole words) to a Bucket, and For whoever `rule_for` names. Categorization tries Rules before
// anything learned or modelled, and a Rule always wins. A Rule into a Parent's own Personal
// Allowance is theirs alone (`owner_member_id`, ADR-0003): the other Parent never reads it and
// their Imports never use it. One per Household, pattern, and owner, so a Parent's private Rule
// and the Household's for the same merchant can't overwrite each other. `matched_count` counts
// the Transactions it has filed.
export const rules = sqliteTable(
	"rules",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		pattern: text("pattern").notNull(),
		bucketId: text("bucket_id")
			.notNull()
			.references(() => buckets.id),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		ownerMemberId: text("owner_member_id").references(() => members.id),
		matchedCount: integer("matched_count").notNull().default(0),
	},
	(t) => [
		uniqueIndex("rules_household_pattern_owner_idx").on(
			t.householdId,
			t.pattern,
			sql`coalesce(${t.ownerMemberId}, '')`,
		),
	],
);

// Who a Rule files spending For: one row per Member, like `transaction_for` (ADR-0011). No rows
// means the whole Household.
export const ruleFor = sqliteTable(
	"rule_for",
	{
		ruleId: text("rule_id")
			.notNull()
			.references(() => rules.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
	},
	(t) => [primaryKey({ columns: [t.ruleId, t.memberId] })],
);

// What categorization decided for an imported Transaction, made for the Parent who imported it
// (`member_id`), so only Buckets they may see were considered (ADR-0003). `filed`: it was assigned
// to `bucket_id`, and shows an "auto" marker while it still is; `review`: it was left unassigned
// for Review, with `bucket_id` the best guess (never a Personal Allowance) or none. `merchant` is
// the merchantKey of its statement line, so a Parent's correction teaches the right merchant even
// once its note is edited. Deleted with its Transaction.
export const categorizations = sqliteTable(
	"categorizations",
	{
		transactionId: text("transaction_id")
			.primaryKey()
			.references(() => transactions.id, { onDelete: "cascade" }),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id").references(() => members.id),
		outcome: text("outcome", { enum: ["filed", "review"] }).notNull(),
		method: text("method", { enum: ["rule", "similar", "model"] }),
		bucketId: text("bucket_id").references(() => buckets.id),
		confidence: real("confidence"),
		merchant: text("merchant").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [index("categorizations_household_idx").on(t.householdId, t.outcome)],
);

export type Household = typeof households.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Bucket = typeof buckets.$inferSelect;

// A Parent's capture token: the secret the iPhone Shortcut sends to record a Quick Add at the
// tap, as that Parent. Only its SHA-256 is kept; the token is shown once, when it's made. Each
// Parent has at most one live token: making a new one revokes the old, and revoking is for good.
export const captureTokens = sqliteTable(
	"capture_tokens",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		tokenHash: text("token_hash").notNull().unique(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
	},
	(t) => [uniqueIndex("capture_tokens_live_idx").on(t.memberId).where(sql`${t.revokedAt} is null`)],
);

// A Parent finishing a week's Check-in. `week` is the Check-in day that starts the week (see
// checkInWeek in @noodle/domain); one per Parent and week, so finishing again changes nothing.
export const checkIns = sqliteTable(
	"check_ins",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		week: text("week").notNull(),
		completedAt: integer("completed_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		primaryKey({ columns: [t.memberId, t.week] }),
		index("check_ins_household_week_idx").on(t.householdId, t.week),
	],
);

// An Insight: a suggested change found by the nightly job (or a Parent's "Look for Insights now"),
// backed by the Transactions and Commitments it names and a yearly impact that domain code
// computed; a model only wrote its title and body. `owner_member_id` is set when it rests on a
// Parent's own Personal Allowance, so only they ever read it (ADR-0003). `fingerprint` names the
// finding (with its owner): one row per Household and fingerprint, so a dismissed Insight never
// returns. Nothing here changes money or the Plan: a Parent acts on it.
export const insights = sqliteTable(
	"insights",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		ownerMemberId: text("owner_member_id").references(() => members.id),
		kind: text("kind", { enum: INSIGHT_KINDS }).notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		yearlyImpactCents: integer("yearly_impact_cents").notNull(),
		transactionIds: text("transaction_ids", { mode: "json" }).$type<string[]>().notNull(),
		commitmentIds: text("commitment_ids", { mode: "json" }).$type<string[]>().notNull(),
		// The Perks a Perk Overlap rests on.
		perkIds: text("perk_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
		status: text("status", { enum: ["new", "accepted", "dismissed"] })
			.notNull()
			.default("new"),
		fingerprint: text("fingerprint").notNull(),
		decidedByMemberId: text("decided_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [uniqueIndex("insights_household_fingerprint_idx").on(t.householdId, t.fingerprint)],
);

// A Perk Source: a product the Household holds that bundles benefits (a phone plan, card,
// membership, insurance policy). The nightly look for Insights suggests the catalog's products it
// sees in spending or Accounts (`suggested`); a Parent confirms one, or adds their own. Dismissed
// or removed ones stay, so they aren't suggested again: `fingerprint` names the product, with its
// owner (one row per Household and fingerprint). `owner_member_id` is set for one seen only in a
// Parent's own Personal Allowance: only they ever read it (ADR-0003). `research` is where reading
// its Perks stands: `researching`, `done`, `needs-plan` (its page's Perks depend on a plan tier
// the Parent picks from `plan_options`), `needs-link` (no page to read), or `unreadable`.
export const perkSources = sqliteTable(
	"perk_sources",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		ownerMemberId: text("owner_member_id").references(() => members.id),
		name: text("name").notNull(),
		kind: text("kind", { enum: PERK_SOURCE_KINDS }).notNull(),
		catalogKey: text("catalog_key"),
		/** Its plan tier, once a Parent said which. */
		plan: text("plan"),
		planOptions: text("plan_options", { mode: "json" }).$type<string[]>(),
		/** The page its Perks are read from. */
		pageUrl: text("page_url"),
		/** What a suggestion was seen in: a statement line, or an Account's name. */
		seenIn: text("seen_in"),
		status: text("status", { enum: ["suggested", "confirmed", "dismissed"] }).notNull(),
		research: text("research", {
			enum: ["idle", "researching", "done", "needs-plan", "needs-link", "unreadable"],
		})
			.notNull()
			.default("idle"),
		/** When its page was last read for Perks, whatever came of it. */
		checkedAt: integer("checked_at", { mode: "timestamp_ms" }),
		fingerprint: text("fingerprint").notNull(),
		decidedByMemberId: text("decided_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [uniqueIndex("perk_sources_household_fingerprint_idx").on(t.householdId, t.fingerprint)],
);

// A Perk: one benefit a Perk Source includes, as its page said on the date it was checked, with
// that page's link and the page's own words. `key` (its kind and the name it would have on a
// statement, perkKey in @noodle/domain) keeps it the same Perk across re-checks, so the Insights
// resting on it keep it.
export const perks = sqliteTable(
	"perks",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		perkSourceId: text("perk_source_id")
			.notNull()
			.references(() => perkSources.id),
		key: text("key").notNull(),
		name: text("name").notNull(),
		kind: text("kind", { enum: PERK_KINDS }).notNull(),
		matches: text("matches").notNull(),
		quote: text("quote").notNull(),
		sourceUrl: text("source_url").notNull(),
		checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [uniqueIndex("perks_source_key_idx").on(t.perkSourceId, t.key)],
);

// A Receipt: an itemized record of a purchase a Parent sent in (a forwarded email; later a
// photo), kept in R2 (`file_key`, with a small image of it at `thumbnail_key` when it's a
// picture) and read by a model into `lines` (ReceiptLine from @noodle/domain, as JSON). It's
// attached to the Transaction it's for, one Receipt per Transaction; the Splits it proposes are
// worked out from its lines and total by domain code whenever it's read. One whose total couldn't
// be read stays unattached. `member_id` is the Parent who sent it.
export const receipts = sqliteTable(
	"receipts",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		source: text("source", { enum: ["email", "photo"] }).notNull(),
		// Deleting its Transaction leaves the Receipt unattached, not refused.
		transactionId: text("transaction_id").references(() => transactions.id, {
			onDelete: "set null",
		}),
		fileKey: text("file_key").notNull(),
		thumbnailKey: text("thumbnail_key"),
		merchant: text("merchant"),
		date: text("date"),
		totalCents: integer("total_cents"),
		lines: text("lines", { mode: "json" }).$type<ReceiptLine[]>().notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		index("receipts_household_idx").on(t.householdId),
		uniqueIndex("receipts_transaction_idx").on(t.transactionId),
	],
);
