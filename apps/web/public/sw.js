// Noodle's service worker. It only shows Nudges (Web Push) and opens the app where one points;
// it caches nothing, so every screen still reads through the network.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
	let nudge;
	try {
		nudge = event.data?.json();
	} catch {
		nudge = null;
	}
	if (!nudge?.title) return;
	event.waitUntil(
		self.registration.showNotification(nudge.title, {
			body: nudge.body,
			// A Nudge with the same tag replaces the one already showing, quietly.
			tag: nudge.tag,
			data: { url: nudge.url },
			icon: "/icons/icon-192.png",
			badge: "/icons/icon-192.png",
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = new URL(event.notification.data?.url ?? "/month", self.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
			if (!open) return self.clients.openWindow(url);
			await open.focus();
			try {
				await open.navigate(url);
			} catch {
				// A window this worker doesn't control can't be navigated; focusing it is enough.
			}
		})(),
	);
});
