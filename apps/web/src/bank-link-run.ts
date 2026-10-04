// Opening Plaid Link once and closing it for certain (#70), apart from the browser so tests can
// run it. Link draws itself in Plaid's own frame over the whole window and has no way to be put
// inside an element of ours, so what's ours is around it: Link is opened only when it says it has
// loaded (no half-drawn frame), only once however often that's said, and only one at a time; and
// Noodle's own Close (the bar above Link on a phone, Back, Escape) asks Link to exit and, if Link
// doesn't answer, takes it down anyway, so a Parent is never left behind a frame they can't close.
import type { LinkError } from "./bank-link";

/** The bank a Parent linked in Plaid Link, with Link's one-time public token for it. */
export type LinkedBankToken = {
	publicToken: string;
	institutionId: string | null;
	institution: string | null;
	masks: string[];
};

/** How Link ended: with a bank linked, or closed (with Plaid's error when something went wrong). */
export type LinkOutcome =
	| { kind: "linked"; linked: LinkedBankToken }
	| { kind: "exit"; error: LinkError | null; institution: string | null };

export type PlaidInstitution = { name?: string | null; institution_id?: string | null } | null;
export type PlaidEventMetadata = {
	link_session_id?: string | null;
	request_id?: string | null;
	error_type?: string | null;
	error_code?: string | null;
	exit_status?: string | null;
	view_name?: string | null;
	institution_id?: string | null;
};
export type PlaidLinkHandler = {
	open: () => void;
	exit: (options?: { force?: boolean }) => void;
	destroy: () => void;
};
export type PlaidLinkConfig = {
	token: string;
	receivedRedirectUri?: string;
	onLoad?: () => void;
	onSuccess: (
		publicToken: string,
		metadata: { institution?: PlaidInstitution; accounts?: { mask?: string | null }[] | null },
	) => void;
	onExit: (error: LinkError | null, metadata: { institution?: PlaidInstitution } | null) => void;
	onEvent: (eventName: string, metadata: PlaidEventMetadata) => void;
};
export type PlaidGlobal = { create: (config: PlaidLinkConfig) => PlaidLinkHandler };

/** What Noodle puts around Link while it's open, and takes away after (bank-link-frame.ts). */
export type LinkFrame = {
	/** Link is about to open; `close` is Noodle's own way out of it. */
	show: (close: () => void) => void;
	/** Link is gone. `closed` is true when nothing was linked, so the Parent is back where they were. */
	hide: (closed: boolean) => void;
};

export type LinkTimers = {
	set: (run: () => void, ms: number) => unknown;
	clear: (timer: unknown) => void;
};

const browserTimers: LinkTimers = {
	set: (run, ms) => globalThis.setTimeout(run, ms),
	clear: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** How long to wait for Link to say it has loaded before opening it anyway. */
export const LINK_LOAD_WAIT_MS = 4000;
/** How long Link has to answer Noodle's Close before it's taken down regardless. */
export const LINK_CLOSE_WAIT_MS = 1500;

const CLOSED: LinkOutcome = { kind: "exit", error: null, institution: null };

let running = false;

/** True while a Link is loading or open: a second one isn't started over it. */
export const linkRunning = () => running;

export type RunLinkOptions = {
	receivedRedirectUri?: string;
	onEvent?: (eventName: string, metadata: PlaidEventMetadata) => void;
	timers?: LinkTimers;
};

/**
 * Makes Link with the link token, opens it once when it has loaded, and says how it ended. Asked
 * again while one is running, it answers "closed" without making another.
 */
export function runLink(
	plaid: PlaidGlobal,
	token: string,
	frame: LinkFrame,
	options: RunLinkOptions = {},
): Promise<LinkOutcome> {
	if (running) return Promise.resolve(CLOSED);
	running = true;
	const timers = options.timers ?? browserTimers;
	return new Promise<LinkOutcome>((resolve, reject) => {
		let handler: PlaidLinkHandler | null = null;
		let loadedEarly = false;
		let opened = false;
		let done = false;
		let loadTimer: unknown = null;
		let closeTimer: unknown = null;

		const finish = (outcome: LinkOutcome) => {
			if (done) return;
			done = true;
			if (loadTimer !== null) timers.clear(loadTimer);
			if (closeTimer !== null) timers.clear(closeTimer);
			try {
				handler?.destroy();
			} catch {
				// Link was gone already.
			}
			if (opened) frame.hide(outcome.kind === "exit");
			running = false;
			resolve(outcome);
		};

		const open = () => {
			if (!handler) {
				// Link said it had loaded before create() returned.
				loadedEarly = true;
				return;
			}
			if (opened || done) return;
			opened = true;
			frame.show(close);
			try {
				handler.open();
			} catch (error) {
				done = true;
				if (loadTimer !== null) timers.clear(loadTimer);
				frame.hide(true);
				running = false;
				reject(error);
			}
		};

		const close = () => {
			if (done || closeTimer !== null) return;
			if (!opened || !handler) {
				finish(CLOSED);
				return;
			}
			try {
				handler.exit({ force: true });
			} catch {
				finish(CLOSED);
				return;
			}
			// Link answers with onExit; if it doesn't, it comes down anyway.
			if (!done) closeTimer = timers.set(() => finish(CLOSED), LINK_CLOSE_WAIT_MS);
		};

		try {
			handler = plaid.create({
				token,
				...(options.receivedRedirectUri
					? { receivedRedirectUri: options.receivedRedirectUri }
					: {}),
				onLoad: open,
				onSuccess: (publicToken, metadata) =>
					finish({
						kind: "linked",
						linked: {
							publicToken,
							institution: metadata?.institution?.name?.trim() || null,
							institutionId: metadata?.institution?.institution_id || null,
							masks: (metadata?.accounts ?? []).flatMap((a) => (a.mask ? [a.mask] : [])),
						},
					}),
				onExit: (error, metadata) =>
					finish({
						kind: "exit",
						error: error ?? null,
						institution: metadata?.institution?.name?.trim() || null,
					}),
				onEvent: (eventName, metadata) => options.onEvent?.(eventName, metadata ?? {}),
			});
		} catch (error) {
			running = false;
			reject(error);
			return;
		}
		if (loadedEarly) open();
		else loadTimer = timers.set(open, LINK_LOAD_WAIT_MS);
	});
}
