import { describe, expect, it } from "vitest";
import { inviteEmail } from "./templates";

const link = "https://noodle.yogan.dev/invite/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

describe("inviteEmail", () => {
	const email = inviteEmail({ inviterName: "Alex", householdName: "The Lees", link });

	it("names who invited them and the Household, and nothing else from it", () => {
		expect(email.subject).toBe("Alex invited you to The Lees on Noodle");
		expect(email.text).toMatchSnapshot();
	});

	it("has a button to the link and says when it stops working", () => {
		expect(email.html).toContain(`href="${link}"`);
		expect(email.html).toContain("This link works for 7 days.");
		expect(email.html).toMatchSnapshot();
	});

	it("escapes what the Household wrote", () => {
		const odd = inviteEmail({ inviterName: "<Alex>", householdName: "Lee & Co", link });
		expect(odd.html).toContain("&lt;Alex&gt; invited you to plan Lee &amp; Co’s money");
		expect(odd.html).not.toContain("<Alex>");
	});
});
