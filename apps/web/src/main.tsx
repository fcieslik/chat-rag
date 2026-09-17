import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "react-oidc-context";
import { App } from "./app/App";
import { authConfig } from "./auth/authConfig";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider {...authConfig}>
      <App />
    </AuthProvider>
  </StrictMode>,
);
