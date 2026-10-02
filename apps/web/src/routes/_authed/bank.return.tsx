import { Spinner } from "@noodle/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { finishBankReturn } from "../../components/bank-connections";
import { bankConnectionsQuery } from "../../queries";

// Where a bank that logs the Parent in on its own page or app (OAuth) sends them back (#71): the
// address is the redirect URI every link token names, registered in Plaid's dashboard. Plaid Link
// is made again here with the same link token and this address, finishes as it would have on the
// page the Parent started from (Accounts, an Account's page or the get-started wizard), and they
// go back there, where Choose Accounts opens (ADR-0020). Arriving with nothing to finish (the
// address opened by hand, or a link token since expired) says so, with the way to start again.
export const Route = createFileRoute("/_authed/bank/return")({
	component: BankReturn,
});

function BankReturn() {
	const router = useRouter();
	const { data, isError } = useQuery(bankConnectionsQuery());
	const setUp = data?.setUp;
	const [lost, setLost] = useState(false);
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		if (isError) {
			setLost(true);
			return;
		}
		if (setUp === undefined) return;
		started.current = true;
		finishBankReturn(setUp).then(
			(returnTo) => (returnTo ? router.history.replace(returnTo) : setLost(true)),
			() => setLost(true),
		);
	}, [setUp, isError, router]);

	return (
		<main className="mx-auto grid min-h-dvh w-full max-w-md content-center gap-3 p-6">
			{lost ? (
				<>
					<h1 className="text-xl font-semibold">That bank isn’t connected yet</h1>
					<p className="text-sm text-muted-foreground">
						Noodle couldn’t pick up where you left off with your bank, so nothing was connected. It
						takes a minute to do again.
					</p>
					<p>
						<Link to="/accounts" className="font-medium underline">
							Start connecting again
						</Link>
					</p>
				</>
			) : (
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<Spinner />
					Finishing with your bank…
				</p>
			)}
		</main>
	);
}
