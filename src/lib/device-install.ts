/** Random installation identity, stable across login and token refresh. No fingerprint. */
const KEY = "nyuz.install-id";
export function installId(): string {
  const existing = localStorage.getItem(KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY, id);
  return id;
}
export function rememberInstallId(id: string) {
  localStorage.setItem(KEY, id);
}
