import { describe, expect, it } from "vitest";
import {
	LINK_CLOSE_WAIT_MS,
	LINK_LOAD_WAIT_MS,
	type LinkFrame,
	type LinkTimers,
	linkRunning,
	type PlaidGlobal,
	type PlaidLinkConfig,
	runLink,
} from "./bank-link-run";

// Opening Plaid Link once and closing it for certain (#70), with a Plaid and timers a test drives.

function setUp(behaviour: { loadsAtOnce?: boolean; ignoresExit?: boolean } = {}) {
	const calls: string[] = [];
	let config: PlaidLinkConfig | null = null;
	const plaid: PlaidGlobal = {
		create: (given) => {
			config = given;
			calls.push("create");
			if (behaviour.loadsAtOnce) given.onLoad?.();
			return {
				open: () => calls.push("open"),
				exit: (options) => {
					calls.push(`exit:${options?.force === true}`);
					if (!behaviour.ignoresExit) given.onExit(null, null);
				},
				destroy: () => calls.push("destroy"),
			};
		},
	};
	let close: (() => void) | null = null;
	const frame: LinkFrame = {
		show: (given) => {
			close = given;
			calls.push("show");
		},
		hide: (closed) => calls.push(`hide:${closed}`),
	};
	const waiting = new Map<number, { run: () => void; ms: number }>();
	let next = 0;
	const timers: LinkTimers = {
		set: (run, ms) => {
			waiting.set(++next, { run, ms });
			return next;
		},
		clear: (timer) => void waiting.delete(timer as number),
	};
	/** Runs the timers set for `ms`, as if that long had passed. */
	const pass = (ms: number) => {
		for (const [id, timer] of [...waiting]) {
			if (timer.ms !== ms) continue;
			waiting.delete(id);
			timer.run();
		}
	};
	return {
		calls,
		plaid,
		frame,
		timers,
		pass,
		waiting,
		link: () => {
			if (!config) throw new Error("Link wasn't made");
			return config;
		},
		close: () => {
			if (!close) throw new Error("Link wasn't shown");
			close();
		},
	};
}

const CLOSED = { kind: "exit", error: null, institution: null };

describe("runLink", () => {
	it("opens Link once, when it says it has loaded, however often it says so", async () => {
		const t = setUp();
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		expect(t.calls).toEqual(["create"]);
		expect(t.link().token).toBe("link-1");

		t.link().onLoad?.();
		t.link().onLoad?.();
		t.pass(LINK_LOAD_WAIT_MS);
		expect(t.calls).toEqual(["create", "show", "open"]);

		t.link().onExit(null, null);
		expect(await run).toEqual(CLOSED);
		expect(t.calls).toEqual(["create", "show", "open", "destroy", "hide:true"]);
		expect(t.waiting.size).toBe(0);
		expect(linkRunning()).toBe(false);
	});

	it("opens Link when it loaded before create() returned", async () => {
		const t = setUp({ loadsAtOnce: true });
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		expect(t.calls).toEqual(["create", "show", "open"]);
		expect(t.waiting.size).toBe(0);
		t.link().onExit(null, null);
		await run;
	});

	it("opens Link anyway when it never says it has loaded", async () => {
		const t = setUp();
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		t.pass(LINK_LOAD_WAIT_MS);
		expect(t.calls).toEqual(["create", "show", "open"]);
		t.link().onLoad?.();
		expect(t.calls).toEqual(["create", "show", "open"]);
		t.link().onExit(null, null);
		await run;
	});

	it("doesn't make a second Link while one is running", async () => {
		const t = setUp();
		const first = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		expect(linkRunning()).toBe(true);
		const second = setUp();
		expect(await runLink(second.plaid, "link-2", second.frame, { timers: second.timers })).toEqual(
			CLOSED,
		);
		expect(second.calls).toEqual([]);

		t.link().onLoad?.();
		t.link().onExit(null, null);
		await first;
		// And once it has ended, the next one runs.
		const third = setUp({ loadsAtOnce: true });
		const again = runLink(third.plaid, "link-3", third.frame, { timers: third.timers });
		expect(third.calls).toEqual(["create", "show", "open"]);
		third.link().onExit(null, null);
		await again;
	});

	it("hands back the bank linked, and ends once however often Link answers", async () => {
		const t = setUp({ loadsAtOnce: true });
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		t.link().onSuccess("public-1", {
			institution: { name: " First Platypus Bank ", institution_id: "ins_1" },
			accounts: [{ mask: "0000" }, { mask: null }, { mask: "1111" }],
		});
		t.link().onExit(null, null);
		expect(await run).toEqual({
			kind: "linked",
			linked: {
				publicToken: "public-1",
				institution: "First Platypus Bank",
				institutionId: "ins_1",
				masks: ["0000", "1111"],
			},
		});
		// Choose Accounts opens next, so the focus isn't put back on the button.
		expect(t.calls).toEqual(["create", "show", "open", "destroy", "hide:false"]);
	});

	it("hands back Link's error and the bank it was for", async () => {
		const t = setUp({ loadsAtOnce: true });
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		const error = { error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" };
		t.link().onExit(error, { institution: { name: "Chase" } });
		expect(await run).toEqual({ kind: "exit", error, institution: "Chase" });
	});

	it("Noodle's Close asks Link to exit at once", async () => {
		const t = setUp({ loadsAtOnce: true });
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		t.close();
		expect(await run).toEqual(CLOSED);
		expect(t.calls).toEqual(["create", "show", "open", "exit:true", "destroy", "hide:true"]);
		expect(t.waiting.size).toBe(0);
	});

	it("Noodle's Close takes Link down when Link doesn't answer", async () => {
		const t = setUp({ loadsAtOnce: true, ignoresExit: true });
		const run = runLink(t.plaid, "link-1", t.frame, { timers: t.timers });
		t.close();
		t.close();
		expect(t.calls).toEqual(["create", "show", "open", "exit:true"]);
		expect(linkRunning()).toBe(true);
		t.pass(LINK_CLOSE_WAIT_MS);
		expect(await run).toEqual(CLOSED);
		expect(t.calls).toEqual(["create", "show", "open", "exit:true", "destroy", "hide:true"]);
		expect(linkRunning()).toBe(false);
	});

	it("passes Link's events on, and the address a bank came back to", async () => {
		const t = setUp({ loadsAtOnce: true });
		const events: string[] = [];
		const run = runLink(t.plaid, "link-1", t.frame, {
			timers: t.timers,
			receivedRedirectUri: "https://noodle.test/bank/return?oauth_state_id=1",
			onEvent: (name) => events.push(name),
		});
		expect(t.link().receivedRedirectUri).toBe("https://noodle.test/bank/return?oauth_state_id=1");
		t.link().onEvent("OPEN", {});
		t.link().onExit(null, null);
		await run;
		expect(events).toEqual(["OPEN"]);
	});

	it("is ready for another try when Link can't be made", async () => {
		const failing: PlaidGlobal = {
			create: () => {
				throw new Error("no Link");
			},
		};
		const t = setUp();
		await expect(runLink(failing, "link-1", t.frame, { timers: t.timers })).rejects.toThrow(
			"no Link",
		);
		expect(linkRunning()).toBe(false);
	});
});
