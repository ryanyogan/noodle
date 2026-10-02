import { parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Input } from "@noodle/ui/components/input";
import { Switch } from "@noodle/ui/components/switch";
import { Plus, X } from "lucide-react";
import { useId } from "react";
import { anotherBucket, type BucketRow } from "../starter-buckets";
import { AmountInput } from "./goals";
import { TermHelp } from "./term-help";

// The starter-Bucket picker (#53), shared with the Plan's Buckets page (#57): each Bucket can be
// renamed, re-amounted, removed (and added back), or switched between Resets monthly and
// Carries over. The caller owns the rows and writes them.

/** Plain words for the two kinds of Bucket, one line each. */
export function CarriesOverHelp() {
	return (
		<div className="grid gap-1 text-[13px] text-muted-foreground">
			<p>
				<span className="font-medium text-foreground">Resets monthly</span>{" "}
				<TermHelp term="resets-monthly" /> starts fresh each month.
			</p>
			<p>
				<span className="font-medium text-foreground">Carries over</span>{" "}
				<TermHelp term="carries-over" /> keeps what’s left for next month. Good for things that come
				in lumps, like Gifts.
			</p>
		</div>
	);
}

export function StarterBucketPicker({
	rows,
	onChange,
}: {
	rows: BucketRow[];
	onChange: (rows: BucketRow[]) => void;
}) {
	const id = useId();
	const edit = (key: string, change: Partial<BucketRow>) =>
		onChange(rows.map((row) => (row.key === key ? { ...row, ...change, touched: true } : row)));
	const removed = rows.filter((row) => !row.kept);
	return (
		<div className="grid gap-3">
			<ul className="grid gap-2" aria-label="Buckets">
				{rows
					.filter((row) => row.kept)
					.map((row, i) => {
						const rowId = `${id}-${i}`;
						const label = row.name.trim() || "New Bucket";
						return (
							<li key={row.key}>
								<Card className="grid gap-2 p-3" data-bucket={row.key}>
									<div className="flex items-center gap-2">
										<Input
											aria-label={`Name of ${label}`}
											value={row.name}
											maxLength={40}
											placeholder="Name"
											onChange={(event) => edit(row.key, { name: event.currentTarget.value })}
											className="min-w-0 flex-1"
										/>
										{row.personal ? <TermHelp term="personal-allowance" /> : null}
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove ${label}`}
											onClick={() => edit(row.key, { kept: false })}
										>
											<X aria-hidden="true" />
										</Button>
									</div>
									<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
										<AmountInput
											aria-label={`${label} amount`}
											placeholder="0"
											value={row.amount}
											className="w-36"
											onChange={(event) => {
												const amount = event.currentTarget.value;
												edit(row.key, {
													amount,
													amountCents: parseDollars(amount) ?? 0,
													suggested: null,
												});
											}}
										/>
										<label htmlFor={`${rowId}-rolling`} className="flex items-center gap-2 text-sm">
											<Switch
												id={`${rowId}-rolling`}
												checked={row.rolling}
												onCheckedChange={(rolling) => edit(row.key, { rolling })}
											/>
											Carries over
										</label>
										{row.suggested === "spending" ? (
											<Badge variant="brand">Suggested from your spending</Badge>
										) : null}
									</div>
									{row.personal ? (
										<p className="text-[13px] text-muted-foreground">
											Yours to spend, no questions asked. Only you see what you spend from it.
										</p>
									) : null}
								</Card>
							</li>
						);
					})}
			</ul>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => onChange([...rows, anotherBucket()])}
				>
					<Plus aria-hidden="true" />
					Add another
				</Button>
				{removed.map((row) => (
					<Button
						key={row.key}
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => edit(row.key, { kept: true })}
					>
						<Plus aria-hidden="true" />
						Add back {row.name.trim() || "Bucket"}
					</Button>
				))}
			</div>
		</div>
	);
}
