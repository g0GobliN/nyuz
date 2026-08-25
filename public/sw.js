self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "nyuz", body: "", url: "/dashboard", tag: "" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "nyuz", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: false,
      data: { url: data.url || "/dashboard" },
      icon: "/logo-mark.png",
      badge: "/logo-mark.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/dashboard";
  const abs = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (w.url.startsWith(self.location.origin) && "focus" in w) {
          return w.focus().then((client) => (client.navigate ? client.navigate(abs) : client));
        }
      }
      return self.clients.openWindow(abs);
    }),
  );
});
