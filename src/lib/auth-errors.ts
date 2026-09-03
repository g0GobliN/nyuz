import type { OAuthProvider } from "./auth";

export function providerName(provider: OAuthProvider): string {
  if (provider === "google") return "Google";
  return "GitHub";
}

export function authErrorMessage(raw: string, provider?: OAuthProvider): string {
  if (/expired|otp_expired/i.test(raw)) return "That code has expired. Request a new one.";
  if (/token.*invalid|invalid.*token|invalid.*otp|otp.*invalid/i.test(raw)) {
    return "That code isn't right. Try again.";
  }
  if (/access_denied|cancel/i.test(raw)) {
    return provider
      ? `Couldn't connect to ${providerName(provider)}. Try again.`
      : "Authentication was canceled. Try again.";
  }
  if (/rate limit|too many requests/i.test(raw)) {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  if (/not enabled|unsupported provider|provider.*disabled/i.test(raw)) {
    return `${provider ? providerName(provider) : "That provider"} authentication is not available.`;
  }
  if (/capacity/i.test(raw)) {
    return "nyuz is full at the moment. Join the waitlist below and we will write when a place opens.";
  }
  if (/maintenance/i.test(raw)) {
    return "nyuz is closed for maintenance right now. Please try again shortly.";
  }
  if (/signups are closed/i.test(raw)) return "Registration is closed right now.";
  if (/database error saving new user/i.test(raw)) {
    return "We could not create the account. nyuz may be full or closed to new signups.";
  }
  if (/fetch|network|offline|failed to connect/i.test(raw)) {
    return "Couldn't connect. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}
