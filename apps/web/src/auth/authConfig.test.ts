import { describe, expect, it } from "vitest";
import { buildCognitoLogoutUrl } from "./authConfig";

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
