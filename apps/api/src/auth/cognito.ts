import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

const defaultIssuer = "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_69mO0i9j6";
const defaultClientId = "5ok5j2hpla2be0gorpdblpheuv";

export interface CognitoAuthConfig {
  issuer: string;
  clientId: string;
  jwksUri: string;
}

export interface CognitoAccessTokenClaims extends JWTPayload {
  client_id: string;
  token_use: "access";
}

export type AccessTokenVerifier = (token: string) => Promise<CognitoAccessTokenClaims>;

export function getCognitoAuthConfig(environment: NodeJS.ProcessEnv = process.env): CognitoAuthConfig {
  const issuer = environment.COGNITO_ISSUER?.trim() || defaultIssuer;
  const jwksUri =
    environment.COGNITO_JWKS_URI?.trim() ||
    new URL(".well-known/jwks.json", `${issuer.replace(/\/$/, "")}/`).toString();

  return {
    issuer,
    clientId: environment.COGNITO_CLIENT_ID?.trim() || defaultClientId,
    jwksUri,
  };
}

export function createCognitoAccessTokenVerifier(
  config: CognitoAuthConfig = getCognitoAuthConfig(),
  keySet: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUri)),
): AccessTokenVerifier {
  return async (token) => {
    const { payload } = await jwtVerify<CognitoAccessTokenClaims>(token, keySet, {
      algorithms: ["RS256"],
      issuer: config.issuer,
    });

    const now = Math.floor(Date.now() / 1000);
    if (
      payload.token_use !== "access" ||
      payload.client_id !== config.clientId ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.iat > now + 5
    ) {
      throw new Error("The Cognito access token claims are invalid.");
    }

    return payload;
  };
}
