import { WebStorageStateStore } from "oidc-client-ts";
import type { AuthProviderProps } from "react-oidc-context";

const defaultAuthority = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_69mO0i9j6";
const defaultClientId = "5ok5j2hpla2be0gorpdblpheuv";
const defaultCognitoDomain = "https://eu-central-169m0i9j6.auth.eu-central-1.amazoncognito.com";
const sessionStore = new WebStorageStateStore({ store: window.sessionStorage });

function appOrigin(): string {
  return window.location.origin;
}

export const authConfig: AuthProviderProps = {
  authority: import.meta.env.VITE_COGNITO_AUTHORITY?.trim() || defaultAuthority,
  client_id: import.meta.env.VITE_COGNITO_CLIENT_ID?.trim() || defaultClientId,
  redirect_uri: appOrigin(),
  post_logout_redirect_uri: appOrigin(),
  response_type: "code",
  scope: import.meta.env.VITE_COGNITO_SCOPE?.trim() || "openid email phone",
  automaticSilentRenew: true,
  userStore: sessionStore,
  stateStore: sessionStore,
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

export const cognitoLogoutConfig = {
  domain: import.meta.env.VITE_COGNITO_DOMAIN?.trim() || defaultCognitoDomain,
  clientId: authConfig.client_id,
  logoutUri: appOrigin(),
};

export function buildCognitoLogoutUrl({
  domain,
  clientId,
  logoutUri,
}: {
  domain: string;
  clientId: string;
  logoutUri: string;
}): string {
  const logoutUrl = new URL("/logout", domain);
  logoutUrl.searchParams.set("client_id", clientId);
  logoutUrl.searchParams.set("logout_uri", logoutUri);
  return logoutUrl.toString();
}
