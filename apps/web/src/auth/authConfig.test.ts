import { describe, expect, it } from "vitest";
import { authConfig, buildCognitoLogoutUrl, restoreRouteAfterSignin } from "./authConfig";

describe("Cognito logout", () => {
  it("creates a managed-login logout URL with the application return URL", () => {
    expect(buildCognitoLogoutUrl({
      domain: "https://cognito.example",
      clientId: "client-123",
      logoutUri: "https://chat.example/",
    })).toBe(
      "https://cognito.example/logout?client_id=client-123&logout_uri=https%3A%2F%2Fchat.example%2F",
    );
  });
});

describe("Cognito sign-in return path", () => {
  it("removes callback query parameters without losing a deep-linked Conversation", () => {
    window.history.replaceState({}, "", "/?code=oauth-code&state=oidc-state");

    restoreRouteAfterSignin({ state: { returnPath: "/conversations/42" } });

    expect(window.location.pathname).toBe("/conversations/42");
    expect(window.location.search).toBe("");
    expect(authConfig.onSigninCallback).toBe(restoreRouteAfterSignin);
  });
});
