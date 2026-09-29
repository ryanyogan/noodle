import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { receiptAddressQuery } from "../queries";
import { makeReceiptAddress } from "../server/receipts";
import { CopyRow } from "./capture-settings";
import { Confirm } from "./plan-editing";

/**
 * The Household's Receipt address: forward a receipt email there from your own address and it's
 * attached to its Transaction (or made a Quick Add), its lines ready to become Splits. One address
 * for the Household; making a new one stops the old one working.
 */
export function ReceiptSettings() {
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const { available, address } = useSuspenseQuery(receiptAddressQuery()).data;
	const [confirmReplace, setConfirmReplace] = useState(false);

	const make = useMutation({
		mutationFn: (replace: boolean) => makeReceiptAddress({ data: { replace } }),
		onSuccess: (made, replace) => {
			setConfirmReplace(false);
			queryClient.setQueryData(receiptAddressQuery().queryKey, made);
			if (replace) toast("New Receipt address made. The old one no longer works.");
		},
		onError: (_error, replace) =>
			toast("Couldn’t make a Receipt address.", {
				tone: "error",
				action: { label: "Retry", onClick: () => make.mutate(replace) },
			}),
	});

	return (
		<Section aria-labelledby="receipts">
			<SectionHeader id="receipts" title="Forward receipts" />
			<Card className="grid gap-3 p-(--card-pad)">
				<div className="grid gap-3 sm:flex sm:items-center">
					<div className="flex flex-1 items-center gap-3 text-sm">
						<Tile>
							<Mail />
						</Tile>
						<p className={address ? undefined : "text-muted-foreground"}>
							{!available
								? "Forwarding receipts isn’t set up for this copy of Noodle yet."
								: address
									? "Forward a receipt email here from your own address. Noodle attaches it to its Transaction and splits it across your Buckets."
									: "Forward receipt emails to Noodle, and their lines become Splits across your Buckets."}
						</p>
					</div>
					{available && !address ? (
						<Button disabled={!hydrated || make.isPending} onClick={() => make.mutate(false)}>
							Get an address
						</Button>
					) : null}
				</div>
				{address ? (
					<>
						<CopyRow label="Address" value={address} copyLabel="Copy" />
						<div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
							<p className="flex-1">
								Only the Household’s Parents can forward here, from an address they’ve verified.
							</p>
							<Button
								size="sm"
								variant="ghost"
								disabled={!hydrated || make.isPending}
								onClick={() => setConfirmReplace(true)}
							>
								Make a new address
							</Button>
						</div>
					</>
				) : null}
				{confirmReplace ? (
					<Confirm
						confirmLabel="Make a new address"
						onConfirm={() => make.mutate(true)}
						onCancel={() => setConfirmReplace(false)}
					>
						Receipts sent to the old address will bounce. Anything already forwarded stays.
					</Confirm>
				) : null}
			</Card>
		</Section>
	);
}
