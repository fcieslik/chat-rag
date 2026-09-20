import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCognitoAccessTokenVerifier,
  type CognitoAuthConfig,
} from "./cognito.js";

const config: CognitoAuthConfig = {
  issuer: "https://cognito.example/issuer",
  clientId: "client-123",
  jwksUri: "https://cognito.example/issuer/.well-known/jwks.json",
};

let privateKey: CryptoKey;
let invalidPrivateKey: CryptoKey;
let verifier: ReturnType<typeof createCognitoAccessTokenVerifier>;

async function createToken(
  overrides: Record<string, unknown> = {},
  expiration = "10m",
  signingKey = privateKey,
) {
  const issuer = typeof overrides.iss === "string" ? overrides.iss : config.issuer;
  const { iss: _issuer, ...claims } = overrides;

  return new SignJWT({
    client_id: config.clientId,
    token_use: "access",
    sub: "cognito-user-1",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(signingKey);
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  invalidPrivateKey = (await generateKeyPair("RS256")).privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  verifier = createCognitoAccessTokenVerifier(config, createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "RS256", kid: "test-key", use: "sig" }],
  }));
});

describe("Cognito access token verification", () => {
  it("accepts a valid signed access token", async () => {
    await expect(verifier(await createToken())).resolves.toMatchObject({
      client_id: config.clientId,
      token_use: "access",
    });
  });

  it.each([
    ["wrong issuer", { iss: "https://another.example/issuer" }],
    ["wrong client", { client_id: "another-client" }],
    ["wrong token type", { token_use: "id" }],
  ])("rejects a token with %s", async (_name, claims) => {
    await expect(verifier(await createToken(claims))).rejects.toThrow();
  });

  it("rejects an expired access token", async () => {
    await expect(verifier(await createToken({}, "-1s"))).rejects.toThrow();
  });

  it("rejects a token with an invalid signature", async () => {
    await expect(verifier(await createToken({}, "10m", invalidPrivateKey))).rejects.toThrow();
  });
});
