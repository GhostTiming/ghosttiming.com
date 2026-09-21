export function googleOAuthStartHref(input: {
  returnTo: string;
  addAccount?: boolean;
  loginHint?: string | null;
  origin?: string;
}) {
  const params = new URLSearchParams({ returnTo: input.returnTo });
  if (input.addAccount) params.set("addAccount", "1");
  else if (input.loginHint) params.set("loginHint", input.loginHint);
  const path = `/api/google/oauth/start?${params}`;
  return input.origin ? `${input.origin}${path}` : path;
}
