import {
	type CsvMapping,
	DEFAULT_CHECK_IN_DAY,
	type DraftLabels,
	INSIGHT_KINDS,
	MONEY_IN_KINDS,
	PERK_KINDS,
	PERK_RENEWALS,
	PERK_SOURCE_KINDS,
	PLAN_CHANGE_KINDS,
	type PlanChangeValue,
	type ReceiptLine,
	type ScenarioChangeV1,
	type ScenarioJson,
	STORED_MONEY_IN_KINDS,
	type Weekday,
} from "@noodle/domain";
import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
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
	// The Goal the Household keeps for emergencies: suggested for Extra income, and where resets monthly
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
		// 1–8, their identity colour (--bucket-N). A Child always has one; a Parent has one once
		// they pick it (issue 104), and is drawn plain until then.
		color: integer("color"),
		// A removed Child leaves the Household's pickers, but Transactions For them keep it.
		removedAt: integer("removed_at", { mode: "timestamp_ms" }),
	},
	(t) => [index("members_household_idx").on(t.householdId)],
);

// A Parent's invitation for the other Parent to join the Household. It is accepted through its
// link (`/invite/<token>`, by whoever holds it) or by whoever signs in with a verified email
// matching `email`.
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
		// The invite link's token, as its SHA-256 hash (hex): the token itself is never stored
		// (#60, invite-token.ts). Null on invites from before links.
		tokenHash: text("token_hash"),
		// When the link and the invite stop working. Null on invites from before links: no expiry.
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		// When the email last went out (null: created_at), and how many went out on that UTC day,
		// for Resend's limits (#60, invite-token.ts checkResend).
		sentAt: integer("sent_at", { mode: "timestamp_ms" }),
		sendsThatDay: integer("sends_that_day").notNull().default(1),
	},
	(t) => [
		uniqueIndex("invites_token_hash_idx").on(t.tokenHash),
		// A Household has at most one open invite (there is only ever one other Parent to invite).
		uniqueIndex("invites_one_open_per_household")
			.on(t.householdId)
			.where(sql`${t.acceptedByMemberId} is null`),
		index("invites_email_idx").on(t.email),
	],
);

// The Plan is stored effective-dated (see planForMonth in @noodle/domain): take-home pay or
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
		// The group a Parent lists it under in the Plan (issue 98): only a name Buckets share. Null
		// for none; never set on a Personal Allowance.
		groupName: text("group_name"),
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

// Whether a Bucket carries over (1) or resets monthly (0) from `month` onward, effective-dated like an
// allowance. A Bucket with no row is resets monthly.
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
		/**
		 * The credit card or loan its payments pay down (issue 93, ADR-0050); null for none. On an
		 * Account kept by hand each payment filed here brings what's owed down (owedOn in
		 * @noodle/domain).
		 */
		accountId: text("account_id").references((): AnySQLiteColumn => accounts.id),
		/**
		 * A Parent said this is a set payment on a balance they're carrying: what lets it pay down a
		 * card Noodle follows, whose purchases are already counted in Buckets.
		 */
		carriedBalance: integer("carried_balance", { mode: "boolean" }).notNull().default(false),
		/**
		 * Its amount is "about" (it varies, as power and water do), not the same each time (issue
		 * 135). The Plan still sets its terms' amount aside; the average and range shown are worked
		 * out from its charges (aboutAmount in @noodle/domain), never stored.
		 */
		about: integer("about", { mode: "boolean" }).notNull().default(false),
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

// A Bank Connection: an ongoing authorized link to a financial institution, through a provider
// (Plaid, the only one: ADR-0017), that produces Imports automatically. `provider` is a plain
// text column (the enum is Drizzle's alone), so narrowing it needed no migration. `external_id`
// is the provider's ID for the link (Plaid's Item ID). `credential` is what the provider needs to
// read it (the Item's access token), encrypted by the Worker before it's stored
// (bank-credential.ts) and never sent to a browser.
// `cursor` is where the provider's changes were last read up to; `status` is "importing" until the
// institution's history has all come in, "failed" while its reads keep failing (the next sync
// tries again), and "reconnect" once the institution wants the Parent to sign in again: nothing
// is read until they do. `notice` is what the provider last asked the Parent to read about the
// link (the `display_message` on a Plaid error), as plain text; null once a read works again.
export const bankConnections = sqliteTable(
	"bank_connections",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		provider: text("provider", { enum: ["plaid"] }).notNull(),
		externalId: text("external_id").notNull(),
		institution: text("institution"),
		// Plaid's ID for the institution, kept to tell when a Parent links the same bank again (#71).
		// Null on Bank Connections made before it was kept; those are told by name.
		institutionId: text("institution_id"),
		credential: text("credential").notNull(),
		cursor: text("cursor"),
		// The first day (YYYY-MM-DD) its Imports keep: what the Parent chose when connecting (#89).
		// Nothing dated earlier is brought in. Null on Bank Connections made before the choice was
		// asked, which keep everything.
		historyStart: text("history_start"),
		// "choosing" until a Parent has said which Accounts its accounts are (ADR-0020): nothing is
		// read from it meanwhile, so no history is lost.
		status: text("status", {
			enum: ["choosing", "importing", "ready", "failed", "reconnect", "disconnected"],
		})
			.notNull()
			.default("importing"),
		lastImportedAt: integer("last_imported_at", { mode: "timestamp_ms" }),
		notice: text("notice"),
		// Plaid's webhooks (#71): when the last one for this Item came, and the address Plaid was
		// last told to send them to (null on Bank Connections made before it was kept).
		lastWebhookAt: integer("last_webhook_at", { mode: "timestamp_ms" }),
		webhookUrl: text("webhook_url"),
		// Plaid said the login has an account the Parent hasn't been asked about.
		newAccounts: integer("new_accounts", { mode: "boolean" }).notNull().default(false),
		// One sync at a time: when the one running began (null when none is), and whether another
		// was asked for meanwhile, which runs once this one ends.
		syncStartedAt: integer("sync_started_at", { mode: "timestamp_ms" }),
		syncPending: integer("sync_pending", { mode: "boolean" }).notNull().default(false),
		createdByMemberId: text("created_by_member_id")
			.notNull()
			.references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [uniqueIndex("bank_connections_external_idx").on(t.householdId, t.provider, t.externalId)],
);

// A Parent's Plaid Link in progress (#71): the link token and the page they started from, kept
// while their bank's own page or app has the screen, for when it comes back to /bank/return in a
// browser that doesn't have them (an installed PWA handing off to Safari, say). One per Parent,
// overwritten by the next, and ignored once the token would have expired. No foreign keys: it's
// short-lived, and must never stand in the way of removing a Parent or a Bank Connection.
export const bankLinkSessions = sqliteTable("bank_link_sessions", {
	memberId: text("member_id").primaryKey(),
	householdId: text("household_id").notNull(),
	linkToken: text("link_token").notNull(),
	returnTo: text("return_to").notNull(),
	// The Bank Connection being logged in to again (update mode); null for a new one.
	connectionId: text("connection_id"),
	// For a new one, the first day its Imports will keep (#89): what the Parent chose before Link
	// opened, kept here so it's still known when their bank sends them back.
	historyStart: text("history_start"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// A real-world place money lives or is owed, entered by hand or brought in by a Bank Connection
// (with the provider's ID for it). For credit cards and loans the balance is what's owed. `kind`
// is ACCOUNT_KINDS in @noodle/domain.
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
		bankConnectionId: text("bank_connection_id").references(() => bankConnections.id),
		externalId: text("external_id"),
		/** The account number's last four digits, from the bank or a statement; null until known. */
		mask: text("mask"),
		/**
		 * When a Parent archived it (issue 94); null while it's in use. An archived Account is out of
		 * the Accounts list, the pickers and the totals, and nothing new is brought into it; its
		 * Transactions stay as they are.
		 */
		archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
	},
	(t) => [
		index("accounts_household_idx").on(t.householdId),
		uniqueIndex("accounts_bank_external_idx").on(t.bankConnectionId, t.externalId),
	],
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
		/**
		 * The day the balance was true ("YYYY-MM-DD"): a statement's closing date, or the day a Parent
		 * typed it. Null for a bank's balance and for rows from before issue 93, which count as of
		 * `created_at`'s day in the Household's time zone.
		 */
		asOf: text("as_of"),
	},
	(t) => [index("account_balances_account_idx").on(t.accountId)],
);

// A bank line that is a line already in its Account from elsewhere (a statement, or an earlier
// Bank Connection), so it wasn't brought in again (ADR-0020): the bank's key for it (`id:<bank
// ID>`, as bankLineKey makes it) and the Transaction or income row it is. Later reads of the same
// line skip it, and each row stands for at most one bank line.
export const bankLinePairs = sqliteTable(
	"bank_line_pairs",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id),
		bankKey: text("bank_key").notNull(),
		// A Transaction's or an income row's ID; no reference, as it may be either.
		rowId: text("row_id").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		primaryKey({ columns: [t.accountId, t.bankKey] }),
		uniqueIndex("bank_line_pairs_row_idx").on(t.rowId),
	],
);

// A line a Parent deleted from an Account (ADR-0045): the ID its Transaction was kept under there
// (`transactions.external_id`: a statement line's, or `id:<bank ID>` for a Bank Connection's).
// An Import leaves these out, so a deleted line doesn't come back with the next sync or when the
// same statement is uploaded again. Only the ID is kept, nothing else about the Transaction.
export const deletedBankLines = sqliteTable(
	"deleted_bank_lines",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		accountId: text("account_id")
			.notNull()
			.references(() => accounts.id),
		externalId: text("external_id").notNull(),
		deletedAt: integer("deleted_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [primaryKey({ columns: [t.accountId, t.externalId] })],
);

// A batch of Transactions brought in from an Account: from a statement file a Parent uploaded
// (kept in R2 under `file_key`), or read from its Bank Connection ("bank"). Its lines land as
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
		source: text("source", { enum: ["csv", "ofx", "bank"] }).notNull(),
		fileName: text("file_name"),
		fileKey: text("file_key"),
		status: text("status", { enum: ["processing", "imported"] }).notNull(),
		// The last four digits of the account a statement file said it's for (OFX's ACCTID), so a
		// file for another account can be caught, and a bank's account matched with it.
		accountDigits: text("account_digits"),
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
		bankConnectionId: text("bank_connection_id").references(() => bankConnections.id),
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

// A target the Household funds over time. A `save` Goal is held as money set aside on one checking
// or savings Account (ADR-0002). A `payoff` Goal pays down one credit card or loan (ADR-0019): its
// target is what was owed when it was added, and its progress how far the Account's balance has
// come down since; it has no claims or spending, and each card or loan has at most one that's
// neither completed nor archived. `target_date` is optional ("YYYY-MM-DD"); `from_month` is the
// month it was added (or a payoff Goal started again). A completed Goal keeps what it has set
// aside; an archived one claims nothing.
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
		kind: text("kind", { enum: ["save", "payoff"] })
			.notNull()
			.default("save"),
	},
	(t) => [
		index("goals_household_idx").on(t.householdId),
		uniqueIndex("goals_one_payoff_per_account")
			.on(t.accountId)
			.where(sql`${t.kind} = 'payoff' and ${t.completedAt} is null and ${t.archivedAt} is null`),
	],
);

// not set aside Account money set aside for a Goal, or released back to not set aside (negative). Not a
// Move: the Plan is untouched. A Goal's set-aside money is these, plus its Goal funding Moves, less the
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
		// The Goal it's spent from, out of what it has set aside (never a Bucket or Free to Spend).
		goalId: text("goal_id").references(() => goals.id),
		// The Import that brought it in, and its line's ID in the Account (see imports).
		importId: text("import_id").references(() => imports.id),
		externalId: text("external_id"),
		// How a Quick Add came in when it wasn't typed into the app: "shortcut" for one the iPhone
		// Shortcut captured at the tap (see capture_tokens), "receipt" for one a Receipt made when
		// no Transaction was there for it yet. Still a Quick Add, Matched the same way.
		capturedVia: text("captured_via", { enum: ["shortcut", "receipt"] }),
		// An imported Transaction the bank has reported but not yet posted. It counts like any
		// other; when it posts, its posted copy takes over this row (bank-sync.ts), so the two
		// never both count and what a Parent did to it stays.
		pending: integer("pending", { mode: "boolean" }).notNull().default(false),
		// An imported line's merchant by its clean name ("Costco" for "COSTCO WHSE #1042 SEATTLE
		// WA"), named by background AI from the note (merchant-run.ts, ADR-0027). Null until named,
		// and always for a Quick Add, whose note is what the Parent typed.
		merchant: text("merchant"),
		// Goes up by one with every write that changes what a Parent sees of it. A Parent's change
		// says which version it was made on, and is refused once that isn't the one any more, so two
		// screens never quietly overwrite each other (ADR-0041).
		version: integer("version").notNull().default(0),
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
// Goal (Goal spending, out of what it has set aside). `position` keeps the order they were entered in.
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
		// Why a one-sided Transfer is one, when a Parent said: 'between-us' is money one Parent
		// moved to the other, whose own Account isn't in Noodle (ADR-0052). Null for the rest.
		reason: text("reason", { enum: ["between-us"] }),
		// The Account on the side Noodle can't see, once a Parent names it (a remembered pair, money-in.ts).
		otherAccountId: text("other_account_id").references(() => accounts.id),
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
// Free to Spend to what a Goal has set aside (`to_goal_id`, with `to_bucket_id` null). A `windfall` Move
// comes from the month's Extra income (`from_bucket_id` null) to a Bucket or a Goal, never out of
// Free to Spend. A `sweep` is a Bucket that resets monthly's leftover at the end of `month` (`from_bucket_id`)
// into what a Goal has set aside (`to_goal_id`). Balances are derived from these rows (ADR-0004); undoing a
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

// A Scenario: a named set of Changes (JSON, see Change in @noodle/domain) on the Plan, explored
// against it and never part of it until a Parent applies it.
export const scenarios = sqliteTable(
	"scenarios",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		name: text("name").notNull(),
		levers: text("levers", { mode: "json" }).$type<ScenarioJson | ScenarioChangeV1[]>().notNull(),
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
		/** The Bucket, Commitment or Goal; null for take-home pay. */
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
// month's take-home pay is its Extra income.
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
		// Money in has a kind (ADR-0057). Only what the row itself must hold is kept here: a Refund
		// or Paid back. A Transfer or Between us is its row in `transfers`; with neither it is
		// Income (moneyInKindOf in @noodle/domain, money-in.ts). Appended columns: imports.ts
		// inserts by position.
		kind: text("kind", { enum: STORED_MONEY_IN_KINDS }),
		// Waiting in Review for a Parent to say its kind (person-to-person wording on Import).
		// While it waits it counts nowhere (incomeCounts).
		needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
		// Goes up with every change of kind, as a Transaction's does (ADR-0041).
		version: integer("version").notNull().default(0),
		// Whose pay it is (issue 133, ADR-0057): a Parent, or null for the Household. Last, as
		// imports.ts inserts by position.
		payMemberId: text("pay_member_id").references(() => members.id),
	},
	(t) => [
		index("income_household_date_idx").on(t.householdId, t.date),
		uniqueIndex("income_account_external_idx").on(t.accountId, t.externalId),
	],
);

// A month closed: the Parents decided its Sweeps and Extra income at month-close, or nobody did in time
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
		// What it files into: a Bucket or a Commitment, exactly one of them (ADR-0030).
		bucketId: text("bucket_id").references(() => buckets.id),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		ownerMemberId: text("owner_member_id").references(() => members.id),
		matchedCount: integer("matched_count").notNull().default(0),
		commitmentId: text("commitment_id").references(() => commitments.id),
	},
	(t) => [
		uniqueIndex("rules_household_pattern_owner_idx").on(
			t.householdId,
			t.pattern,
			sql`coalesce(${t.ownerMemberId}, '')`,
		),
		check("rules_one_target", sql`(bucket_id is null) <> (commitment_id is null)`),
	],
);

// A Rule for money in (ADR-0057): wording (a merchantKey, matched as whole words) that is always
// one kind. Kept apart from `rules`, whose check wants a Bucket or a Commitment. One per Household
// and pattern; income is the Household's, so these are never private.
export const moneyInRules = sqliteTable(
	"money_in_rules",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		pattern: text("pattern").notNull(),
		kind: text("kind", { enum: MONEY_IN_KINDS }).notNull(),
		// For a Rule that says Income: the Parent whose pay it is; null for the Household.
		payMemberId: text("pay_member_id").references(() => members.id),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		// A remembered pair of Accounts (ADR-0057): money in with this wording into
		// `into_account_id` came from `other_account_id` and is always a Transfer. Null on a plain Rule.
		intoAccountId: text("into_account_id").references(() => accounts.id),
		otherAccountId: text("other_account_id").references(() => accounts.id),
	},
	(t) => [uniqueIndex("money_in_rules_household_pattern_idx").on(t.householdId, t.pattern)],
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
		// How it was filed, or where a Review row's guess came from ("none": nothing had one).
		method: text("method", { enum: ["rule", "similar", "model", "none"] }),
		bucketId: text("bucket_id").references(() => buckets.id),
		confidence: real("confidence"),
		merchant: text("merchant").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		// Why: the merchant filed before it was like ("similar"), or the model's few words.
		reason: text("reason"),
		// The Commitment a Rule filed it to, in place of a Bucket (ADR-0030).
		commitmentId: text("commitment_id").references(() => commitments.id),
		// When a Parent put it back in Review with Undo (issue 105): theirs to decide from then on,
		// so a look again leaves it alone. Null again once it's filed.
		returnedAt: integer("returned_at", { mode: "timestamp_ms" }),
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
		/** Its annual fee, as a Parent typed it. */
		annualFeeCents: integer("annual_fee_cents"),
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
		/** What it's worth, in cents, when the page's quote states it. */
		valueCents: integer("value_cents"),
		/** How often it renews, as the page says. */
		renews: text("renews", { enum: PERK_RENEWALS }),
		/** A Parent typed the value and renewal; a re-check keeps them (#80). */
		valueByHand: integer("value_by_hand", { mode: "boolean" }).notNull().default(false),
	},
	(t) => [uniqueIndex("perks_source_key_idx").on(t.perkSourceId, t.key)],
);

// A Perk a Parent marked used by hand: the day, who, and a short note. Kept by the Perk's ID,
// which a re-check keeps; the uses of a Perk that's gone are never read.
export const perkUses = sqliteTable("perk_uses", {
	id: text("id").primaryKey(),
	householdId: text("household_id")
		.notNull()
		.references(() => households.id),
	perkId: text("perk_id").notNull(),
	memberId: text("member_id")
		.notNull()
		.references(() => members.id),
	usedOn: text("used_on").notNull(),
	note: text("note"),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

// A benefits page as it was last read: its text, when, and whether a plain fetch or a real
// browser (Browser Rendering) got it, so research soon after (a Parent picking a plan tier, a
// second Household with the same card) doesn't fetch or render it again. Public pages only, kept
// by address: nothing here belongs to a Household.
export const perkPages = sqliteTable("perk_pages", {
	url: text("url").primaryKey(),
	/** Where it ended up, after redirects. */
	finalUrl: text("final_url").notNull(),
	text: text("text").notNull(),
	via: text("via", { enum: ["fetch", "browser"] }).notNull(),
	fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
});

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

// The first Plan's draft, made once a Household setting up its Plan has history (its first
// Import). The draft itself is computed from the history each time it's read (draftPlan in
// @noodle/domain); only what a model said is kept here: which Bucket name each merchant goes
// in, and readable names for statement lines. `finished_at` is set when a Parent is done with
// it, so it no longer shows.
export const planDrafts = sqliteTable("plan_drafts", {
	householdId: text("household_id")
		.primaryKey()
		.references(() => households.id),
	labels: text("labels", { mode: "json" }).$type<DraftLabels>().notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
	finishedByMemberId: text("finished_by_member_id").references(() => members.id),
});

// A Parent's decision on one of the draft's suggestions, by its key ("baseline",
// "commitment:<merchant>", "bucket:<name>"): added to the Plan (as suggested or changed), or
// skipped. One per Household and key: the first decision stands.
export const planDraftDecisions = sqliteTable(
	"plan_draft_decisions",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		key: text("key").notNull(),
		decision: text("decision", { enum: ["added", "skipped"] }).notNull(),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id),
		decidedAt: integer("decided_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [primaryKey({ columns: [t.householdId, t.key] })],
);

// The get-started wizard's progress, one row per Household (#53): the step the Parents are on,
// what they've answered so far (JSON, read by apps/web's setup code), the steps they skipped, and
// when they started and finished. Written after every step, so leaving and coming back resumes.
// Nothing here is money or the Plan: the wizard's answers land through the Plan's own writes.
export const setupProgress = sqliteTable("setup_progress", {
	householdId: text("household_id")
		.primaryKey()
		.references(() => households.id),
	step: integer("step").notNull().default(1),
	answers: text("answers", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
	skipped: text("skipped", { mode: "json" }).$type<number[]>().notNull().default([]),
	startedAt: integer("started_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});

// The Setup Workflow's background jobs for a Household, one row per job (wait for history,
// categorize, draft the Plan, ...), so the wizard can say "2 of 4 done". Each step of the Workflow
// writes its own row; a re-run overwrites them.
export const setupJobs = sqliteTable(
	"setup_jobs",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		job: text("job").notNull(),
		status: text("status", { enum: ["waiting", "running", "done", "skipped"] }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [primaryKey({ columns: [t.householdId, t.job] })],
);

/**
 * A Household's merchant names the model settled, by the raw statement text it named, so each raw
 * string goes to the model once (merchant-run.ts). Per Household, never shared: a raw line can
 * carry a person's name (a Zelle or Venmo payee). Names the normaliser settles alone aren't kept.
 */
export const merchantNames = sqliteTable(
	"merchant_names",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		raw: text("raw").notNull(),
		name: text("name").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [primaryKey({ columns: [t.householdId, t.raw] })],
);

// A Suggestion (ADR-0027): something background AI spotted in spending that a Parent can add with
// one tap: a new Bucket, a new Commitment, a Commitment's new amount (and later a Rule). `key` says
// what it's about, with its owner (one row per Household and key); `payload` holds the terms to add, and
// `evidence` what it rests on (charges, the amount, months, the Transactions). A dismissed or
// accepted one comes back only when its evidence changes a lot (changedALot in @noodle/domain).
// `member_id` is set for one resting on a Parent's own Personal Allowance: only they ever read it
// (ADR-0003); null is the Household's.
export const suggestions = sqliteTable(
	"suggestions",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		memberId: text("member_id").references(() => members.id),
		kind: text("kind", {
			enum: ["new-bucket", "new-commitment", "commitment-amount", "rule"],
		}).notNull(),
		key: text("key").notNull(),
		status: text("status", { enum: ["open", "accepted", "dismissed"] })
			.notNull()
			.default("open"),
		payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
		evidence: text("evidence", { mode: "json" })
			.$type<{ count: number; amountCents: number; months: number; transactionIds: string[] }>()
			.notNull(),
		fingerprint: text("fingerprint").notNull(),
		decidedByMemberId: text("decided_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [uniqueIndex("suggestions_household_key_idx").on(t.householdId, t.key)],
);

// Merchants the Household's merchant index on Vectorize has learned (#63), by merchantKey, so a
// fresh start can delete exactly this Household's vectors (their IDs are made from the Household
// and the merchant, see categorize-model.ts). Recorded from #63 on; for older ones a fresh start
// also derives the merchants from the Household's Transactions.
export const merchantVectors = sqliteTable(
	"merchant_vectors",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		merchant: text("merchant").notNull(),
	},
	(t) => [primaryKey({ columns: [t.householdId, t.merchant] })],
);

// A fresh start or Delete Household a Parent asked for (#63, ADR-0029): when it runs (after the
// grace period), how far the Fresh start Workflow has got, and who cancelled it. No foreign key,
// like bank_link_sessions: Delete Household removes the household row it would point at, and this
// row last of all. A fresh start keeps it, so the screen can say "All cleared".
export const freshStarts = sqliteTable(
	"fresh_starts",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id").notNull(),
		level: text("level", { enum: ["fresh-start", "delete"] }).notNull(),
		requestedBy: text("requested_by").notNull(),
		runAt: integer("run_at", { mode: "timestamp_ms" }).notNull(),
		// `failed`: a step used up its retries (issue 118); Try again takes it back to running.
		status: text("status", {
			enum: ["scheduled", "running", "failed", "done", "cancelled"],
		}).notNull(),
		step: integer("step").notNull().default(0),
		steps: integer("steps").notNull().default(0),
		label: text("label"),
		cancelledBy: text("cancelled_by"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
		// Issue 118, all nullable. The Workflow instance carrying the request (null: the first,
		// whose id is the request's own); when it last began a step; the step that used up its
		// retries and when; the other Parent who said "Start it now"; and Delete Household's
		// "Also delete the last snapshot", so a later run knows it too.
		runId: text("run_id"),
		progressAt: integer("progress_at", { mode: "timestamp_ms" }),
		failedStep: text("failed_step"),
		failedAt: integer("failed_at", { mode: "timestamp_ms" }),
		agreedBy: text("agreed_by"),
		deleteBackups: integer("delete_backups", { mode: "boolean" }),
	},
	(t) => [index("fresh_starts_household_idx").on(t.householdId, t.createdAt)],
);

// A Household snapshot (#78, ADR-0035): one Household's rows from every household-scoped table,
// gzipped JSON in noodle-backups at `key`. This row is what the history shows (kind, who, when,
// the note, size, the migration it fits and rows per table); the contents are never shown.
// `taken_by` is the Parent who took one by hand, or who asked for the action it came before.
export const householdSnapshots = sqliteTable(
	"household_snapshots",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id").notNull(),
		kind: text("kind", {
			// No CHECK in the database: a new kind needs no migration (ADR-0035).
			enum: [
				"nightly",
				"manual",
				"before-restore",
				"before-fresh-start",
				"before-delete",
				"before-rule-apply",
				"before-transactions-delete",
			],
		}).notNull(),
		takenBy: text("taken_by"),
		note: text("note"),
		key: text("key").notNull(),
		bytes: integer("bytes").notNull(),
		format: integer("format").notNull(),
		migration: text("migration"),
		rowCounts: text("row_counts", { mode: "json" }).$type<Record<string, number>>().notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(t) => [index("household_snapshots_household_idx").on(t.householdId, t.createdAt)],
);

export type HouseholdSnapshot = typeof householdSnapshots.$inferSelect;

// Owed back (ADR-0058): the part of a purchase someone outside the Household's pool of money has
// said they'll pay back, and who. The person is a name, not a Member; when a Child was chosen,
// `member_id` says which and `who` is their name as it was then. One per purchase, or per Split
// (`split_id`, no foreign key: Splits are rewritten whenever a Transaction is split again, and an
// item whose Split is gone restores the purchase's largest Split instead). What has been Paid
// back is the sum of its `paid_back_matches`. Taking it off deletes the row and its matches.
export const owedBack = sqliteTable(
	"owed_back",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		transactionId: text("transaction_id")
			.notNull()
			.references(() => transactions.id),
		splitId: text("split_id"),
		who: text("who").notNull(),
		memberId: text("member_id").references(() => members.id),
		amountCents: integer("amount_cents").notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		index("owed_back_household_idx").on(t.householdId),
		uniqueIndex("owed_back_one_per_purchase").on(t.transactionId, sql`coalesce(${t.splitId}, '')`),
	],
);

// Part of a Paid back money-in line (`income.id`, kind 'paid-back') put against one Owed back
// item, once a Parent confirmed it. It counts as spending in reverse on `counts_on` (the day the
// money arrived, or the first day of the month it was confirmed in when that month had ended),
// restoring the purchase's Bucket or Commitment (counting.ts). What a line has beyond its matches
// is "Paid back, not matched yet". Deleted when the line stops being Paid back.
export const paidBackMatches = sqliteTable(
	"paid_back_matches",
	{
		id: text("id").primaryKey(),
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		incomeId: text("income_id")
			.notNull()
			.references(() => income.id),
		owedBackId: text("owed_back_id")
			.notNull()
			.references(() => owedBack.id),
		amountCents: integer("amount_cents").notNull(),
		countsOn: text("counts_on").notNull(),
		createdByMemberId: text("created_by_member_id").references(() => members.id),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(t) => [
		index("paid_back_matches_household_idx").on(t.householdId),
		index("paid_back_matches_income_idx").on(t.incomeId),
		index("paid_back_matches_owed_back_idx").on(t.owedBackId),
	],
);

// A one-time pass over a Household's rows that has run (money-in-pass.ts): the row is what stops
// it running twice. Kept through a fresh start and left out of snapshots, so neither runs it again.
export const householdPasses = sqliteTable(
	"household_passes",
	{
		householdId: text("household_id")
			.notNull()
			.references(() => households.id),
		pass: text("pass").notNull(),
		// The run that wrote the row: only that run changes anything.
		runId: text("run_id").notNull(),
		// The snapshot taken first; null when the pass found nothing to change.
		snapshotId: text("snapshot_id"),
		changed: integer("changed").notNull().default(0),
		ranAt: integer("ran_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
	},
	(t) => [primaryKey({ columns: [t.householdId, t.pass] })],
);
