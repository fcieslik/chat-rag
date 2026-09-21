import { useAuth } from "react-oidc-context";
import type { ReactNode } from "react";
import { ChatPage } from "../features/chat/ChatPage";
import { buildCognitoLogoutUrl, cognitoLogoutConfig, safeConversationPath } from "../auth/authConfig";

export function App() {
  const auth = useAuth();

  function signIn() {
    void auth.signinRedirect({
      state: { returnPath: safeConversationPath(window.location.pathname) ?? "/" },
    });
  }

  if (auth.isLoading) {
    return <AuthStatus message="Checking your session…" />;
  }

  if (auth.error) {
    return (
      <AuthStatus
        message={`Authentication failed: ${auth.error.message}`}
        action={<button onClick={signIn}>Try again</button>}
      />
    );
  }

  if (!auth.isAuthenticated || !auth.user?.access_token) {
    return (
      <AuthStatus
        message="Sign in to use the chat."
        action={<button onClick={signIn}>Sign in</button>}
      />
    );
  }

  async function handleSignOut() {
    try {
      await auth.removeUser();
    } finally {
      window.location.assign(buildCognitoLogoutUrl(cognitoLogoutConfig));
    }
  }

  return (
    <>
      <ChatPage
        accessToken={auth.user.access_token}
        onAuthenticationFailure={() => void auth.removeUser()}
        onSignOut={() => void handleSignOut()}
      />
    </>
  );
}

function AuthStatus({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <main className="chat-shell">
      <section className="chat-card auth-card" aria-live="polite">
        <p className="eyebrow">Chat RAG</p>
        <h1>Authentication</h1>
        <p role="status">{message}</p>
        {action}
      </section>
    </main>
  );
}
