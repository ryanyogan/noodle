import { useEffect, useState } from "react";

/**
 * Whether a Parent has seen a hint enough times to have learned it (#64): a hint is shown the first
 * few views, then folds into its "?" popover (ADR-0018). Counted per device, in this browser's
 * storage, once per mount. The server can't know, so the first render always shows the hint;
 * storage that's blocked or empty just means it keeps showing.
 */
export function useLearned(key: string, views = 3): boolean {
	const [learned, setLearned] = useState(false);
	useEffect(() => {
		const name = `noodle.seen.${key}`;
		try {
			const seen = Number(window.localStorage.getItem(name)) || 0;
			window.localStorage.setItem(name, String(seen + 1));
			if (seen >= views) setLearned(true);
		} catch {
			// Private window or blocked storage: keep showing it.
		}
	}, [key, views]);
	return learned;
}
