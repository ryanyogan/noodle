/**
 * The words a Parent meets in the app, in plain language (ADR-0018). Each term's help popover
 * shows `short`; the Glossary page shows every entry, with `more` and the word it replaced.
 * Keep these in step with CONTEXT.md.
 */
export type GlossaryEntry = {
	term: string;
	short: string;
	more?: string;
	/** The word the app used before ADR-0018, so a Parent who learned it can find the new one. */
	was?: string;
};

export const glossary = {
	"take-home-pay": {
		term: "Take-home pay",
		short:
			"Your usual monthly pay after taxes and deductions: what lands in your account. The Plan divides it up.",
		more: "If someone’s pay varies, enter the amount you can count on: the lowest it usually is. A month that brings in more shows the difference as Extra income, to add to Free to Spend or send to a Goal. If pay changes for good, change your take-home pay on Plan › Income.",
		was: "Baseline",
	},
	"free-to-spend": {
		term: "Free to Spend",
		short:
			"Take-home pay that isn’t planned for a Commitment, a Bucket or a Goal yet. It’s yours to spend or to plan.",
		more: "Plan more for something and it goes down. Below zero means the Plan promises more than comes in.",
	},
	commitment: {
		term: "Commitment",
		short:
			"A bill you expect every time, like the mortgage, insurance, daycare or a subscription: monthly, every two weeks, or once a year.",
	},
	"lumpy-month": {
		term: "Lumpy month",
		short:
			"A month with less Free to Spend because a yearly bill is due, or a bill paid every two weeks comes three times.",
	},
	bucket: {
		term: "Bucket",
		short:
			"A monthly allowance for spending that varies, like groceries, gas or fun. It shows how much is left.",
		more: "Each Bucket either resets monthly or carries over.",
	},
	"resets-monthly": {
		term: "Resets monthly",
		short:
			"A Bucket that starts each month at its allowance. What’s left when the month ends can go to a Goal.",
		more: "New Buckets reset monthly unless you choose otherwise.",
		was: "Fresh-start",
	},
	"carries-over": {
		term: "Carries over",
		short:
			"A Bucket whose leftover carries into next month, and whose overspending comes out of next month.",
		more: "Good for spending that comes in bursts, like clothes or car repairs.",
		was: "Rolling",
	},
	"personal-allowance": {
		term: "Personal Allowance",
		short:
			"A Bucket of one Parent’s own. The other Parent sees only how much went, never what it went on.",
	},
	pace: {
		term: "Pace",
		short:
			"Where a Bucket’s spending would be by today if you spent it evenly across the month. The line on each bar marks it.",
		more: "Ahead of pace means it’s being spent faster than the month is going.",
	},
	cover: {
		term: "Cover",
		short:
			"Bringing an overspent Bucket back to $0 with money from another Bucket or from Free to Spend, in the same month.",
	},
	goal: {
		term: "Goal",
		short:
			"Something you’re saving for, with a target amount and maybe a date: an emergency fund, a trip, a new roof. A Goal can also pay off a credit card or loan.",
	},
	"payoff-goal": {
		term: "Paying off a card or loan",
		short:
			"A Goal to get a credit card or loan down to $0. It starts from what’s owed today; as the balance comes down, so does what’s left to pay. Each month you plan extra payments from Free to Spend.",
		more: "Your regular payment stays a Commitment; the Goal is extra, on top. The card’s payment (from checking) shows once the card’s balance does: when the bank brings it in, you update it, or you use a statement’s. New charges take the balance back up, and the Goal shows it. At $0 it’s paid off, and you complete it.",
	},
	"set-aside": {
		term: "Set aside",
		short:
			"Money in a real Account that a Goal is keeping. It stays in the Account; Noodle marks it as the Goal’s.",
		more: "Planning money for a Goal each month adds to what’s set aside. Setting aside money the Account already has, or releasing it, doesn’t change the Plan.",
		was: "Earmark",
	},
	"not-set-aside": {
		term: "Not set aside",
		short: "Money in an Account that no Goal is keeping. New Goals can set aside from it.",
		was: "Unclaimed",
	},
	"extra-income": {
		term: "Extra income",
		short:
			"Pay above your take-home pay in a month, like a bigger paycheck, a third paycheck or a bonus. You decide where it goes: add it to Free to Spend, or send it to a Goal or a Bucket.",
		was: "Windfall",
	},
	sweep: {
		term: "Sweep",
		short: "When a month ends, moving what’s left in a Bucket that resets monthly into a Goal.",
	},
	"month-close": {
		term: "Closing a month",
		short:
			"After a month ends, deciding where its leftovers and Extra income go. If nobody does in the first week, Noodle uses the suggestions.",
		more: "The app says “Close August”, and afterwards shows how August ended.",
	},
	review: {
		term: "Review",
		short:
			"Spending Noodle wasn’t sure where to file. Confirm its suggestion or pick another, and it’s filed.",
		more: "Noodle files most spending on its own, by your Rules or by what you filed before. Only what it’s unsure about waits here.",
	},
	match: {
		term: "Match",
		short:
			"When the bank’s copy of something you Quick Added arrives, Noodle pairs them so it counts once.",
		more: "Lines a statement already brought in aren’t added again when your bank brings them in.",
	},
	"bank-connection": {
		term: "Bank Connection",
		short:
			"A login to your bank, through Plaid, that brings in balances and spending on its own every day. It only reads; it can’t move money.",
		more: "When you connect, you say which of your Accounts each bank account is, so it keeps its Goals and history and nothing counts twice.",
	},
	pending: {
		term: "Pending",
		short:
			"Spending the bank has reported but not finished. It counts now, but the amount may still change.",
	},
	change: {
		term: "Change",
		short:
			"One thing you try in Explore, like a raise, a new bill or a smaller allowance. Nothing in the real Plan changes until you apply it.",
		was: "Lever",
	},
	"projected-balance": {
		term: "Projected balance",
		short:
			"What you’d have left, month by month, if you spend what’s planned, starting from $0 today. Below zero, the Plan doesn’t hold up.",
		was: "Cushion",
	},
	"perk-source": {
		term: "Perk Source",
		short:
			"A phone plan, card, membership or insurance policy whose benefits Noodle reads, so you don’t pay twice for something it includes.",
	},
} satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof glossary;

/** Every entry, A to Z by its term. */
export const glossaryEntries = (Object.entries(glossary) as [GlossaryId, GlossaryEntry][]).sort(
	([, a], [, b]) => a.term.localeCompare(b.term),
);
