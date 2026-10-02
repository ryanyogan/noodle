import { parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { Input } from "@noodle/ui/components/input";
import { Plus } from "lucide-react";
import { useId } from "react";
import { anotherBill, type BillRow } from "../setup-bills";
import { AmountInput } from "./goals";

// The get-started wizard's bills checklist (#53): tick a bill to give it an amount and a due day.
// Common bills keep their names; ones added with "Add another" and ones found in the spending
// can be renamed.

const cadenceWords = { monthly: "a month", biweekly: "every two weeks", annual: "a year" } as const;

export function SetupBills({
	rows,
	onChange,
}: {
	rows: BillRow[];
	onChange: (rows: BillRow[]) => void;
}) {
	const id = useId();
	const edit = (key: string, change: Partial<BillRow>) =>
		onChange(rows.map((row) => (row.key === key ? { ...row, ...change, touched: true } : row)));
	return (
		<div className="grid gap-3">
			<ul className="grid gap-2" aria-label="Bills">
				{rows.map((row, i) => {
					const rowId = `${id}-${i}`;
					const own = !row.key.match(/^[a-z]+$/);
					const label = row.name.trim() || "New bill";
					return (
						<li key={row.key}>
							<Card className="grid gap-2 p-3" data-bill={row.key}>
								<div className="flex items-center gap-3">
									<Checkbox
										id={`${rowId}-tick`}
										checked={row.ticked}
										aria-label={own ? `Pay ${label}` : undefined}
										onCheckedChange={(checked) => edit(row.key, { ticked: checked === true })}
									/>
									{own ? (
										<Input
											aria-label={`Name of ${label}`}
											value={row.name}
											maxLength={40}
											placeholder="Name"
											onChange={(event) => edit(row.key, { name: event.currentTarget.value })}
											className="min-w-0 flex-1"
										/>
									) : (
										<label htmlFor={`${rowId}-tick`} className="flex-1 text-sm font-medium">
											{row.name}
										</label>
									)}
									{row.suggested ? (
										<Badge variant="brand">Suggested from your spending</Badge>
									) : null}
								</div>
								{row.ticked ? (
									<div className="flex flex-wrap items-end gap-3 pl-8">
										<label
											htmlFor={`${rowId}-amount`}
											className="grid gap-1 text-[13px] text-muted-foreground"
										>
											Amount {cadenceWords[row.cadence]}
											<AmountInput
												id={`${rowId}-amount`}
												aria-label={`${label} amount`}
												placeholder="0"
												value={row.amount}
												className="w-36"
												onChange={(event) => {
													const amount = event.currentTarget.value;
													edit(row.key, {
														amount,
														amountCents: parseDollars(amount) ?? 0,
														suggested: false,
													});
												}}
											/>
										</label>
										<label
											htmlFor={`${rowId}-day`}
											className="grid gap-1 text-[13px] text-muted-foreground"
										>
											Due day
											<Input
												id={`${rowId}-day`}
												aria-label={`${label} due day`}
												inputMode="numeric"
												value={String(row.dueDay)}
												className="w-20"
												onChange={(event) => {
													const day = Number(event.currentTarget.value.replace(/\D/g, ""));
													if (day >= 1 && day <= 31) edit(row.key, { dueDay: day });
												}}
											/>
										</label>
									</div>
								) : null}
							</Card>
						</li>
					);
				})}
			</ul>
			<div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onChange([...rows, anotherBill()])}
				>
					<Plus aria-hidden="true" />
					Add another
				</Button>
			</div>
		</div>
	);
}
