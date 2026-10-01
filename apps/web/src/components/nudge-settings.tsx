import type { NudgePreferences, QuietHours } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Switch as SwitchControl } from "@noodle/ui/components/switch";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Bell, BellOff } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { type PushDeviceState, pushDeviceState, turnOffPush, turnOnPush } from "../push-device";
import { nudgeSettingsQuery } from "../queries";
import { saveNudgePreferences, sendTestNudge } from "../server/nudges";

/** The viewer's own Nudges: this device, and which Nudges they want when. */
export function NudgeSettings() {
	const { vapidPublicKey, preferences } = useSuspenseQuery(nudgeSettingsQuery()).data;
	return (
		<Section aria-labelledby="nudges">
			<SectionHeader id="nudges" title="Nudges" />
			<ThisDevice vapidPublicKey={vapidPublicKey} />
			<NudgePreferencesForm saved={preferences} />
		</Section>
	);
}

const deviceText: Record<PushDeviceState, string> = {
	unsupported: "This browser can’t show Nudges. Try Noodle installed on your phone.",
	install:
		"To get Nudges on an iPhone or iPad, add Noodle to your Home Screen (Share, then Add to Home Screen) and open it from there.",
	blocked:
		"Notifications are blocked for Noodle. Allow them in this browser’s settings for this site, then come back.",
	off: "Nudges are off on this device.",
	on: "Nudges are on for this device.",
};

function ThisDevice({ vapidPublicKey }: { vapidPublicKey: string | null }) {
	// Only the browser knows; nothing shows until it's been asked, and it's never asked to prompt.
	const [state, setState] = useState<PushDeviceState | null>(null);
	useEffect(() => {
		pushDeviceState().then(setState, () => setState("unsupported"));
	}, []);

	const change = useMutation({
		mutationFn: (on: boolean) =>
			on && vapidPublicKey ? turnOnPush(vapidPublicKey) : turnOffPush(),
		onSuccess: setState,
		onError: (_error, on) =>
			toast(on ? "Couldn’t turn on Nudges on this device." : "Couldn’t turn off Nudges.", {
				tone: "error",
			}),
	});
	const test = useMutation({
		mutationFn: () => sendTestNudge(),
		onSuccess: () => toast("Test Nudge sent. It should arrive in a moment."),
		onError: () =>
			toast("Couldn’t send a test Nudge.", {
				tone: "error",
				action: { label: "Retry", onClick: () => test.mutate() },
			}),
	});

	const text =
		state === null
			? "Checking this device…"
			: vapidPublicKey === null && state !== "on"
				? "Nudges aren’t set up for Noodle yet."
				: deviceText[state];
	return (
		<Card className="grid gap-3 p-(--card-pad) sm:flex sm:items-center">
			<div className="flex flex-1 items-center gap-3 text-sm">
				<Tile>{state === "on" ? <Bell /> : <BellOff />}</Tile>
				<p className={state === "on" ? undefined : "text-muted-foreground"}>{text}</p>
			</div>
			{state === "on" ? (
				<div className="flex gap-2">
					<Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
						Send a test
					</Button>
					<Button variant="ghost" disabled={change.isPending} onClick={() => change.mutate(false)}>
						Turn off
					</Button>
				</div>
			) : state === "off" && vapidPublicKey !== null ? (
				<Button disabled={change.isPending} onClick={() => change.mutate(true)}>
					Turn on
				</Button>
			) : null}
		</Card>
	);
}

const toTime = (minutes: number) =>
	`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const toMinutes = (time: string) => {
	const [hours = 0, minutes = 0] = time.split(":").map(Number);
	return hours * 60 + minutes;
};

/** Quiet hours when none are saved yet: 9pm to 7am. */
const usualQuietHours: QuietHours = { start: 21 * 60, end: 7 * 60 };

/**
 * Which Nudges this Parent gets. Each switch, and each quiet-hours time, saves the moment it
 * changes, as switches look like they do; the line under them says when it has.
 */
function NudgePreferencesForm({ saved }: { saved: NudgePreferences }) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const id = useId();
	const [preferences, setPreferences] = useState<NudgePreferences>(saved);
	const quietHours = preferences.quietHours ?? usualQuietHours;
	// The times last set, kept while quiet hours are off, so turning them on brings them back.
	const [lastQuietHours, setLastQuietHours] = useState(quietHours);

	const save = useMutation({
		// One at a time, in order: the last change made is the one that stays.
		scope: { id: "nudge-preferences" },
		mutationFn: (next: NudgePreferences) => saveNudgePreferences({ data: next }).then(() => next),
		onSuccess: (next) => {
			queryClient.setQueryData(nudgeSettingsQuery().queryKey, (settings) =>
				settings ? { ...settings, preferences: next } : settings,
			);
		},
		onError: (_error, next) =>
			toast("Couldn’t save your Nudge settings.", {
				tone: "error",
				action: { label: "Retry", onClick: () => save.mutate(next) },
			}),
	});

	function change(patch: Partial<NudgePreferences>) {
		const next: NudgePreferences = {
			...preferences,
			...patch,
			// Quiet hours are this Parent's own, so they follow the device they set them on.
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		};
		setPreferences(next);
		if (next.quietHours) setLastQuietHours(next.quietHours);
		save.mutate(next);
	}

	return (
		<Card>
			<fieldset disabled={!hydrated} className="divide-y">
				<legend className="sr-only">Which Nudges you get</legend>
				<Switch
					label="A Bucket is being spent faster than the month is going"
					hint="While there’s still a week or more of the month to go."
					checked={preferences.bucketPace}
					onChange={(bucketPace) => change({ bucketPace })}
				/>
				<Switch
					label="The other Parent’s Quick Adds"
					hint="Never anything in their Personal Allowance."
					checked={preferences.otherParentQuickAdds}
					onChange={(otherParentQuickAdds) => change({ otherParentQuickAdds })}
				/>
				<Switch
					label="Extra income arrives"
					hint="When you’re paid more than your usual take-home pay in a month."
					checked={preferences.windfalls}
					onChange={(windfalls) => change({ windfalls })}
				/>
				<div className="grid gap-3 pb-(--card-pad)">
					<Switch
						label="Quiet hours"
						hint="Nudges wait until they’re over. In this device’s time zone."
						checked={preferences.quietHours !== null}
						onChange={(on) => change({ quietHours: on ? lastQuietHours : null })}
					/>
					{preferences.quietHours ? (
						<div className="grid grid-cols-2 gap-3 px-(--card-pad)">
							<Field label="From" htmlFor={`${id}-start`}>
								<Input
									id={`${id}-start`}
									type="time"
									className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
									value={toTime(quietHours.start)}
									onChange={(event) =>
										event.target.value &&
										change({
											quietHours: { ...quietHours, start: toMinutes(event.target.value) },
										})
									}
								/>
							</Field>
							<Field label="Until" htmlFor={`${id}-end`}>
								<Input
									id={`${id}-end`}
									type="time"
									className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
									value={toTime(quietHours.end)}
									onChange={(event) =>
										event.target.value &&
										change({
											quietHours: { ...quietHours, end: toMinutes(event.target.value) },
										})
									}
								/>
							</Field>
						</div>
					) : null}
				</div>
				<p role="status" className="px-(--card-pad) py-3 text-[13px] text-muted-foreground">
					{save.isPending
						? "Saving…"
						: save.isError
							? "Not saved."
							: save.isSuccess
								? "Saved."
								: "Changes save as you make them."}
				</p>
			</fieldset>
		</Card>
	);
}

function Switch({
	label,
	hint,
	checked,
	onChange,
}: {
	label: ReactNode;
	hint: ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	// Named by the label alone; the hint describes it.
	return (
		<label
			htmlFor={id}
			className="flex cursor-pointer items-center justify-between gap-4 px-(--card-pad) py-3.5"
		>
			<span className="grid gap-0.5">
				<span id={`${id}-label`} className="text-sm font-medium">
					{label}
				</span>
				<span id={`${id}-hint`} className="text-[13px] text-muted-foreground">
					{hint}
				</span>
			</span>
			<SwitchControl
				id={id}
				aria-labelledby={`${id}-label`}
				aria-describedby={`${id}-hint`}
				checked={checked}
				onCheckedChange={onChange}
			/>
		</label>
	);
}
