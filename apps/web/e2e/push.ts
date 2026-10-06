/**
 * Headless Chromium denies notifications and can't reach a real push service, so this stands in
 * for the browser's permission prompt (the Parent allows) and PushManager: a subscription that
 * lasts across reloads, as a real one would.
 */
export function fakePushManager() {
	const KEY = "e2e-push-subscription";
	const PERMISSION = "e2e-notification-permission";
	Object.defineProperty(Notification, "permission", {
		get: () => localStorage.getItem(PERMISSION) ?? "default",
	});
	Notification.requestPermission = async () => {
		localStorage.setItem(PERMISSION, "granted");
		return "granted";
	};
	const fake = (applicationServerKey: number[]) => ({
		endpoint: "https://push.invalid/e2e-device",
		options: { applicationServerKey: new Uint8Array(applicationServerKey).buffer },
		toJSON: () => ({
			endpoint: "https://push.invalid/e2e-device",
			expirationTime: null,
			keys: {
				p256dh:
					"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
				auth: "tBHItJI5svbpez7KI4CCXg",
			},
		}),
		unsubscribe: async () => {
			localStorage.removeItem(KEY);
			return true;
		},
	});
	PushManager.prototype.getSubscription = async () => {
		const saved = localStorage.getItem(KEY);
		return saved ? (fake(JSON.parse(saved)) as unknown as PushSubscription) : null;
	};
	PushManager.prototype.subscribe = async (options) => {
		const key = [...new Uint8Array(options?.applicationServerKey as ArrayBuffer)];
		localStorage.setItem(KEY, JSON.stringify(key));
		return fake(key) as unknown as PushSubscription;
	};
}
