const dollars = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 0,
	maximumFractionDigits: 2,
});

/** "$1,240" or "$1,240.50" (cents only when there are some); negatives use a true minus sign. */
export function formatMoney(cents: number): string {
	const text = dollars.format(Math.abs(cents) / 100).replace(/\.(\d)$/, ".$10");
	return cents < 0 ? `−${text}` : text;
}
