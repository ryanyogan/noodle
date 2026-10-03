import { OptionSelect } from "@noodle/ui/components/select";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Radix fills a Select's value from the chosen item only on the client, so before hydration
// a trigger was empty (#64: Close September's "where it goes" selects). The server's HTML shows
// the chosen label, or the placeholder when nothing is chosen.
describe("OptionSelect before hydration", () => {
	const choices = [
		{ value: "", label: "Leave it" },
		{ value: "g1", label: "Trip" },
	];
	it("shows the chosen label, including an empty choice's", () => {
		expect(
			renderToStaticMarkup(
				h(OptionSelect, { "aria-label": "Where", value: "", onValueChange: () => {}, choices }),
			),
		).toContain("Leave it");
		expect(
			renderToStaticMarkup(
				h(OptionSelect, { "aria-label": "Where", value: "g1", onValueChange: () => {}, choices }),
			),
		).toContain("Trip");
	});
	it("shows the placeholder when nothing is chosen", () => {
		const html = renderToStaticMarkup(
			h(OptionSelect, {
				"aria-label": "Kind",
				value: "",
				placeholder: "Choose one",
				onValueChange: () => {},
				choices: [{ value: "a", label: "A" }],
			}),
		);
		expect(html).toContain("Choose one");
	});
});
