// The background AI pipeline's coalescer (ADR-0027), apart from the Durable Object so unit tests can
// run it with a fake storage and clock. Each Household's Agent holds one: writes anywhere in the app
// send it a small event (queueAi), it waits a short window for the burst to settle, then runs once
// for everything that changed. One run at a time per Household; events that arrive during a run
// fold into the next one. It holds IDs only, never merchants or amounts.

/** What happened that background AI may need to look at. */
export const AI_EVENT_KINDS = [
	/** Transactions arrived in an Import (statement upload, bank sync); `ids` are Import IDs. */
	"imported",
	/** A Quick Add or forwarded receipt was captured; `ids` are Transaction IDs. */
	"captured",
	/** A Bucket was added, renamed or archived. */
	"buckets-changed",
	/** A Rule was added or changed. */
	"rule-added",
	/** A Commitment was added, changed or ended (for later steps; nothing to file). */
	"commitment-changed",
	/** A Parent filed or corrected a Transaction by hand (a learning signal for later steps). */
	"filed-by-hand",
	/** A month started; `ids` is the month, so each Household's is taken once. */
	"month-started",
	/** Imported lines are still to be named (the nightly backfill, or a run that ran out of room). */
	"backfill-merchants",
] as const;

export type AiEventKind = (typeof AI_EVENT_KINDS)[number];

/** `memberId` is the Parent who did it: what's filed is filed in their view only (ADR-0003). */
export type AiEvent = { householdId: string; kind: AiEventKind; memberId?: string; ids?: string[] };

/** Something to file for one Parent: an Import or a captured Transaction. */
export type AiWork = { memberId: string; id: string };

/** Everything one run covers. */
export type AiBatch = {
	householdId: string;
	imports: AiWork[];
	captures: AiWork[];
	/** Look again at what waits in Review, for every Parent in their own view. */
	lookAgain: boolean;
	/** How many of each event this run covers, for the logs and later steps. */
	events: Partial<Record<AiEventKind, number>>;
	/** Runs of this batch that already failed. */
	attempt: number;
};

export type CoalesceConfig = {
	/** How long to wait after the latest event for more. */
	windowMs: number;
	/** The same while a big batch is building (a bank sync's or Setup's many Imports). */
	busyWindowMs: number;
	/** Never wait longer than this after the first event, however busy. */
	maxWaitMs: number;
	/** Tries before giving up quietly; what wasn't filed stays where it was (Review or unfiled). */
	attempts: number;
	/** Wait before a retry, times the attempt. */
	retryMs: number;
	/** Imports plus captures that count as a big batch. */
	bigBatch: number;
};

export const COALESCE: CoalesceConfig = {
	windowMs: 60_000,
	busyWindowMs: 180_000,
	maxWaitMs: 600_000,
	attempts: 3,
	retryMs: 60_000,
	bigBatch: 5,
};

/** Under AI_MODEL=stub (dev and E2E): the same, in about a second. */
export const STUB_COALESCE: CoalesceConfig = {
	windowMs: 300,
	busyWindowMs: 1_000,
	maxWaitMs: 3_000,
	attempts: 3,
	retryMs: 500,
	bigBatch: 5,
};

/** Changes that may give what waits in Review a better home. */
const LOOK_AGAIN: ReadonlySet<AiEventKind> = new Set([
	"buckets-changed",
	"rule-added",
	"month-started",
]);

const emptyBatch = (householdId: string): AiBatch => ({
	householdId,
	imports: [],
	captures: [],
	lookAgain: false,
	events: {},
	attempt: 0,
});

const union = (a: AiWork[], b: AiWork[]) => {
	const seen = new Set(a.map((work) => `${work.memberId}/${work.id}`));
	return [...a, ...b.filter((work) => !seen.has(`${work.memberId}/${work.id}`))];
};

/** Adds an event to a batch. */
export function foldEvent(batch: AiBatch, event: AiEvent): AiBatch {
	const { memberId, ids = [] } = event;
	const work = memberId ? ids.map((id) => ({ memberId, id })) : [];
	return {
		...batch,
		imports: event.kind === "imported" ? union(batch.imports, work) : batch.imports,
		captures: event.kind === "captured" ? union(batch.captures, work) : batch.captures,
		lookAgain: batch.lookAgain || LOOK_AGAIN.has(event.kind),
		events: { ...batch.events, [event.kind]: (batch.events[event.kind] ?? 0) + 1 },
	};
}

/** Two batches as one. */
export function mergeBatches(a: AiBatch, b: AiBatch): AiBatch {
	const events = { ...a.events };
	for (const [kind, count] of Object.entries(b.events) as [AiEventKind, number][]) {
		events[kind] = (events[kind] ?? 0) + count;
	}
	return {
		householdId: a.householdId,
		imports: union(a.imports, b.imports),
		captures: union(a.captures, b.captures),
		lookAgain: a.lookAgain || b.lookAgain,
		events,
		attempt: Math.max(a.attempt, b.attempt),
	};
}

/** The part of DurableObjectStorage the coalescer uses. */
export type CoalescerStorage = {
	kv: {
		get<T>(key: string): T | undefined;
		put<T>(key: string, value: T): void;
		delete(key: string): boolean;
	};
	getAlarm(): Promise<number | null>;
	setAlarm(time: number): Promise<void>;
};

type Held = { batch: AiBatch; firstAt: number; dueAt: number };

const HELD_KEY = "ai:held";
const MONTH_KEY = "ai:month";

export type RunOutcome = "idle" | "waiting" | "busy" | "ran" | "retrying" | "gave-up";

export class AiCoalescer {
	private running = false;

	constructor(
		private readonly storage: CoalescerStorage,
		private readonly config: CoalesceConfig = COALESCE,
		private readonly now: () => number = Date.now,
	) {}

	private held(): Held | undefined {
		return this.storage.kv.get<Held>(HELD_KEY);
	}

	/** When the next run is due, if anything waits. */
	nextDue(): number | null {
		return this.held()?.dueAt ?? null;
	}

	/** Makes sure the Agent's alarm (shared with Nudges) wakes it by the next run. */
	async wake(): Promise<void> {
		const due = this.nextDue();
		if (due === null) return;
		const alarm = await this.storage.getAlarm();
		// One in the past is the alarm running now, spent once it returns.
		if (alarm === null || alarm > due || alarm <= this.now()) await this.storage.setAlarm(due);
	}

	/** Holds an event for the next run, and pushes the run back a little while events keep coming. */
	async queue(event: AiEvent): Promise<void> {
		const { kv } = this.storage;
		if (event.kind === "month-started") {
			const month = event.ids?.[0];
			if (month !== undefined && kv.get<string>(MONTH_KEY) === month) return;
			if (month !== undefined) kv.put(MONTH_KEY, month);
		}
		const time = this.now();
		const held = this.held();
		const batch = foldEvent(held?.batch ?? emptyBatch(event.householdId), event);
		const firstAt = held?.firstAt ?? time;
		const big = batch.imports.length + batch.captures.length >= this.config.bigBatch;
		const wait = big ? this.config.busyWindowMs : this.config.windowMs;
		const dueAt = Math.min(
			firstAt + this.config.maxWaitMs,
			Math.max(held?.dueAt ?? 0, time + wait),
		);
		kv.put<Held>(HELD_KEY, { batch, firstAt, dueAt });
		await this.wake();
	}

	/**
	 * Runs the held batch once it's due. Never throws: a failed run is held again to retry after a
	 * wait, and after `attempts` tries it's dropped quietly. Logs never name merchants (ADR-0021).
	 */
	async run(runner: (batch: AiBatch) => Promise<unknown>): Promise<RunOutcome> {
		if (this.running) return "busy";
		const held = this.held();
		if (!held) return "idle";
		const time = this.now();
		if (time < held.dueAt) {
			await this.wake();
			return "waiting";
		}
		// Taken now, so events that arrive while it runs fold into the next run.
		this.storage.kv.delete(HELD_KEY);
		this.running = true;
		let outcome: RunOutcome = "ran";
		try {
			await runner(held.batch);
		} catch (error) {
			const attempt = held.batch.attempt + 1;
			// The error's name only: a failed query's message can carry a statement line.
			const what = error instanceof Error ? error.name : "unknown error";
			if (attempt >= this.config.attempts) {
				console.warn(
					`Gave up on background AI for ${held.batch.householdId} after ${attempt} tries (${what})`,
				);
				outcome = "gave-up";
			} else {
				console.warn(`Background AI for ${held.batch.householdId} failed (${what}); trying again`);
				const later = this.held();
				const failed = { ...held.batch, attempt };
				this.storage.kv.put<Held>(HELD_KEY, {
					batch: later ? mergeBatches(later.batch, failed) : failed,
					firstAt: later?.firstAt ?? time,
					dueAt: Math.max(later?.dueAt ?? 0, this.now() + this.config.retryMs * attempt),
				});
				outcome = "retrying";
			}
		} finally {
			this.running = false;
		}
		await this.wake();
		return outcome;
	}
}
