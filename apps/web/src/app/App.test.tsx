import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "react-oidc-context";
import { App } from "./App";

vi.mock("react-oidc-context", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../auth/authConfig", async () => {
  const actual = await vi.importActual<typeof import("../auth/authConfig")>("../auth/authConfig");
  return {
    ...actual,
    buildCognitoLogoutUrl: vi.fn(() => "https://cognito.example/logout"),
  };
});

const useAuthMock = vi.mocked(useAuth);

function setAuthState(overrides: Record<string, unknown> = {}) {
  const auth = {
    isLoading: false,
    isAuthenticated: false,
    error: null,
    user: undefined,
    signinRedirect: vi.fn().mockResolvedValue(undefined),
    removeUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  useAuthMock.mockReturnValue(auth as unknown as ReturnType<typeof useAuth>);
  return auth;
}

describe("App authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state while the Cognito session is restored", () => {
    setAuthState({ isLoading: true });

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
  });

  it("offers sign-in without rendering the chat to an unauthenticated user", () => {
    const auth = setAuthState();

    render(<App />);

    expect(screen.getByText("Sign in to use the chat.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(auth.signinRedirect).toHaveBeenCalledOnce();
    expect(auth.signinRedirect).toHaveBeenCalledWith({ state: { returnPath: "/" } });
  });

  it("shows an authentication error and lets the user retry", () => {
    const auth = setAuthState({ error: new Error("Cognito is unavailable") });

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Cognito is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(auth.signinRedirect).toHaveBeenCalledOnce();
  });

  it("renders chat for an authenticated user without exposing token values", () => {
    const accessToken = "access-token-value";
    setAuthState({
      isAuthenticated: true,
      user: {
        access_token: accessToken,
        id_token: "id-token-value",
        refresh_token: "refresh-token-value",
        profile: { email: "user@example.com" },
      },
    });

    render(<App />);

    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("access-token-value");
    expect(document.body).not.toHaveTextContent("id-token-value");
    expect(document.body).not.toHaveTextContent("refresh-token-value");
  });

  it("clears the local session before starting Cognito logout", async () => {
    const auth = setAuthState({
      isAuthenticated: true,
      user: { access_token: "access-token-value", profile: {} },
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(auth.removeUser).toHaveBeenCalledOnce();
  });
});
