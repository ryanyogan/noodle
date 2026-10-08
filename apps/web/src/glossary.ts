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
		more: "Plan more for something and it goes down. Below zero means the Plan promises more than comes in. What a month actually ends with is carried over into the next month’s Free to Spend: money left adds to it, and a month that ended short takes from it. This Month shows the two parts, what this month adds and what was carried over.",
	},
	commitment: {
		term: "Commitment",
		short:
			"A bill you expect every time, like the mortgage, insurance, daycare or a subscription: monthly, every two weeks, or once a year.",
		more: "A Commitment can pay down a credit card or loan: choose it under “Pays down”, and each payment filed in the Commitment brings what’s owed on it down. If Noodle already sees what you buy on a card, paying it is a Transfer, not spending, so pick it only for a set payment on a balance you’re carrying. If a card paid down this way is connected later, the Plan asks under “Things to check” whether to end the Commitment or keep it for a balance you’re carrying. Once a card or loan is chosen, the form offers an amount from your last three months of payments to it. A bill that varies, like power or water, can be set to “About”: Noodle shows the average of its charges over the last year and how far they range, and what a month comes in over or under comes out of, or adds to, what carries to the next month. The list of your Commitments is called “Bills”.",
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
	"card-payment": {
		term: "Paying the card",
		short:
			"Paying a credit card from checking is a Transfer: money moving between your own Accounts. It isn’t spending, so it goes in no Bucket.",
		more: "What you bought on the card was filed in your Buckets when you bought it, so the payment in a Bucket would count it twice. When checking and the card are both in Noodle, the two sides are paired on their own. When only one is, say so in Review: “It’s a card payment”. If the card isn’t in Noodle, what’s bought on it isn’t counted anywhere until you connect or add it in Accounts. Paying down a balance from before your Plan? Make its regular payment a Commitment and file the payment there; a Goal to pay it off is for anything extra.",
	},
	"between-us": {
		term: "Between us",
		short: "Money one of you sent the other. It isn’t Income and it isn’t spending.",
		more: "A Transfer is money between your own Accounts, like checking to savings; this is money between the two of you. When one of you sends the other money (Zelle, Venmo, a bank transfer) the Household has gained and lost nothing. If only one of your Accounts is in Noodle, that side would look like Income coming in or spending going out, so say “It’s between us” on it: in the Income list’s actions for money in, on its card in Review or in a Transaction’s details for money out. Noodle never decides this on its own, and you can undo it. If the money then paid a bill from an Account Noodle doesn’t follow, that bill isn’t counted anywhere until you add it.",
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
			"After a month ends, deciding where its leftovers and Extra income go, and whether what is left in Free to Spend stays there, carried over, or goes to a Goal. If nobody does within a week, Noodle uses the suggestions and Free to Spend stays carried over.",
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
