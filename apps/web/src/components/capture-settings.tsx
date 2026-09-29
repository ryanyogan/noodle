import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Copy, Smartphone } from "lucide-react";
import { type ReactNode, useState } from "react";
import { CAPTURE_PATH } from "../capture-path";
import { fullDay } from "../format";
import { captureTokenQuery } from "../queries";
import { createCaptureToken, revokeCaptureToken } from "../server/capture-tokens";
import { Confirm } from "./plan-editing";

/**
 * The viewer's own tap to capture: an iPhone Shortcut that records a Quick Add as them each time
 * they pay with Wallet, using their capture token. The token is shown once, when it's made.
 */
export function CaptureSettings() {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const { createdOn } = useSuspenseQuery(captureTokenQuery()).data;
	const [guideOpen, setGuideOpen] = useState(false);
	// The token just made: only this screen has it, until it's closed.
	const [made, setMade] = useState<string | null>(null);
	const [confirmRevoke, setConfirmRevoke] = useState(false);

	const create = useMutation({
		mutationFn: () => createCaptureToken(),
		onSuccess: ({ token }) => {
			setMade(token);
			setGuideOpen(true);
			return queryClient.invalidateQueries({ queryKey: captureTokenQuery().queryKey });
		},
		onError: () =>
			toast("Couldn’t make a capture token.", {
				tone: "error",
				action: { label: "Retry", onClick: () => create.mutate() },
			}),
	});
	const revoke = useMutation({
		mutationFn: () => revokeCaptureToken(),
		onSuccess: () => {
			setMade(null);
			setConfirmRevoke(false);
			queryClient.setQueryData(captureTokenQuery().queryKey, { createdOn: null });
			toast("Capture token revoked. Your Shortcut no longer adds anything.");
		},
		onError: () =>
			toast("Couldn’t revoke your capture token.", {
				tone: "error",
				action: { label: "Retry", onClick: () => revoke.mutate() },
			}),
	});

	return (
		<Section aria-labelledby="capture">
			<SectionHeader id="capture" title="Tap to capture" />
			<Card className="grid gap-3 p-(--card-pad)">
				<div className="grid gap-3 sm:flex sm:items-center">
					<div className="flex flex-1 items-center gap-3 text-sm">
						<Tile>
							<Smartphone />
						</Tile>
						<p className={createdOn ? undefined : "text-muted-foreground"}>
							{createdOn
								? `Your iPhone Shortcut’s token was made ${fullDay(createdOn)}. Paying with Wallet adds a Quick Add as you.`
								: "Add a Quick Add each time you pay with Wallet, without opening Noodle, with an iPhone Shortcut."}
						</p>
					</div>
					{createdOn ? (
						<div className="flex gap-2">
							<Button variant="outline" disabled={!hydrated} onClick={() => setGuideOpen(true)}>
								Setup guide
							</Button>
							<Button
								variant="ghost"
								disabled={!hydrated || revoke.isPending}
								onClick={() => setConfirmRevoke(true)}
							>
								Revoke
							</Button>
						</div>
					) : (
						<Button disabled={!hydrated || create.isPending} onClick={() => create.mutate()}>
							Set up
						</Button>
					)}
				</div>
				{confirmRevoke ? (
					<Confirm
						confirmLabel="Revoke token"
						onConfirm={() => revoke.mutate()}
						onCancel={() => setConfirmRevoke(false)}
					>
						Your Shortcut stops adding Quick Adds until you make a new token and put it in the
						Shortcut.
					</Confirm>
				) : null}
			</Card>
			<Sheet open={guideOpen} onOpenChange={setGuideOpen}>
				<SheetContent>
					<SheetHeader
						title="Set up tap to capture"
						description="An iPhone Shortcut that adds a Quick Add as you each time you pay with Wallet."
					/>
					<Connection token={made} remaking={create.isPending} onRemake={() => create.mutate()} />
					<SetupSteps />
				</SheetContent>
			</Sheet>
		</Section>
	);
}

/** The capture URL, and the token while it's just been made; else a way to make a new one. */
function Connection({
	token,
	remaking,
	onRemake,
}: {
	token: string | null;
	remaking: boolean;
	onRemake: () => void;
}) {
	// The sheet only opens in the browser.
	const url =
		typeof window === "undefined" ? CAPTURE_PATH : `${window.location.origin}${CAPTURE_PATH}`;
	return (
		<div className="grid gap-3">
			<CopyRow label="URL" value={url} copyLabel="Copy URL" />
			{token ? (
				<>
					<CopyRow label="Token" value={token} copyLabel="Copy token" />
					<p className="text-[13px] text-muted-foreground">
						This is the only time Noodle shows this token. Anyone who has it can add Quick Adds as
						you, so put it only in your Shortcut.
					</p>
				</>
			) : (
				<div className="grid gap-2 rounded-xl bg-surface-2 p-3 text-[13px] sm:flex sm:items-center">
					<p className="flex-1 text-muted-foreground">
						Your token was shown once, when you made it. Make a new one to set up the Shortcut
						again; the old one stops working.
					</p>
					<Button size="sm" variant="outline" disabled={remaking} onClick={onRemake}>
						Make a new token
					</Button>
				</div>
			)}
		</div>
	);
}

function CopyRow({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			toast(`${label} copied`);
		} catch {
			toast(`Couldn’t copy the ${label.toLowerCase()}. Select it and copy it instead.`, {
				tone: "error",
			});
		}
	}
	return (
		<div className="flex items-center gap-2 rounded-xl bg-surface-2 p-3">
			<div className="grid min-w-0 flex-1 gap-0.5">
				<span className="text-[13px] text-muted-foreground">{label}</span>
				<code className="font-mono text-[13px] break-all select-all">{value}</code>
			</div>
			<Button size="sm" variant="outline" onClick={copy}>
				<Copy />
				{copyLabel}
			</Button>
		</div>
	);
}

/** What to tap, in the order the Shortcuts app asks for it (iOS 26; older names noted). */
function SetupSteps() {
	return (
		<ol className="grid list-decimal gap-2.5 pl-5 text-sm marker:text-muted-foreground">
			<Step>
				Open the <b>Shortcuts</b> app on your iPhone, go to <b>Automation</b>, and tap <b>+</b>.
			</Step>
			<Step>
				Choose <b>Wallet</b> (called <b>Transaction</b> before iOS 26). Pick the cards you pay with,
				and leave the categories and merchants as they are.
			</Step>
			<Step>
				Choose <b>Run Immediately</b>, turn off <b>Notify When Run</b>, and tap <b>Next</b>. Then
				tap <b>Create New Shortcut</b>.
			</Step>
			<Step>
				Add the <b>Get Contents of URL</b> action, and paste the URL above into it.
			</Step>
			<Step>
				Tap the arrow on the action to show more, and set <b>Method</b> to <b>POST</b>.
			</Step>
			<Step>
				Under <b>Headers</b>, add a header named <Code>Authorization</Code> whose value is{" "}
				<Code>Bearer</Code>, a space, and then your token.
			</Step>
			<Step>
				Set <b>Request Body</b> to <b>JSON</b> and add three Text fields: <Code>merchant</Code> set
				to <b>Shortcut Input</b>, then <b>Merchant</b>; <Code>amount</Code> set to{" "}
				<b>Shortcut Input</b>, then <b>Amount</b>; and <Code>at</Code> set to <b>Current Date</b>.
			</Step>
			<Step>
				Tap <b>Done</b>. Next time you pay with Wallet, the payment shows up in Noodle as your Quick
				Add within moments. It’s filed like a statement’s lines: by your Rules, by where you filed
				that merchant before, or by the model when it’s sure; otherwise it waits in Review for you.
			</Step>
		</ol>
	);
}

const Step = ({ children }: { children: ReactNode }) => <li className="pl-1">{children}</li>;

const Code = ({ children }: { children: ReactNode }) => (
	<code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px]">{children}</code>
);
