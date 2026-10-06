import { describe, expect, it } from "vitest";
import {
	type DayKey,
	likelyCardPayment,
	likelyOriginals,
	looksLikeCardPayment,
	type PayingCommitment,
	type PaymentAccount,
	paymentCase,
	type RefundSide,
	readsAsPaymentReceived,
	type TransferSide,
	transferPairs,
} from "./index";
import { cleanMerchant } from "./merchant-name";

const side = (id: string, date: DayKey, amount: number, accountId: string): TransferSide => ({
	id,
	date,
	amount,
	accountId,
});

describe("transferPairs: money leaving one Account and arriving in another", () => {
	it("pairs the same amount in different Accounts a few days apart", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		const onCard = side("card", "2026-09-11", 50_000, "visa");
		expect(transferPairs([payment], [onCard])).toEqual([{ outId: "pay", inId: "card" }]);
	});

	it("needs the amount to the cent, another Account, and at most four days", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		expect(transferPairs([payment], [side("a", "2026-09-10", 50_001, "visa")])).toEqual([]);
		expect(transferPairs([payment], [side("b", "2026-09-10", 50_000, "checking")])).toEqual([]);
		expect(transferPairs([payment], [side("c", "2026-09-14", 50_000, "visa")])).toEqual([]);
		expect(transferPairs([payment], [side("d", "2026-09-05", 50_000, "visa")])).toHaveLength(1);
	});

	it("prefers the nearest day, and leaves a tie to a Parent", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		const near = side("near", "2026-09-10", 50_000, "visa");
		const far = side("far", "2026-09-12", 50_000, "visa");
		expect(transferPairs([payment], [far, near])).toEqual([{ outId: "pay", inId: "near" }]);
		const twin = side("twin", "2026-09-08", 50_000, "savings");
		expect(transferPairs([payment], [near, twin])).toEqual([]);
	});

	it("never pairs what a Parent unmarked", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		const onCard = side("card", "2026-09-10", 50_000, "visa");
		expect(transferPairs([payment], [onCard], (o, i) => o === "pay" && i === "card")).toEqual([]);
	});
});

describe("likelyOriginals: what money back might be a Refund for", () => {
	const refund: RefundSide = {
		id: "back",
		date: "2026-09-12",
		amount: 2_499,
		text: "REI #11 RETURN",
	};
	const purchase = (id: string, date: DayKey, amount: number, text: string): RefundSide => ({
		id,
		date,
		amount,
		text,
	});

	it("offers purchases of at least as much from the 90 days before, merchant first", () => {
		const offered = likelyOriginals(refund, [
			purchase("coffee", "2026-09-11", 450, "Coffee"),
			purchase("costco", "2026-09-10", 6_210, "COSTCO WHSE"),
			purchase("rei", "2026-08-20", 8_999, "REI #11 PORTLAND"),
			purchase("later", "2026-09-13", 9_000, "REI"),
			purchase("old", "2026-05-01", 9_000, "REI"),
		]);
		expect(offered.map((p) => p.id)).toEqual(["rei", "costco"]);
	});

	it("puts the most recent first when nothing names the merchant", () => {
		const offered = likelyOriginals({ ...refund, text: "CREDIT" }, [
			purchase("older", "2026-08-01", 5_000, "Shoes"),
			purchase("newer", "2026-09-01", 5_000, "Jacket"),
		]);
		expect(offered.map((p) => p.id)).toEqual(["newer", "older"]);
	});
});

describe("card payments by their words (#91)", () => {
	it("knows a credit card's payment line from a bill, a purchase or a loan", () => {
		for (const text of [
			"CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
			"Payment to Chase card ending in 4321 10/02",
			"AMEX EPAYMENT ACH PMT",
			"CITI CARD ONLINE PAYMENT",
			"CAPITAL ONE CRCARDPMT",
			"DISCOVER E-PAYMENT",
			"BARCLAYCARD US CREDITCARD",
			"WF CREDIT CARD AUTO PAY",
		])
			expect(looksLikeCardPayment(text), text).toBe(true);
		for (const text of [
			"T-MOBILE AUTOPAY",
			"NATL GAS CO AUTOPAY",
			"ONLINE PAYMENT",
			"CHASE MORTGAGE PAYMENT",
			"CAPITAL ONE AUTO FINANCE CARPAY",
			"HONDA FINANCIAL LOAN PAYMENT",
			"DEBIT CARD PURCHASE NETFLIX",
			"POS DEBIT CITI BIKE PAYMENT",
			"ZELLE PAYMENT TO J DOE",
			"TRADER JOE'S #123",
			"",
			null,
		])
			expect(looksLikeCardPayment(text), String(text)).toBe(false);
	});

	it("still knows a card payment by the clean name Noodle gives its line (#95)", () => {
		for (const raw of [
			"AMERICAN EXPRESS ACH PMT",
			"AMEX EPAYMENT ACH PMT",
			"CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
			"CHASE CREDIT CRD AUTOPAY",
			"DISCOVER E-PAYMENT",
			"CITI CARD ONLINE PMT",
			"CAPITAL ONE CRCARDPMT",
			"CAPITAL ONE ONLINE PMT",
			"BARCLAYCARD US CREDITCARD",
		]) {
			const { name } = cleanMerchant(raw);
			expect(looksLikeCardPayment(raw), raw).toBe(true);
			expect(looksLikeCardPayment(name), `${raw} named ${name}`).toBe(true);
		}
		expect(cleanMerchant("AMERICAN EXPRESS ACH PMT").name).toBe("American Express payment");
		// A bill on autopay and a loan keep their names and stay what they are.
		for (const raw of ["T-MOBILE AUTOPAY", "ROCKET MORTGAGE PMT"]) {
			expect(looksLikeCardPayment(cleanMerchant(raw).name), raw).toBe(false);
		}
	});

	it("names the Household's card when the line's words fit exactly one", () => {
		const cards = [{ name: "Chase Sapphire" }, { name: "Costco Visa" }];
		const out = (text: string, amountCents = 50_000) => ({ text, amountCents });
		expect(likelyCardPayment(out("CHASE CREDIT CRD AUTOPAY"), cards)).toEqual({
			card: "Chase Sapphire",
		});
		// Only "payment" in its words, but it names a card of the Household's.
		expect(likelyCardPayment(out("VISA ONLINE PAYMENT"), [{ name: "Visa" }])).toEqual({
			card: "Visa",
		});
		// Two cards fit equally: likely, with no card named.
		expect(
			likelyCardPayment(out("CHASE CREDIT CRD AUTOPAY"), [
				{ name: "Chase Sapphire" },
				{ name: "Chase Freedom" },
			]),
		).toEqual({ card: null });
		// A card Noodle doesn't follow.
		expect(likelyCardPayment(out("AMEX EPAYMENT ACH PMT"), cards)).toEqual({ card: null });
		expect(likelyCardPayment(out("AMEX EPAYMENT ACH PMT"))).toEqual({ card: null });
	});

	it("leaves purchases, bills, plain payments and money back alone", () => {
		const cards = [{ name: "Chase Sapphire" }, { name: "Costco Visa" }];
		for (const text of [
			"COSTCO WHSE #1234",
			"T-MOBILE AUTOPAY",
			"ONLINE PAYMENT",
			"CHASE MORTGAGE PAYMENT",
		])
			expect(likelyCardPayment({ text, amountCents: 12_000 }, cards), text).toBeNull();
		// Money back onto the card is its other side, never spending waiting in Review.
		expect(
			likelyCardPayment({ text: "PAYMENT THANK YOU", amountCents: -50_000 }, cards),
		).toBeNull();
		expect(likelyCardPayment({ text: null, amountCents: 100 }, cards)).toBeNull();
	});
});

describe("Review's tree for a payment to a card or loan", () => {
	const account = (
		id: string,
		name: string,
		kind: PaymentAccount["kind"] = "credit-card",
		followed = false,
	): PaymentAccount => ({ id, name, kind, followed });
	const paying = (
		id: string,
		name: string,
		accountId: string,
		amountCents = 230_000,
		carriedBalance = false,
	): PayingCommitment => ({ id, name, accountId, amountCents, carriedBalance });
	const out = (text: string, amountCents = 61_250) => ({ text, amountCents, from: "Checking" });

	// The Household's real lines.
	const AMEX = "AMERICAN EXPRESS ACH PMT M8054 WEB ID: 2005032111";
	const CHASE = "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224";
	const LOAN = "TOYOTA FINANCIAL RETAIL PAY PPD ID: 9000012345";

	const amex = account("amex", "American Express");
	const sapphire = account("sapphire", "Chase Sapphire", "credit-card", true);
	const carLoan = account("car", "Toyota loan", "loan");
	const amexPayment = paying("c-amex", "Amex payment", "amex");

	it("files a line in the Commitment that pays down the card it names, whatever the amount", () => {
		const fits = {
			kind: "commitment",
			commitmentId: "c-amex",
			commitment: "Amex payment",
			accountId: "amex",
			account: "American Express",
		};
		// $612.50 against a $2,300 Commitment: one of several payments in the month.
		expect(paymentCase(out(AMEX), [amex, sapphire], [amexPayment])).toEqual(fits);
		// The bank's short name for the issuer, and a card named by it.
		expect(paymentCase(out("AMEX EPAYMENT ACH PMT"), [amex], [amexPayment])).toEqual(fits);
		expect(paymentCase(out(AMEX), [account("amex", "Amex Gold")], [amexPayment])).toMatchObject({
			kind: "commitment",
			account: "Amex Gold",
		});
	});

	it("files a loan servicer's line in the loan's Commitment", () => {
		const loanPayment = paying("c-car", "Car payment", "car", 41_200);
		expect(paymentCase(out(LOAN, 41_200), [amex, carLoan], [amexPayment, loanPayment])).toEqual({
			kind: "commitment",
			commitmentId: "c-car",
			commitment: "Car payment",
			accountId: "car",
			account: "Toyota loan",
		});
		// A loan with no Commitment is an ordinary line: a loan's payment is never a Transfer.
		expect(paymentCase(out(LOAN), [amex, carLoan], [amexPayment])).toBeNull();
		// A word many loans share fits only a line that reads as a loan's.
		const mortgage = account("home", "Home mortgage", "loan");
		const house = paying("c-home", "Mortgage", "home");
		expect(paymentCase(out("ROCKET MORTGAGE PAYMENT"), [mortgage, carLoan], [house])).toMatchObject(
			{ commitmentId: "c-home" },
		);
		expect(paymentCase(out("HOME DEPOT AUTOPAY"), [mortgage], [house])).toBeNull();
	});

	it("takes the only card a Commitment pays down for a card payment that names none", () => {
		const gold = account("gold", "Gold card");
		const goldPayment = paying("c-gold", "Card payment", "gold");
		expect(paymentCase(out("CARDMEMBER SERV WEB PYMT"), [gold], [goldPayment])).toMatchObject({
			kind: "commitment",
			account: "Gold card",
		});
		expect(paymentCase(out(AMEX), [gold], [goldPayment])).toMatchObject({ kind: "commitment" });
		// Not when the line names another issuer than the card's own name does.
		expect(paymentCase(out(CHASE), [amex], [amexPayment])).toEqual({
			kind: "not-followed",
			card: null,
			accountId: null,
		});
		// Not a loan for a card's line, nor when two cards are paid down.
		expect(
			paymentCase(out("CARDMEMBER SERV WEB PYMT"), [carLoan], [paying("c", "Car", "car")]),
		).toEqual({ kind: "not-followed", card: null, accountId: null });
		const blue = account("blue", "Blue card");
		expect(
			paymentCase(
				out("CARDMEMBER SERV WEB PYMT"),
				[gold, blue],
				[goldPayment, paying("c-blue", "Blue", "blue")],
			),
		).toEqual({ kind: "not-followed", card: null, accountId: null });
	});

	it("tells two cards with similar names apart by their words, else only by an exact amount", () => {
		const freedom = account("freedom", "Chase Freedom");
		const unfollowed = { ...sapphire, followed: false };
		const both = [
			paying("c-sapphire", "Sapphire payment", "sapphire", 30_000),
			paying("c-freedom", "Freedom payment", "freedom", 12_500),
		];
		expect(
			paymentCase(out("CHASE CARD ENDING IN 1234 FREEDOM AUTOPAY"), [unfollowed, freedom], both),
		).toMatchObject({ commitmentId: "c-freedom" });
		// The line fits both equally: the one whose Commitment is for exactly this much.
		expect(paymentCase(out(CHASE, 12_500), [unfollowed, freedom], both)).toMatchObject({
			commitmentId: "c-freedom",
		});
		// An amount that matches neither: no Commitment is picked for the Parent.
		expect(paymentCase(out(CHASE, 61_250), [unfollowed, freedom], both)).toEqual({
			kind: "not-followed",
			card: null,
			accountId: null,
		});
	});

	it("offers a Transfer for a card Noodle follows, and a Commitment only for a balance carried", () => {
		expect(paymentCase(out(CHASE), [amex, sapphire], [amexPayment])).toEqual({
			kind: "followed",
			card: "Chase Sapphire",
		});
		// A Commitment without the tick doesn't take a followed card's payment (it would count twice).
		const plain = paying("c-chase", "Chase payment", "sapphire");
		expect(paymentCase(out(CHASE), [sapphire], [plain])).toEqual({
			kind: "followed",
			card: "Chase Sapphire",
		});
		expect(paymentCase(out(CHASE), [sapphire], [{ ...plain, carriedBalance: true }])).toMatchObject(
			{ kind: "commitment", commitmentId: "c-chase" },
		);
		// Two followed cards fit: a Transfer, whichever it is.
		const freedom = account("freedom", "Chase Freedom", "credit-card", true);
		expect(paymentCase(out(CHASE), [sapphire, freedom], [])).toEqual({
			kind: "followed",
			card: null,
		});
	});

	it("says a card payment is the spending when Noodle can't see into the card", () => {
		// The card isn't in Noodle at all.
		expect(paymentCase(out(AMEX), [sapphire], [])).toEqual({
			kind: "not-followed",
			card: null,
			accountId: null,
		});
		// It's kept by hand, with no Commitment yet: the Commitment to make can pay it down.
		expect(paymentCase(out(AMEX), [amex, sapphire], [])).toEqual({
			kind: "not-followed",
			card: "American Express",
			accountId: "amex",
		});
	});

	it("never takes money sent to a person, a purchase, a bill or money back for a payment", () => {
		const all = [amex, sapphire, carLoan];
		const linked = [amexPayment, paying("c-car", "Car payment", "car")];
		for (const text of [
			"ZELLE PAYMENT TO AMERICAN EXPRESS TRAVEL 12345",
			"Zelle payment to Toyota Tom JPM99a1b2c3",
			"VENMO PAYMENT 1029384756",
			"VENMO *CHASE SMITH PAYMENT",
			"PAYPAL INST XFER AMERICAN EXPRESS",
			"TOYOTA OF SPRINGFIELD SERVICE",
			"AMERICAN EXPRESS TRAVEL PURCHASE",
			"T-MOBILE AUTOPAY",
			"STATE FARM INSURANCE PAYMENT",
			"ONLINE PAYMENT",
		])
			expect(paymentCase(out(text), all, linked), text).toBeNull();
		expect(paymentCase({ text: AMEX, amountCents: -61_250 }, all, linked)).toBeNull();
		expect(paymentCase({ text: null, amountCents: 100 }, all, linked)).toBeNull();
		// The Account it left never pays itself.
		expect(
			paymentCase(
				{ text: AMEX, amountCents: 100, from: "American Express" },
				[amex],
				[amexPayment],
			),
		).toEqual({ kind: "not-followed", card: null, accountId: null });
	});
});

describe("the card's side of a payment, by its words (issue 136)", () => {
	it("reads the banks' own wordings for a payment arriving on a card", () => {
		for (const text of [
			"PAYMENT THANK YOU",
			"Payment Thank You-Mobile",
			"Payment Thank You - Web",
			"AUTOMATIC PAYMENT - THANK YOU",
			"AUTOPAY PAYMENT - THANK YOU",
			"ONLINE PAYMENT, THANK YOU",
			"ONLINE PAYMENT - THANK YOU",
			"MOBILE PAYMENT - THANK YOU",
			"INTERNET PAYMENT - THANK YOU",
			"INTERNET PAYMENT THANK YOU",
			"PAYMENT RECEIVED - THANK YOU",
			"PAYMENT RECEIVED -- THANK YOU",
			"ELECTRONIC PAYMENT RECEIVED-THANK",
			"Payment Received",
			"PAYMENT - THANK YOU",
			"ONLINE ACH PAYMENT THANK YOU",
			"BA ELECTRONIC PAYMENT",
			"Online payment from CHK 1234",
			"CAPITAL ONE MOBILE PYMT",
			"CAPITAL ONE ONLINE PYMT",
			"CAPITAL ONE AUTOPAY PYMT",
			"DIRECTPAY FULL BALANCE",
			"AUTOPAY 999990000012345 RAUTOPAY AUTO-PMT",
			"ACH Deposit Internet transfer from account ending in 1234",
			"Credit Card Payment",
			"Payment",
			"E-PAYMENT RECEIVED",
		]) {
			expect(readsAsPaymentReceived(text), text).toBe(true);
		}
	});

	it("leaves refunds, statement credits, rewards and cashback as money back", () => {
		for (const text of [
			"AMAZON.COM AMZN.COM/BILL WA",
			"REFUND AMAZON",
			"TARGET REFUND",
			"PAYPAL *PAYMENT REFUND",
			"STATEMENT CREDIT",
			"AMEX DINING CREDIT",
			"TRAVEL CREDIT",
			"CASH BACK REWARD",
			"CASHBACK BONUS REDEMPTION",
			"REWARDS REDEMPTION CREDIT",
			"Pay with Rewards credit",
			"LATE FEE REVERSAL",
			"LATE PAYMENT FEE REFUND",
			"ANNUAL FEE REFUND",
			"INTEREST CHARGE ADJUSTMENT",
			"RETURNED PAYMENT",
			"PAYMENT REVERSAL",
			"PROVISIONAL CREDIT",
			"DISPUTE CREDIT",
			"PAYMENT PROTECTION REFUND",
			"APPLE PAY RETURN",
			"PAYMENT SYSTEMS INC",
			"COSTCO WHSE #1042",
			"",
			null,
			undefined,
		]) {
			expect(readsAsPaymentReceived(text), String(text)).toBe(false);
		}
	});
});

describe("a bank that is also a card issuer, on the paying side (issue 136)", () => {
	it("catches Chase, Wells Fargo, Bank of America and US Bank card payments without the words credit card", () => {
		for (const text of [
			"CHASE CARD SERV ONLINE PMT",
			"CHASE EPAY 1234567890",
			"CHASE CREDIT CRD EPAY",
			"CHASE CARD AUTOPAY",
			"WELLS FARGO CARD CCPYMT",
			"WF CREDIT CARD AUTO PAY",
			"WELLS FARGO VISA ONLINE PYMT",
			"BK OF AMER VISA ONLINE PMT",
			"BANK OF AMERICA MC ONLINE PMT",
			"BANK OF AMERICA CREDIT CARD Bill Payment",
			"Online Banking payment to CRD 1234 Confirmation# 0912",
			"US BANK CC PYMT",
			"U.S. BANK CARD PAYMENT",
			"USBANK E-PAYMENT",
		]) {
			expect(looksLikeCardPayment(text), text).toBe(true);
		}
	});

	it("still leaves their loans, and money that only names the bank, alone", () => {
		for (const text of [
			"CHASE MORTGAGE PAYMENT",
			"JPMORGAN CHASE AUTO LOAN PYMT",
			"CHASE AUTO FIN AUTOPAY",
			"WELLS FARGO HOME MTG AUTO PAY",
			"WELLS FARGO DEALER SVC PAYMENT",
			"BANK OF AMERICA HELOC PAYMENT",
			"US BANK HOME EQUITY PMT",
			"CHASE QUICKPAY",
			"WELLS FARGO ATM WITHDRAWAL",
			"T-MOBILE AUTOPAY",
		]) {
			expect(looksLikeCardPayment(text), text).toBe(false);
		}
	});
});
