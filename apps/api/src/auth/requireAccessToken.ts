import type { RequestHandler } from "express";
import type { AccessTokenVerifier } from "./cognito.js";

function unauthorized(response: Parameters<RequestHandler>[1]): void {
  response.status(401).json({ error: "Unauthorized" });
}

export function requireAccessToken(verifier: AccessTokenVerifier): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.get("authorization");
    const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

    if (!token) {
      unauthorized(response);
      return;
    }

    try {
      response.locals.auth = await verifier(token);
      next();
    } catch {
      unauthorized(response);
    }
  };
}
