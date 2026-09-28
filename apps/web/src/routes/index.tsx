import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: Landing,
});

function Landing() {
	return (
		<main>
			<h1>Noodle</h1>
			<p>A calm monthly Plan for your Household.</p>
			<Link to="/month">Open Noodle</Link>
		</main>
	);
}
