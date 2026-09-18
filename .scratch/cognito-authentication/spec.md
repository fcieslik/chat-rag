Status: ready-for-agent

# Cognito authentication for the web application

## Problem Statement

The web application is currently an anonymous React/Vite SPA. Users can open the static application hosted on S3 and CloudFront and call the chat API without an authenticated Cognito session. The application needs a browser-based Cognito login and the API must be able to trust only requests made with a valid token for this application.

## Solution

Add an OIDC authorization-code flow with PKCE to the React SPA using Cognito and `react-oidc-context`/`oidc-client-ts`. The SPA will require authentication before showing the chat, attach the Cognito access token to chat requests, and support Cognito logout. The Express API will validate the access token against the Cognito User Pool before serving chat requests.

The implementation must work both on the local Vite origin and when the static build is served from an S3-backed CloudFront distribution. Authentication URLs are derived from the current application origin, while Cognito and API settings are supplied as build-time Vite environment variables.

## User Stories

1. As an application user, I want to see a clear sign-in screen when I am not authenticated, so that I understand why I cannot access the chat.
2. As an application user, I want to start Cognito sign-in from the web application, so that I can authenticate without manually constructing an OAuth URL.
3. As an application user, I want to return to the same SPA after successful sign-in, so that I can immediately use the chat.
4. As an application user, I want the authorization code and state removed from the browser URL after sign-in, so that sensitive authentication data is not left in browser history or copied into links.
5. As an application user, I want the application to show a loading state while the existing Cognito session is restored, so that I do not see a misleading unauthenticated state during initialization.
6. As an application user, I want authentication errors to be shown in a readable way, so that I know that sign-in failed and can retry.
7. As an authenticated user, I want to see the chat interface, so that authentication does not obstruct the normal chat experience.
8. As an authenticated user, I want every chat request to include my Cognito access token, so that the API can authenticate the request.
9. As an authenticated user, I do not want the ID token or refresh token displayed in the UI or written to logs, so that token material is not exposed accidentally.
10. As an authenticated user, I want my access token renewed while my session remains valid, so that an active chat session does not fail unexpectedly when the short-lived access token expires.
11. As an authenticated user, I want to sign out from the application, so that the local OIDC session is cleared.
12. As an authenticated user, I want sign-out to also end the Cognito managed-login session, so that returning to the application does not silently reuse the previous Cognito session.
13. As an authenticated user, I want to return to the application after sign-out, so that the next sign-in starts from a predictable state.
14. As an application owner, I want localhost authentication to work during development, so that the flow can be tested without deploying the SPA.
15. As an application owner, I want the same build to support a CloudFront origin, so that authentication does not depend on an S3 bucket URL or a hardcoded localhost address.
16. As an application owner, I want Cognito configuration to be supplied through Vite environment variables, so that different environments can use different User Pools or API origins without source changes.
17. As an application owner, I want the frontend to use a public Cognito app client without a client secret, so that no secret is embedded in the static JavaScript bundle.
18. As an application owner, I want every user in the configured Cognito User Pool to be allowed to use the chat, so that authorization groups are not required for this first release.
19. As an API consumer, I want a request without an access token to be rejected, so that the chat endpoint is not anonymously callable.
20. As an API consumer, I want a request with a malformed or invalid token to be rejected, so that forged credentials cannot access the chat.
21. As an API consumer, I want an expired token to be rejected, so that the API does not accept stale credentials.
22. As an API consumer, I want a valid access token from the configured Cognito User Pool and app client to be accepted, so that authenticated users can chat.
23. As an API owner, I want the API to validate the token issuer and signature using Cognito's signing keys, so that validation does not rely on untrusted client claims.
24. As an API owner, I want the API to require an access token rather than an ID token, so that the token type matches the API authorization contract.
25. As an API owner, I want browser preflight requests to support the Authorization header, so that the CloudFront-hosted SPA can call the API successfully.
26. As an API owner, I want unauthorized responses to use a consistent HTTP status and error shape, so that the frontend can handle session failures predictably.
27. As an application owner, I want focused automated tests for unauthenticated, loading, error, authenticated, logout, and authenticated-chat states, so that future UI changes do not remove the authentication boundary.
28. As an API owner, I want HTTP-level tests for missing, invalid, expired, wrong-client, wrong-token-type, and valid tokens, so that the API authorization boundary is protected against regressions.

## Implementation Decisions

- Use `react-oidc-context` backed by `oidc-client-ts` for the browser OIDC integration.
- Use the OAuth 2.0 authorization-code flow with PKCE. The Cognito app client is a public SPA client and must not use a client secret.
- Wrap the React application in `AuthProvider` and make authentication a prerequisite for rendering the chat page.
- Use the Cognito authority `https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_69mO0i9j6` and app client `5ok5j2hpla2be0gorpdblpheuv` for the current environment.
- Use `https://eu-central-169m0i9j6.auth.eu-central-1.amazoncognito.com` as the Cognito managed-login domain for full logout.
- Derive the callback and post-logout redirect URI from `window.location.origin`. The initial configured URLs are `http://localhost:5173`; the CloudFront distribution origin and any custom domain must be added to Cognito before production use.
- Use the `openid`, `email`, and `phone` scopes configured for the app client. Do not request or expose unnecessary scopes.
- Remove OIDC callback parameters with an `onSigninCallback` history replacement after the code exchange completes.
- Keep the OIDC user session in browser session storage. Do not print ID, access, or refresh tokens in the UI or application logs.
- Enable automatic token renewal while the Cognito session is valid. If renewal fails or the API returns an authentication failure, clear the local session and present a path to sign in again.
- Send the access token in the `Authorization: Bearer` header for the chat request. Do not send the ID token to the API.
- Keep the existing chat endpoint contract: the web client sends the message to `POST /v1/chat`, with the API origin selected by the existing environment configuration.
- Add API authentication middleware at the Express HTTP boundary before the chat handler.
- Validate the JWT signature using Cognito JWKS, the configured issuer, expiration and standard time claims, `token_use=access`, and the configured Cognito app client identifier. Do not trust client-side authentication state as API authorization.
- Allow all users from the configured User Pool to chat. Cognito groups, roles, custom scopes, and application-level permissions are out of scope for this release.
- Keep API CORS configuration environment-driven. It must allow the local Vite origin and the production CloudFront/custom frontend origins, and must allow `Content-Type` and `Authorization` headers plus the `OPTIONS` preflight method.
- Return `401 Unauthorized` for missing, malformed, expired, wrong-client, wrong-issuer, wrong-token-type, or otherwise invalid credentials. Preserve the existing successful streaming response contract for authorized requests.
- Use the monorepo's pnpm workflow to add the frontend OIDC dependencies and any focused test dependencies; do not introduce npm lockfile changes.

## Testing Decisions

- Tests verify observable behavior at the highest practical boundaries, not private implementation details or the internal OIDC library behavior.
- Frontend tests exercise the application boundary with a controlled OIDC context and mocked HTTP stream. They cover unauthenticated rendering, sign-in initiation, loading and error states, authenticated rendering, bearer-token propagation, logout, and session-renewal failure handling.
- Frontend tests verify that no token values appear in rendered output or application logging paths.
- API tests exercise the Express HTTP boundary with representative JWT fixtures or a testable token-verification seam. They cover no credentials, malformed credentials, invalid signature, wrong issuer, wrong client, wrong `token_use`, expired credentials, and a valid access token.
- API tests verify that authorized requests reach the chat handler and preserve the existing SSE streaming response, while unauthorized requests do not invoke it.
- API CORS tests verify that the configured frontend origin receives the required headers and that preflight accepts `Authorization` and `Content-Type`.
- No existing authentication test prior art exists in the repository; the new tests should establish the initial frontend and API authentication conventions.

## Out of Scope

- Creating or changing the Cognito User Pool, app client, managed-login domain, users, password policies, MFA, or identity providers through infrastructure code.
- User registration, password reset, account confirmation, profile editing, account deletion, or social login UI.
- Cognito group-based authorization, custom resource-server scopes, admin roles, or per-user chat permissions.
- Server-side sessions, refresh-token storage, token persistence in a database, or a BFF that hides tokens from the browser.
- Chat history persistence, conversation ownership, RAG authorization, or document-level access control.
- S3 bucket creation, CloudFront distribution creation, DNS, TLS certificates, or deployment pipeline changes beyond documenting the required production callback and sign-out URLs.
- End-to-end tests against the live Cognito service with real credentials.

## Further Notes

- The local Cognito app-client configuration currently allows `http://localhost:5173` as both callback and sign-out URL. The production CloudFront URL must be registered before the static production build can complete the full login/logout flow.
- The static SPA must be served through the CloudFront HTTPS origin used in Cognito configuration; an S3 bucket website URL should not be treated as the production application origin.
- The current local development proxy targets the API on port 8000. Authentication changes must preserve that local development path and its CORS configuration.
- The Cognito domain is used for managed-login logout; the OIDC authority remains the User Pool issuer used for discovery and token validation.
