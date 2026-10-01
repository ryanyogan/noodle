import type { NudgePreferences, QuietHours } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Bell, BellOff } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
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

function NudgePreferencesForm({ saved }: { saved: NudgePreferences }) {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const id = useId();
	const [bucketPace, setBucketPace] = useState(saved.bucketPace);
	const [quickAdds, setQuickAdds] = useState(saved.otherParentQuickAdds);
	const [extraIncomes, setExtraIncomes] = useState(saved.windfalls);
	const [quiet, setQuiet] = useState(saved.quietHours !== null);
	const [quietHours, setQuietHours] = useState(saved.quietHours ?? usualQuietHours);

	const save = useMutation({
		mutationFn: (preferences: NudgePreferences) =>
			saveNudgePreferences({ data: preferences }).then(() => preferences),
		onSuccess: (preferences) => {
			queryClient.setQueryData(nudgeSettingsQuery().queryKey, (settings) =>
				settings ? { ...settings, preferences } : settings,
			);
			toast("Nudge settings saved");
		},
		onError: (_error, preferences) =>
			toast("Couldn’t save your Nudge settings.", {
				tone: "error",
				action: { label: "Retry", onClick: () => save.mutate(preferences) },
			}),
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		save.mutate({
			bucketPace,
			otherParentQuickAdds: quickAdds,
			windfalls: extraIncomes,
			quietHours: quiet ? quietHours : null,
			// Quiet hours are this Parent's own, so they follow the device they set them on.
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		});
	}

	return (
		<Card>
			<form onSubmit={onSubmit}>
				<fieldset disabled={!hydrated} className="divide-y">
					<legend className="sr-only">Which Nudges you get</legend>
					<Switch
						label="A Bucket is being spent faster than the month is going"
						hint="While there’s still a week or more of the month to go."
						checked={bucketPace}
						onChange={setBucketPace}
					/>
					<Switch
						label="The other Parent’s Quick Adds"
						hint="Never anything in their Personal Allowance."
						checked={quickAdds}
						onChange={setQuickAdds}
					/>
					<Switch
						label="Extra income arrives"
						hint="When you’re paid more than your usual take-home pay in a month."
						checked={extraIncomes}
						onChange={setExtraIncomes}
					/>
					<div className="grid gap-3 pb-(--card-pad)">
						<Switch
							label="Quiet hours"
							hint="Nudges wait until they’re over. In this device’s time zone."
							checked={quiet}
							onChange={setQuiet}
						/>
						<div className="grid grid-cols-2 gap-3 px-(--card-pad)">
							<Field label="From" htmlFor={`${id}-start`}>
								<Input
									id={`${id}-start`}
									type="time"
									required
									disabled={!quiet}
									value={toTime(quietHours.start)}
									onChange={(event) =>
										event.target.value &&
										setQuietHours({ ...quietHours, start: toMinutes(event.target.value) })
									}
								/>
							</Field>
							<Field label="Until" htmlFor={`${id}-end`}>
								<Input
									id={`${id}-end`}
									type="time"
									required
									disabled={!quiet}
									value={toTime(quietHours.end)}
									onChange={(event) =>
										event.target.value &&
										setQuietHours({ ...quietHours, end: toMinutes(event.target.value) })
									}
								/>
							</Field>
						</div>
					</div>
					<div className="flex justify-end p-(--card-pad)">
						<Button type="submit" disabled={save.isPending}>
							Save
						</Button>
					</div>
				</fieldset>
			</form>
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
		<label className="flex cursor-pointer items-center justify-between gap-4 px-(--card-pad) py-3.5">
			<span className="grid gap-0.5">
				<span id={`${id}-label`} className="text-sm font-medium">
					{label}
				</span>
				<span id={`${id}-hint`} className="text-[13px] text-muted-foreground">
					{hint}
				</span>
			</span>
			<span className="relative inline-flex shrink-0">
				<input
					type="checkbox"
					role="switch"
					aria-labelledby={`${id}-label`}
					aria-describedby={`${id}-hint`}
					aria-checked={checked}
					checked={checked}
					onChange={(event) => onChange(event.target.checked)}
					className="peer h-6 w-10 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface-3 transition-colors checked:border-transparent duration-(--duration-fast) checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
				/>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute top-0.5 left-0.5 size-5 rounded-full border border-border-strong bg-card shadow-sm transition-transform duration-(--duration-fast) peer-checked:translate-x-4"
				/>
			</span>
		</label>
	);
}
