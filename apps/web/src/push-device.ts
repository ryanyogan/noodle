import { useEffect } from "react";
import { removePushSubscription, savePushSubscription } from "./server/nudges";

// This device's side of Nudges: the service worker that shows them and the Web Push
// subscription the Household Agent sends them to. Browser-only; call nothing here during SSR.

/**
 * Where this device stands. `install`: an iPhone or iPad only gets Nudges once Noodle is added to
 * its Home Screen. `blocked`: the Parent refused notifications, and only the browser can undo it.
 */
export type PushDeviceState = "unsupported" | "install" | "blocked" | "off" | "on";

const supportsPush = () =>
	"serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iPadOS reports itself as a Mac, but a Mac has no touch screen.
const isAppleMobile = () =>
	/iPhone|iPad|iPod/.test(navigator.userAgent) ||
	(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const isInstalled = () =>
	window.matchMedia("(display-mode: standalone)").matches ||
	(navigator as { standalone?: boolean }).standalone === true;

async function currentSubscription(): Promise<PushSubscription | null> {
	const registration = await navigator.serviceWorker.getRegistration("/");
	return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushDeviceState(): Promise<PushDeviceState> {
	if (!supportsPush()) return isAppleMobile() && !isInstalled() ? "install" : "unsupported";
	if (Notification.permission === "denied") return "blocked";
	if (Notification.permission !== "granted") return "off";
	return (await currentSubscription()) ? "on" : "off";
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const sameBytes = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
	a != null && a.byteLength === b.byteLength && new Uint8Array(a).every((byte, i) => byte === b[i]);

/** What the server keeps of a subscription: where to send, and the keys to encrypt with. */
function subscriptionData(subscription: PushSubscription) {
	const { endpoint, keys } = subscription.toJSON();
	if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("Incomplete push subscription");
	return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/**
 * Turns Nudges on for this device. Asks for permission first, so call it straight from the
 * Parent's tap (browsers only ask then). Resolves to where the device ends up.
 */
export async function turnOnPush(vapidPublicKey: string): Promise<PushDeviceState> {
	const permission = await Notification.requestPermission();
	if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
	await navigator.serviceWorker.register("/sw.js");
	const registration = await navigator.serviceWorker.ready;
	const key = base64UrlToBytes(vapidPublicKey);
	let subscription = await registration.pushManager.getSubscription();
	// Made with another server key, it can't receive what this server sends.
	if (subscription && !sameBytes(subscription.options?.applicationServerKey, key)) {
		await subscription.unsubscribe();
		subscription = null;
	}
	subscription ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: key,
	});
	await savePushSubscription({ data: subscriptionData(subscription) });
	return "on";
}

/** Stops Nudges on this device; the Parent's other devices keep theirs. */
export async function turnOffPush(): Promise<PushDeviceState> {
	const subscription = await currentSubscription();
	if (subscription) {
		// Forgotten first: if that fails, the device is still on, as it says.
		await removePushSubscription({ data: { endpoint: subscription.endpoint } });
		await subscription.unsubscribe();
	}
	return "off";
}

/**
 * Saves this device's subscription again each time the app opens. The push service may have
 * replaced it, and a device two Parents share gets the Nudges of whoever used it last. Never
 * asks for anything.
 */
export function useKeepPushSubscription() {
	useEffect(() => {
		if (!supportsPush() || Notification.permission !== "granted") return;
		currentSubscription()
			.then((subscription) =>
				subscription ? savePushSubscription({ data: subscriptionData(subscription) }) : undefined,
			)
			// Tried again next time the app opens.
			.catch(() => {});
	}, []);
}
