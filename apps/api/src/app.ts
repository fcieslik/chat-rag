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
  openAiModel,
  type ModelStreamingService,
} from "./modelStreaming.js";
import {
  createConversationRepository,
  type ConversationRepository,
} from "./db/conversationRepository.js";

const guardrailFallbackMessages = [
  "No nie! Tak to nie gadamy.",
  "Ej, stop! Nie mogę w tym pomóc.",
  "Hmm, w tej formie nie mogę w tym pomóc. Zadaj pytanie inaczej.",
  "Nie tędy droga!",
  "Spróbujmy innego tematu.",
] as const;

interface ChatRequestBody {
  message?: unknown;
  clientMessageId?: unknown;
}

interface AppOptions {
  verifyAccessToken?: AccessTokenVerifier;
  guardrailService?: GuardrailService;
  modelStreamingService?: ModelStreamingService;
  conversationRepository?: ConversationRepository;
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
  const conversationRepository =
    options.conversationRepository ?? createConversationRepository();

  app.use(
    cors({
      origin: allowedOrigins,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 204,
    }),
  );

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get(
    "/v1/conversations",
    requireAccessToken(verifyAccessToken),
    async (_request, response) => {
      const auth = response.locals.auth as { sub: string };
      try {
        const conversations = await conversationRepository.listOwnedConversations(auth.sub);
        response.json({ conversations: conversations.map(serializeConversation) });
      } catch {
        response.status(500).json({ error: "Could not load Conversations." });
      }
    },
  );

  app.get(
    "/v1/conversations/:conversationId",
    requireAccessToken(verifyAccessToken),
    async (request, response) => {
      const conversationId = parseConversationId(request.params.conversationId);
      if (conversationId === undefined) {
        response.status(404).json({ error: "Conversation not found." });
        return;
      }
      const auth = response.locals.auth as { sub: string };
      try {
        const conversation = await conversationRepository.getOwnedConversation(auth.sub, conversationId);
        if (!conversation) {
          response.status(404).json({ error: "Conversation not found." });
          return;
        }
        response.json({ conversation: serializeConversation(conversation) });
      } catch {
        response.status(500).json({ error: "Could not load Conversation." });
      }
    },
  );

  app.get(
    "/v1/conversations/:conversationId/messages",
    requireAccessToken(verifyAccessToken),
    async (request, response) => {
      const conversationId = parseConversationId(request.params.conversationId);
      if (conversationId === undefined) {
        response.status(404).json({ error: "Conversation not found." });
        return;
      }
      const auth = response.locals.auth as { sub: string };
      try {
        const messages = await conversationRepository.listOwnedMessages(auth.sub, conversationId);
        if (!messages) {
          response.status(404).json({ error: "Conversation not found." });
          return;
        }
        response.json({ messages: messages.map(serializeMessage) });
      } catch {
        response.status(500).json({ error: "Could not load Messages." });
      }
    },
  );

  app.post(
    "/v1/conversations",
    requireAccessToken(verifyAccessToken),
    async (request, response) => {
      const { message, clientMessageId } = request.body as ChatRequestBody;
      const normalizedMessage = normalizeMessage(message);

      if (!normalizedMessage || !isUuid(clientMessageId)) {
        response.status(400).json({
          error: "The message must be 1–10,000 characters and clientMessageId must be a UUID.",
        });
        return;
      }

      try {
        const guardrailResult = await guardrailService.evaluate(normalizedMessage);
        const guardrailIntervened =
          guardrailResult.action === "GUARDRAIL_INTERVENED";

        console.log("Guardrail check result:", guardrailIntervened);

        if (guardrailIntervened) {
          streamGuardrailFallback(response);
          return;
        }
      } catch {
        response
          .status(503)
          .json({ error: "Bedrock Guardrail is unavailable." });
        return;
      }

      const auth = response.locals.auth as { sub: string };
      let turn;
      try {
        turn = await conversationRepository.createFirstTurn({
          cognitoSubject: auth.sub,
          message: normalizedMessage,
          clientMessageId,
          assistantMetadata: { model: openAiModel },
        });
      } catch {
        response.status(500).json({ error: "Could not create the Conversation." });
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
          messages: [{ role: "user", content: normalizedMessage }],
          signal: abortController.signal,
        });

        response.status(200);
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
        writeSse(response, "turn.started", {
          conversationId: turn.conversationId.toString(),
          userMessageId: turn.userMessageId.toString(),
          assistantMessageId: turn.assistantMessageId.toString(),
        });

        let content = "";
        for await (const delta of deltas) {
          content += delta;
          writeSse(response, "response.delta", { delta });
        }

        await conversationRepository.completeAssistantMessage(
          turn.assistantMessageId,
          content,
        );
        writeSse(response, "response.completed", {});
        response.end();
      } catch (error) {
        if (clientDisconnected || (error instanceof Error && error.name === "AbortError")) {
          return;
        }

        if (error instanceof ModelStreamingResponseError && !response.headersSent) {
          if (error.kind === "request_failed") {
            response.status(502).json({
              error: "OpenAI request failed.",
              details: error.details,
            });
            return;
          }
          response.status(502).json({ error: "OpenAI returned an empty stream." });
          return;
        }

        if (response.headersSent) {
          writeSse(response, "response.failed", { error: "Streaming failed." });
          response.end();
          return;
        }

        response.status(502).json({ error: "Streaming request to OpenAI failed." });
      } finally {
        request.off("aborted", abortIfClientDisconnects);
        response.off("close", abortIfClientDisconnects);
      }
    },
  );

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

function normalizeMessage(message: unknown): string | undefined {
  if (typeof message !== "string") {
    return undefined;
  }
  const normalizedMessage = message.trim();
  return normalizedMessage.length >= 1 && normalizedMessage.length <= 10_000
    ? normalizedMessage
    : undefined;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseConversationId(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function serializeConversation(conversation: {
  id: bigint;
  title: string | null;
  createdAt: Date;
  activityAt: Date;
}) {
  return {
    id: conversation.id.toString(),
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    activityAt: conversation.activityAt.toISOString(),
  };
}

function serializeMessage(message: {
  id: bigint;
  role: string;
  status: string;
  content: string;
  metadata: Record<string, unknown>;
  replyToMessageId: bigint | null;
  createdAt: Date;
}) {
  return {
    id: message.id.toString(),
    role: message.role,
    status: message.status,
    content: message.content,
    metadata: message.metadata,
    replyToMessageId: message.replyToMessageId?.toString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

function streamGuardrailFallback(response: express.Response): void {
  const fallbackMessage =
    guardrailFallbackMessages[
      Math.floor(Math.random() * guardrailFallbackMessages.length)
    ];
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  response.write(`data: ${JSON.stringify({ delta: fallbackMessage })}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function writeSse(response: express.Response, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const app = createApp();

export { app };
