import { GMAIL_SCOPE, GMAIL_SEND_SCOPE } from "./scopes";

function grantedScopes(tokenScope: string | null | undefined) {
  return new Set((tokenScope ?? "").split(/\s+/).filter(Boolean));
}

export function hasGmailReadonlyScope(tokenScope: string | null | undefined) {
  return grantedScopes(tokenScope).has(GMAIL_SCOPE);
}

export function hasGmailSendScope(tokenScope: string | null | undefined) {
  return grantedScopes(tokenScope).has(GMAIL_SEND_SCOPE);
}
