import express from "express";
import cors from "cors";
import {
  createCognitoAccessTokenVerifier,
  type AccessTokenVerifier,
} from "./auth/cognito.js";
import { requireAccessToken } from "./auth/requireAccessToken.js";
import {
  createGuardrailService,
  type GuardrailService,
} from "./guardrailService.js";
import {
  createModelStreamingService,
  ModelStreamingResponseError,
  type ModelStreamingService,
} from "./modelStreaming.js";

const guardrailFallbackMessages = [
  "No nie! Tak to nie gadamy.",
  "Ej, stop! Nie mogę w tym pomóc.",
  "Hmm, w tej formie nie mogę w tym pomóc. Zadaj pytanie inaczej.",
  "Nie tędy droga!",
  "Spróbujmy innego tematu.",
] as const;

interface ChatRequestBody {
  message?: unknown;
}

interface AppOptions {
  verifyAccessToken?: AccessTokenVerifier;
  guardrailService?: GuardrailService;
  modelStreamingService?: ModelStreamingService;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const allowedOrigins = (
    process.env.FRONTEND_ORIGINS ??
    process.env.FRONTEND_ORIGIN ??
    "http://localhost:5173,http://localhost:8080"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const verifyAccessToken =
    options.verifyAccessToken ?? createCognitoAccessTokenVerifier();
  const guardrailService = options.guardrailService ?? createGuardrailService();
  const modelStreamingService =
    options.modelStreamingService ?? createModelStreamingService();

  app.use(
    cors({
      origin: allowedOrigins,
      methods: ["POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 204,
    }),
  );

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post(
    "/v1/chat",
    requireAccessToken(verifyAccessToken),
    async (request, response) => {
      const { message } = request.body as ChatRequestBody;

      if (typeof message !== "string" || message.trim().length === 0) {
        response
          .status(400)
          .json({ error: "The message field must be a non-empty string." });
        return;
      }

      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        response
          .status(500)
          .json({ error: "OPENAI_API_KEY is not configured." });
        return;
      }

      try {
        const guardrailResult = await guardrailService.evaluate(message);
        const guardrailIntervened =
          guardrailResult.action === "GUARDRAIL_INTERVENED";

        console.log("Guardrail check result:", guardrailIntervened);

        if (guardrailIntervened) {
          const fallbackMessage =
            guardrailFallbackMessages[
              Math.floor(Math.random() * guardrailFallbackMessages.length)
            ];

          response.status(200);
          response.setHeader(
            "Content-Type",
            "text/event-stream; charset=utf-8",
          );
          response.setHeader("Cache-Control", "no-cache, no-transform");
          response.setHeader("Connection", "keep-alive");
          response.flushHeaders();
          response.write(
            `data: ${JSON.stringify({ delta: fallbackMessage })}\n\n`,
          );
          response.write("data: [DONE]\n\n");
          response.end();
          return;
        }
      } catch {
        response
          .status(503)
          .json({ error: "Bedrock Guardrail is unavailable." });
        return;
      }

      const abortController = new AbortController();
      let clientDisconnected = false;
      const abortIfClientDisconnects = () => {
        if (!response.writableEnded) {
          clientDisconnected = true;
          abortController.abort();
        }
      };

      request.on("aborted", abortIfClientDisconnects);
      response.on("close", abortIfClientDisconnects);

      try {
        const deltas = await modelStreamingService.start({
          messages: [{ role: "user", content: message }],
          signal: abortController.signal,
        });

        response.status(200);
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();

        for await (const delta of deltas) {
          response.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }

        response.write("data: [DONE]\n\n");
        response.end();
      } catch (error) {
        if (
          clientDisconnected ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }

        if (
          error instanceof ModelStreamingResponseError &&
          !response.headersSent
        ) {
          if (error.kind === "request_failed") {
            response.status(502).json({
              error: "OpenAI request failed.",
              details: error.details,
            });
            return;
          }

          response
            .status(502)
            .json({ error: "OpenAI returned an empty stream." });
          return;
        }

        if (response.headersSent) {
          response.write(
            `event: error\ndata: ${JSON.stringify({ error: "Streaming failed." })}\n\n`,
          );
          response.end();
          return;
        }

        response
          .status(502)
          .json({ error: "Streaming request to OpenAI failed." });
      } finally {
        request.off("aborted", abortIfClientDisconnects);
        response.off("close", abortIfClientDisconnects);
      }
    },
  );

  return app;
}

const app = createApp();

export { app };
