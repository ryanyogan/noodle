import { type MonthKey, parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import {
	arrivedMeta,
	cameInText,
	LessThanIn,
	lateByText,
	payToComeChoicesQuery,
	payToComeQuery,
	useAddPayToCome,
	useChangePayToCome,
	useRemovePayToCome,
	useSayPayToCome,
	waitingMeta,
} from "../pay-to-come";
import type { ParentPayToCome, PayToComeLineChoice, PayToComeWaiting } from "../server/pay-to-come";
import { AmountInput } from "./goals";

// Pay to come on Plan › Income (issue 159, phase a; ADR-0066): under each Parent whose pay
// varies, what they have earned that is not in yet, each with its expected day and said plainly
// as late once that day has passed, and what arrived in the month. None of it is Income until it
// lands; the page's three figures never read it.

/** Each Parent whose pay varies, or who still has some waiting, with their Pay to come. */
export function PayToCome({ month }: { month: MonthKey }) {
	const { data } = useQuery(payToComeQuery(month));
	if (!data) return null;
	return data.parents
		.filter((parent) => parent.varies || parent.waiting.length > 0 || parent.arrived.length > 0)
		.map((parent) => (
			<ParentPayToComeList key={parent.memberId} month={month} parent={parent} names={data.names} />
		));
}

function ParentPayToComeList({
	month,
	parent,
	names,
}: {
	month: MonthKey;
	parent: ParentPayToCome;
	names: string[];
}) {
	const id = useId();
	const hydrated = useHydrated();
	const say = useSayPayToCome();
	// The one being changed, or "new" while one is being added.
	const [open, setOpen] = useState<string | null>(null);
	const edited = parent.waiting.find((pay) => pay.id === open);
	return (
		<section aria-labelledby={`${id}-title`} data-testid="pay-to-come" className="grid gap-2">
			<h3 id={`${id}-title`} className="text-sm font-medium">
				{parent.name}’s pay to come
			</h3>
			<p className="text-xs text-muted-foreground">
				Pay {parent.name} has earned that isn’t in yet. It counts as Income in the month it arrives,
				not before, so it isn’t in your take-home pay, Extra income or Free to Spend.
			</p>
			{parent.waiting.length > 0 ? (
				<>
					<p data-testid="pay-to-come-total" className="text-sm">
						Earned, not in yet:{" "}
						<span className="font-semibold tabular-nums">{formatMoney(parent.total)}</span>
					</p>
					<List>
						{parent.waiting.map((pay) => {
							const [offer] = pay.offers;
							return (
								<ListRow
									key={pay.id}
									data-testid="pay-waiting"
									data-late={pay.lateBy !== null || undefined}
									title={pay.from}
									badge={
										pay.lateBy !== null ? (
											<Badge variant="over">{lateByText(pay.lateBy)}</Badge>
										) : undefined
									}
									meta={waitingMeta(pay)}
									trailing={
										<span className="flex items-center gap-1">
											<span className="text-sm text-muted-foreground tabular-nums">
												{formatMoney(pay.left)}
											</span>
											<Button
												variant="ghost"
												size="icon"
												type="button"
												disabled={!hydrated}
												aria-label={`Edit pay to come from ${pay.from}`}
												onClick={() => setOpen(pay.id)}
											>
												<Pencil />
											</Button>
										</span>
									}
									below={
										offer ? (
											<div
												data-testid="pay-to-come-offer"
												className="grid gap-2 rounded-lg bg-surface-2 p-3 text-sm"
											>
												<p>
													{cameInText(offer)}. Is this it?
													{offer.fit === "close"
														? ` It’s ${formatMoney(Math.abs(pay.left - offer.amount))} ${
																offer.amount < pay.left ? "less" : "more"
															} than what’s to come; Yes takes it as all of it.`
														: ""}
												</p>
												<div className="flex flex-wrap gap-2">
													<Button
														size="sm"
														type="button"
														disabled={!hydrated || say.isPending}
														onClick={() =>
															say.mutate(
																{ id: pay.id, incomeId: offer.incomeId, is: "all" },
																{
																	onSuccess: () => toast(`${pay.from} is in`, { tone: "success" }),
																},
															)
														}
													>
														Yes, it’s in
													</Button>
													<Button
														size="sm"
														variant="outline"
														type="button"
														disabled={!hydrated || say.isPending}
														onClick={() =>
															say.mutate({ id: pay.id, incomeId: offer.incomeId, is: "not-this" })
														}
													>
														No
													</Button>
												</div>
											</div>
										) : undefined
									}
								/>
							);
						})}
					</List>
				</>
			) : (
				<p className="text-sm text-muted-foreground">Nothing earned is waiting to come in.</p>
			)}
			{parent.arrived.length > 0 ? (
				<>
					<h4 className="pt-1 text-xs font-medium text-muted-foreground">
						Arrived in {monthName(month)}
					</h4>
					<List>
						{parent.arrived.map((arrival) => (
							<ListRow
								key={`${arrival.id} ${arrival.incomeId}`}
								data-testid="pay-arrived"
								title={arrival.from}
								badge={<Badge variant="brand">In</Badge>}
								meta={arrivedMeta(arrival)}
								trailing={
									<span className="flex items-center gap-1">
										<span className="text-sm font-semibold tabular-nums">
											{formatMoney(arrival.covers)}
										</span>
										<Button
											variant="ghost"
											size="sm"
											type="button"
											disabled={!hydrated || say.isPending}
											aria-label={`Undo: this isn’t the pay from ${arrival.from}`}
											onClick={() =>
												say.mutate(
													{ id: arrival.id, incomeId: arrival.incomeId, is: "not-this" },
													{ onSuccess: () => toast(`${arrival.from} is waiting again`) },
												)
											}
										>
											Undo
										</Button>
									</span>
								}
							/>
						))}
					</List>
				</>
			) : null}
			{say.isError ? (
				<FormError>We couldn’t save that, so nothing has changed. Try again.</FormError>
			) : null}
			{parent.varies ? (
				<div>
					<Button
						variant="outline"
						size="sm"
						type="button"
						disabled={!hydrated}
						onClick={() => setOpen("new")}
					>
						Add pay to come
					</Button>
				</div>
			) : null}
			<Sheet
				open={open === "new" || edited !== undefined}
				onOpenChange={(next) => !next && setOpen(null)}
			>
				{open === "new" || edited ? (
					<SheetContent>
						<SheetHeader
							title={edited ? `Pay to come from ${edited.from}` : `Pay ${parent.name} has earned`}
							description="Earned, not in yet. It counts as Income in the month it arrives, and Noodle marks it in when it does."
						/>
						<PayToComeForm
							parent={parent}
							pay={edited}
							names={names}
							onDone={() => setOpen(null)}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</section>
	);
}

/** Who it is from, how much and when it is expected; for one already there, also that it is in. */
function PayToComeForm({
	parent,
	pay,
	names,
	onDone,
}: {
	parent: ParentPayToCome;
	pay: PayToComeWaiting | undefined;
	names: string[];
	onDone: () => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const add = useAddPayToCome();
	const change = useChangePayToCome();
	const remove = useRemovePayToCome();
	const [from, setFrom] = useState(pay?.from ?? "");
	const [amount, setAmount] = useState(() => (pay ? formatMoneyInput(pay.amount) : ""));
	const [expectedOn, setExpectedOn] = useState(pay?.expectedOn ?? "");
	const [tried, setTried] = useState(false);
	const cents = parseDollars(amount);
	const fromError = from.trim() === "" ? "Say who it’s from" : null;
	const amountError = cents === null || cents <= 0 ? "Enter how much" : null;
	const saving = add.isPending || change.isPending || remove.isPending;
	const failed = add.error ?? change.error ?? remove.error;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (fromError || cents === null || cents <= 0) {
			setTried(true);
			return;
		}
		const details = { from: from.trim(), amountCents: cents, expectedOn: expectedOn || null };
		const done = (text: string) => ({
			onSuccess: () => {
				toast(text, { tone: "success" });
				onDone();
			},
		});
		if (pay)
			change.mutate({ id: pay.id, ...details }, done(`Pay to come from ${details.from} saved`));
		else
			add.mutate(
				{ id: ulid(), memberId: parent.memberId, ...details },
				done(`${formatMoney(cents)} from ${details.from} is earned, not in yet`),
			);
	};

	return (
		<div className="grid gap-6">
			<form className="grid gap-4" onSubmit={submit} noValidate>
				<Field
					label="Who it’s from"
					htmlFor={`${id}-from`}
					hint="A client’s name. Noodle remembers it for next time."
					error={tried ? (fromError ?? undefined) : undefined}
				>
					<Input
						id={`${id}-from`}
						value={from}
						maxLength={80}
						autoComplete="off"
						list={`${id}-names`}
						disabled={!hydrated}
						aria-invalid={(tried && fromError !== null) || undefined}
						onChange={(event) => setFrom(event.currentTarget.value)}
					/>
					<datalist id={`${id}-names`}>
						{names.map((name) => (
							<option key={name} value={name} />
						))}
					</datalist>
				</Field>
				<Field
					label="Amount"
					htmlFor={`${id}-amount`}
					hint="What should land in the account, after anything taken out."
					error={tried ? (amountError ?? undefined) : undefined}
				>
					<AmountInput
						id={`${id}-amount`}
						placeholder="0"
						value={amount}
						disabled={!hydrated}
						aria-invalid={(tried && amountError !== null) || undefined}
						onChange={(event) => setAmount(event.currentTarget.value)}
					/>
				</Field>
				<Field
					label="Expected"
					htmlFor={`${id}-expected`}
					hint="Optional. After this day, Noodle says it’s late and by how many days."
				>
					<DatePicker id={`${id}-expected`} value={expectedOn} onChange={setExpectedOn} />
				</Field>
				{expectedOn ? (
					<div>
						<Button variant="link" size="sm" type="button" onClick={() => setExpectedOn("")}>
							No day expected
						</Button>
					</div>
				) : null}
				{failed ? (
					<FormError>
						{failed instanceof LessThanIn
							? "That’s less than what has already arrived of it."
							: "We couldn’t save that, so nothing has changed. Try again."}
					</FormError>
				) : null}
				<div className="flex flex-wrap gap-2">
					<Button type="submit" disabled={!hydrated || saving}>
						Save
					</Button>
					{pay ? (
						<Button
							variant="destructive"
							type="button"
							disabled={!hydrated || saving}
							onClick={() =>
								remove.mutate(
									{ id: pay.id },
									{
										onSuccess: () => {
											toast(`Pay to come from ${pay.from} removed`);
											onDone();
										},
									},
								)
							}
						>
							Remove
						</Button>
					) : null}
				</div>
			</form>
			{pay ? <ItHasComeIn parent={parent} pay={pay} onDone={onDone} /> : null}
		</div>
	);
}

/** The Parent's Income this one can be said to have arrived as: all of it, or a part. */
function ItHasComeIn({
	parent,
	pay,
	onDone,
}: {
	parent: ParentPayToCome;
	pay: PayToComeWaiting;
	onDone: () => void;
}) {
	const id = useId();
	const { data: choices } = useQuery(payToComeChoicesQuery(pay.id));
	const say = useSayPayToCome();
	const said = (choice: PayToComeLineChoice, is: "all" | "part") =>
		say.mutate(
			{ id: pay.id, incomeId: choice.incomeId, is },
			{
				onSuccess: () => {
					toast(is === "all" ? `${pay.from} is in` : `Part of ${pay.from} is in`, {
						tone: "success",
					});
					onDone();
				},
			},
		);
	return (
		<section
			aria-labelledby={`${id}-title`}
			data-testid="pay-to-come-choices"
			className="grid gap-2"
		>
			<h3 id={`${id}-title`} className="text-sm font-medium">
				Has it come in?
			</h3>
			{choices && choices.length > 0 ? (
				<List>
					{choices.map((choice) => (
						<ListRow
							key={choice.incomeId}
							data-testid="pay-to-come-choice"
							title={cameInText(choice)}
							below={
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										type="button"
										disabled={say.isPending}
										onClick={() => said(choice, "all")}
									>
										It’s all of it
									</Button>
									{choice.fit === "part" ? (
										<Button
											size="sm"
											variant="outline"
											type="button"
											disabled={say.isPending}
											onClick={() => said(choice, "part")}
										>
											It’s part of it
										</Button>
									) : null}
								</div>
							}
						/>
					))}
				</List>
			) : choices ? (
				<p className="text-sm text-muted-foreground">
					No Income that is {parent.name}’s pay, or nobody’s yet, has landed since about a month
					before this was added. When it does, pick it here.
				</p>
			) : null}
			{say.isError ? (
				<FormError>We couldn’t save that, so nothing has changed. Try again.</FormError>
			) : null}
		</section>
	);
}
