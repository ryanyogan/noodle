import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHydrated, useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { viewerQuery } from "../queries";
import type { HouseholdSummary } from "../server/household";
import { updateHousehold } from "../server/session";

// The US zones a Household is most likely in, by the name a Parent knows them by. A Household
// set up somewhere else keeps its own zone as a choice too.
const usZones = [
	{ value: "America/New_York", label: "Eastern" },
	{ value: "America/Chicago", label: "Central" },
	{ value: "America/Denver", label: "Mountain" },
	{ value: "America/Phoenix", label: "Arizona" },
	{ value: "America/Los_Angeles", label: "Pacific" },
	{ value: "America/Anchorage", label: "Alaska" },
	{ value: "Pacific/Honolulu", label: "Hawaii" },
];

export function timeZoneChoices(current: string) {
	return usZones.some((zone) => zone.value === current)
		? usZones
		: [{ value: current, label: current.replaceAll("_", " ") }, ...usZones];
}

/** Household settings: the Household's name and the time zone that decides which day it is. */
export function HouseholdDetails({ household }: { household: HouseholdSummary }) {
	const hydrated = useHydrated();
	const router = useRouter();
	const queryClient = useQueryClient();
	const nameId = useId();
	const zoneId = useId();
	const [name, setName] = useState(household.name);
	const [timeZone, setTimeZone] = useState(household.timeZone);
	const save = useMutation({
		mutationFn: (data: { name: string; timeZone: string }) => updateHousehold({ data }),
		onSuccess: async () => {
			// The name and zone ride on the route context, which comes from the viewer query.
			await queryClient.invalidateQueries({ queryKey: viewerQuery().queryKey });
			await router.invalidate();
			toast("Household saved.");
		},
	});
	const trimmed = name.trim();
	const dirty = trimmed !== household.name || timeZone !== household.timeZone;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (trimmed && dirty) save.mutate({ name: trimmed, timeZone });
	}

	return (
		<Section aria-labelledby="household-details">
			<SectionHeader id="household-details" title="Name and time zone" />
			<Card>
				<form onSubmit={onSubmit} className="grid items-start gap-4 p-(--card-pad) sm:grid-cols-2">
					<Field label="Household name" htmlFor={nameId}>
						<Input
							id={nameId}
							name="name"
							required
							maxLength={80}
							autoComplete="off"
							value={name}
							onChange={(event) => setName(event.currentTarget.value)}
						/>
					</Field>
					<Field label="Time zone" htmlFor={zoneId} hint="It decides when a new month starts.">
						<OptionSelect
							id={zoneId}
							value={timeZone}
							onValueChange={setTimeZone}
							choices={timeZoneChoices(household.timeZone)}
						/>
					</Field>
					{save.isError ? (
						<FormError className="sm:col-span-2">
							We couldn’t save that. Please try again.
						</FormError>
					) : null}
					<Button
						type="submit"
						variant="outline"
						className="sm:col-span-2 sm:justify-self-start"
						disabled={!hydrated || !trimmed || !dirty || save.isPending}
					>
						Save
					</Button>
				</form>
			</Card>
		</Section>
	);
}
