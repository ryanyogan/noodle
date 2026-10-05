/**
 * The whole story in one place: the eight storyboard scenes, what each one shows and when, the
 * words on screen and the narration. The scenes, `out/intro.vtt` and `script.md` are all made from
 * this (`bun run captions` writes the last two). Times are seconds from the start.
 *
 * Words follow ADR-0018 (plain words) and use CONTEXT.md's terms as it spells them.
 */
import type { StillName } from "./footage";

export const FPS = 30;
export const SECONDS = 60;
export const FRAMES = FPS * SECONDS;

export type SceneId =
	| "hook"
	| "plan"
	| "this-month"
	| "with-plaid"
	| "without-plaid"
	| "goals-explore"
	| "get-the-most"
	| "end";

/** Words on screen for a stretch of time, and one cue in the captions file. */
export type Cue = {
	from: number;
	to: number;
	text: string;
	/** Drawn by the scene itself as its headline (Hook, End card) instead of in the caption line. */
	headline?: boolean;
};

/** What fills the frame for a stretch of a scene: a still from the app, or the Bucket bar drawn in code. */
export type Shot =
	| { kind: "still"; from: number; to: number; still: StillName; ring?: boolean }
	| { kind: "bucket"; from: number; to: number };

export type Scene = {
	id: SceneId;
	title: string;
	from: number;
	to: number;
	cues: Cue[];
	/** Empty for the scenes drawn wholly in code (Hook, The Plan, End card). */
	shots: Shot[];
	narration: string;
};

export const APP_URL = "noodle.yogan.dev";

export const SCENES: Scene[] = [
	{
		id: "hook",
		title: "Hook",
		from: 0,
		to: 5,
		cues: [{ from: 0, to: 5, text: "Know what you can spend, every day.", headline: true }],
		shots: [],
		narration: "Noodle. Know what you can spend, every day.",
	},
	{
		id: "plan",
		title: "The Plan",
		from: 5,
		to: 13,
		cues: [
			{ from: 5, to: 8.5, text: "Your Plan starts with your Take-home pay." },
			{
				from: 8.5,
				to: 13,
				text: "Take out Commitments, Buckets and Goals.\nWhat's left is Free to Spend.",
			},
		],
		shots: [],
		narration:
			"It starts with a Plan. Your Take-home pay goes to Commitments like rent, Buckets like groceries, and Goals. What's left is Free to Spend.",
	},
	{
		id: "this-month",
		title: "This Month",
		from: 13,
		to: 22,
		cues: [
			{ from: 13, to: 17, text: "This Month puts Free to Spend first." },
			{
				from: 17,
				to: 22,
				text: "A Bucket's bar fills as you spend. The line is Pace:\nwhere you'd be if you spent evenly.",
			},
		],
		shots: [
			{ kind: "still", from: 13, to: 17, still: "month", ring: true },
			{ kind: "still", from: 17, to: 19, still: "month-bucket", ring: true },
			{ kind: "bucket", from: 19, to: 22 },
		],
		narration:
			"This Month puts Free to Spend first. Each Bucket's bar fills as you spend, and the Pace line shows where you'd be if you spent evenly.",
	},
	{
		id: "with-plaid",
		title: "With Plaid",
		from: 22,
		to: 32,
		cues: [
			{ from: 22, to: 25.5, text: "Connect a bank, and Transactions arrive by themselves." },
			{
				from: 25.5,
				to: 29,
				text: "Noodle files them for you.\nReview asks only about the ones it isn't sure of.",
			},
			{ from: 29, to: 32, text: "“Always file Costco in Groceries” makes a Rule." },
		],
		shots: [
			{ kind: "still", from: 22, to: 24, still: "accounts-bank", ring: true },
			{ kind: "still", from: 24, to: 25.5, still: "transactions" },
			{ kind: "still", from: 25.5, to: 29, still: "review", ring: true },
			{ kind: "still", from: 29, to: 32, still: "review-rule", ring: true },
		],
		narration:
			"Connect a bank, and Transactions arrive by themselves. Noodle files them, and Review asks only about the ones it isn't sure of. Choose “Always file Costco in Groceries” and that's a Rule.",
	},
	{
		id: "without-plaid",
		title: "Without Plaid",
		from: 32,
		to: 42,
		cues: [
			{
				from: 32,
				to: 35.5,
				text: "No bank connected? Use Quick Add:\npress Q on a computer, or tap + on a phone.",
			},
			{ from: 35.5, to: 39, text: "Or upload a statement, or forward a receipt by email." },
			{ from: 39, to: 42, text: "Same Plan, a bit more typing." },
		],
		shots: [
			{ kind: "still", from: 32, to: 35.5, still: "quick-add", ring: true },
			{ kind: "still", from: 35.5, to: 39, still: "import-statement", ring: true },
			{ kind: "still", from: 39, to: 42, still: "plan-overview", ring: true },
		],
		narration:
			"No bank connected? Quick Add takes a few seconds. You can also upload a statement, or forward a receipt by email. It's the same Plan, with a bit more typing.",
	},
	{
		id: "goals-explore",
		title: "Goals and Explore",
		from: 42,
		to: 50,
		cues: [
			{ from: 42, to: 46, text: "Set money aside for a Goal, or pay off a card or loan." },
			{ from: 46, to: 50, text: "Explore answers “Can we afford it?” before you spend." },
		],
		shots: [
			{ kind: "still", from: 42, to: 44, still: "goals" },
			{ kind: "still", from: 44, to: 46, still: "goal", ring: true },
			{ kind: "still", from: 46, to: 50, still: "explore-afford", ring: true },
		],
		narration:
			"Set money aside for a Goal, or pay off a card or loan. Before a big purchase, Explore answers “Can we afford it?”",
	},
	{
		id: "get-the-most",
		title: "Get the most from it",
		from: 50,
		to: 58,
		cues: [
			{ from: 50, to: 53, text: "A few minutes each week: the Check-in." },
			{ from: 53, to: 55.5, text: "Close the month and Sweep what's left into a Goal." },
			{ from: 55.5, to: 58, text: "Invite the other Parent to share the Plan." },
		],
		shots: [
			{ kind: "still", from: 50, to: 53, still: "check-in", ring: true },
			{ kind: "still", from: 53, to: 55.5, still: "close-month", ring: true },
			{ kind: "still", from: 55.5, to: 58, still: "household-invite", ring: true },
		],
		narration:
			"Take a few minutes each week for the Check-in. Close the month and Sweep what's left into a Goal. And invite the other Parent.",
	},
	{
		id: "end",
		title: "End card",
		from: 58,
		to: 60,
		cues: [{ from: 58, to: 60, text: "Start your Plan", headline: true }],
		shots: [],
		narration: "Start your Plan.",
	},
];

export const CUES: Cue[] = SCENES.flatMap((scene) => scene.cues);

export function scene(id: SceneId): Scene {
	const found = SCENES.find((each) => each.id === id);
	if (!found) throw new Error(`No scene called ${id}`);
	return found;
}

/** The scene's headline: the cue it draws itself. */
export function headline(id: SceneId): string {
	const cue = scene(id).cues.find((each) => each.headline);
	if (!cue) throw new Error(`Scene ${id} has no headline`);
	return cue.text;
}

export function frames(seconds: number): number {
	return Math.round(seconds * FPS);
}

/** The Plan the waterfall draws, in dollars. The steps take the Take-home pay down to Free to Spend. */
export const PLAN = {
	takeHomePay: 6400,
	steps: [
		{ label: "Commitments", amount: 3100 },
		{ label: "Buckets", amount: 1650 },
		{ label: "Goals", amount: 600 },
	],
	freeToSpend: 1050,
} as const;

/**
 * The Bucket the bar is drawn for, in dollars: the Groceries row of the `month-bucket` still, whose
 * spending the capture writes at `ofPace` of Pace (CALM_MONTH in video-capture.spec.ts).
 */
export const BUCKET = { name: "Groceries", available: 1100, ofPace: 0.9 } as const;

/** The drawn bar on `day`, the day the stills were taken: Pace is the share of the month gone by. */
export function bucketOn(day: Date) {
	const pace = day.getDate() / new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
	return { ...BUCKET, pace, spent: BUCKET.available * pace * BUCKET.ofPace };
}
