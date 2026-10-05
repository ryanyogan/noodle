import { PERK_SOURCE_KINDS, type PerkSourceKind, perkSourceKindLabel } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { RowButton } from "@noodle/ui/components/row-button";
import { OptionSelect } from "@noodle/ui/components/select";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { Spinner } from "@noodle/ui/components/spinner";
import { useHydrated } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { newPerkSourceId, type PerkSourceItem, useAddPerkSource, useNameCard } from "../perks";
import {
	cardChoices,
	choiceNamed,
	knownSources,
	type SourceChoice,
	searchChoices,
} from "../perks-view";

// The one way to say which card or membership something is (issue 101): a sheet with one field to
// search or type in, and the few matches under it. "Add a card or membership" and a linked
// card's "Which card is this?" are the same sheet with the same picker.

/**
 * One field that searches the known names as a Parent types, with the matches under it; picking
 * one fills the field. A name that isn't in the list is fine: it's what was typed.
 */
export function PerkSourcePicker({
	id,
	label,
	placeholder,
	choices,
	value,
	onChange,
	error,
}: {
	id: string;
	label: string;
	placeholder: string;
	choices: SourceChoice[];
	value: string;
	onChange: (value: string) => void;
	error?: string;
}) {
	const picked = choiceNamed(choices, value);
	const matches = searchChoices(choices, value);
	const typed = value.trim();
	return (
		<div className="grid gap-2">
			<Field label={label} htmlFor={id} error={error}>
				<Input
					id={id}
					name="name"
					value={value}
					onChange={(event) => onChange(event.target.value)}
					maxLength={80}
					autoComplete="off"
					autoCapitalize="words"
					enterKeyHint="done"
					placeholder={placeholder}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `${id}-error` : `${id}-matches`}
				/>
			</Field>
			{matches.length > 0 ? (
				<ul aria-label="Matches" className="grid gap-0.5">
					{matches.map((choice) => (
						<li key={choice.key}>
							<RowButton
								aria-pressed={picked?.key === choice.key}
								className="gap-3 px-2.5"
								onClick={() => onChange(choice.name)}
							>
								<span className="grid min-w-0 flex-1 gap-0.5">
									<span className="min-w-0 break-words text-sm font-medium">{choice.name}</span>
									<span className="min-w-0 break-words text-[13px] text-muted-foreground">
										{choice.detail}
									</span>
								</span>
								{picked?.key === choice.key ? (
									<Check aria-hidden="true" className="size-4 shrink-0 text-brand" />
								) : null}
							</RowButton>
						</li>
					))}
				</ul>
			) : null}
			<p id={`${id}-matches`} className="text-xs text-subtle-foreground">
				{picked
					? "Noodle knows this one."
					: matches.length > 0
						? typed
							? "Pick one, or keep what you typed."
							: "Type to find more, or type any name."
						: "Not in the list. That’s fine: Noodle looks for its benefits page, and asks you for it if it can’t find one."}
			</p>
		</div>
	);
}

/**
 * "Add a card or membership": pick it or type its name, and that's it. Its Perks are read once
 * it's added; the sheet closes and its row says so.
 */
export function AddPerkSourceSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent>
				<SheetHeader
					title="Add a card or membership"
					description="Noodle reads its perks from its own benefits page."
				/>
				<AddForm onDone={() => onOpenChange(false)} />
			</SheetContent>
		</Sheet>
	);
}

function AddForm({ onDone }: { onDone: () => void }) {
	const add = useAddPerkSource();
	const hydrated = useHydrated();
	const id = useId();
	const choices = useMemo(knownSources, []);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<PerkSourceKind>("credit-card");
	const [linking, setLinking] = useState(false);
	const [errors, setErrors] = useState<{ name?: string; pageUrl?: string }>({});
	// One ID for the sheet's life, so trying again after a failure doesn't add it twice.
	const [sourceId] = useState(newPerkSourceId);
	const picked = choiceNamed(choices, name);
	const typed = name.trim();
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const pageUrl = linking
			? String(new FormData(event.currentTarget).get("pageUrl") ?? "").trim()
			: "";
		const found = {
			name: typed ? undefined : "Pick one from the list, or type its name.",
			pageUrl:
				pageUrl && !/^https:\/\/\S+\.\S+/.test(pageUrl)
					? "Paste the whole address, starting with https://"
					: undefined,
		};
		setErrors(found);
		if (found.name || found.pageUrl) return;
		add.mutate(
			{
				id: sourceId,
				name: picked?.name ?? typed,
				kind: picked?.kind ?? kind,
				plan: null,
				pageUrl: pageUrl || picked?.pageUrl || null,
			},
			{ onSuccess: onDone },
		);
	};
	return (
		<form onSubmit={submit} noValidate className="grid gap-4">
			<PerkSourcePicker
				id={`${id}-name`}
				label="Card or membership"
				placeholder="Search, or type its name"
				choices={choices}
				value={name}
				onChange={(value) => {
					setName(value);
					if (errors.name) setErrors({ ...errors, name: undefined });
				}}
				error={errors.name}
			/>
			{typed && !picked ? (
				<Field label="What it is" htmlFor={`${id}-kind`}>
					<OptionSelect
						id={`${id}-kind`}
						value={kind}
						onValueChange={(value) => setKind(value as PerkSourceKind)}
						choices={PERK_SOURCE_KINDS.map((k) => ({ value: k, label: perkSourceKindLabel[k] }))}
					/>
				</Field>
			) : null}
			{linking ? (
				<Field
					label="Benefits page (optional)"
					htmlFor={`${id}-page`}
					hint="Its page on the provider’s own site. Leave it empty and Noodle looks for it."
					error={errors.pageUrl}
				>
					<Input
						id={`${id}-page`}
						name="pageUrl"
						type="url"
						inputMode="url"
						autoComplete="off"
						placeholder="https://"
						aria-invalid={errors.pageUrl ? true : undefined}
						aria-describedby={errors.pageUrl ? `${id}-page-error` : undefined}
					/>
				</Field>
			) : (
				<div>
					<Button type="button" variant="ghost" size="sm" onClick={() => setLinking(true)}>
						I have a link to its benefits page
					</Button>
				</div>
			)}
			{add.isError ? (
				<FormError>Couldn’t add it. Check your connection and try again.</FormError>
			) : null}
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || add.isPending}>
					{add.isPending ? <Spinner /> : null}
					{add.isPending ? "Adding…" : "Add and read its perks"}
				</Button>
			</SheetFooter>
		</form>
	);
}

/**
 * "Which card is this?" for a card a bank linked: the same sheet and picker, over the issuer's
 * cards. Saying another card later reads that card's Perks in place of the ones it had.
 */
export function WhichCardSheet({
	source,
	open,
	onOpenChange,
}: {
	source: PerkSourceItem;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const card = source.card;
	if (!card) return null;
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent>
				<SheetHeader
					title={`Which ${card.issuer ? `${card.issuer} ` : ""}card is this?`}
					description={
						card.needsProduct
							? `The bank calls it “${card.accountName.trim()}” and doesn’t say which card it is.`
							: `Now “${source.name}”. Another card’s perks replace the ones read for it.`
					}
				/>
				<WhichCardForm source={source} onDone={() => onOpenChange(false)} />
			</SheetContent>
		</Sheet>
	);
}

function WhichCardForm({ source, onDone }: { source: PerkSourceItem; onDone: () => void }) {
	const nameCard = useNameCard();
	const hydrated = useHydrated();
	const id = useId();
	const issuer = source.card?.issuer ?? null;
	const options = source.card?.productOptions;
	const choices = useMemo(() => cardChoices(issuer, options), [issuer, options]);
	const [name, setName] = useState("");
	const [error, setError] = useState<string>();
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const product = choiceNamed(choices, name)?.name ?? name.trim();
		if (!product) {
			setError("Pick the card from the list, or type its name.");
			return;
		}
		nameCard.mutate({ id: source.id, product }, { onSuccess: onDone });
	};
	return (
		<form onSubmit={submit} noValidate className="grid gap-4">
			<PerkSourcePicker
				id={`${id}-card`}
				label="Card"
				placeholder="Search, or type its name"
				choices={choices}
				value={name}
				onChange={(value) => {
					setName(value);
					setError(undefined);
				}}
				error={error}
			/>
			{nameCard.isError ? (
				<FormError>Couldn’t save that. Check your connection and try again.</FormError>
			) : null}
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || nameCard.isPending}>
					{nameCard.isPending ? <Spinner /> : null}
					Look up its perks
				</Button>
			</SheetFooter>
		</form>
	);
}
