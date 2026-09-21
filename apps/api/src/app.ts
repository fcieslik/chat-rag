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
  type ModelMessage,
  type ModelStreamingService,
} from "./modelStreaming.js";
import {
  createConversationRepository,
  type CreatedFirstTurn,
  type ConversationRepository,
  type HistoryCursor,
  type IdempotentTurnResult,
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
    async (request, response) => {
      const page = parsePageRequest(request.query, 20);
      if (!page) {
        response.status(400).json({ error: "Invalid pagination parameters." });
        return;
      }
      const auth = response.locals.auth as { sub: string };
      try {
        const result = await conversationRepository.listOwnedConversations(auth.sub, page);
        response.json({
          conversations: result.conversations.map(serializeConversation),
          ...(result.nextCursor ? { nextCursor: encodeCursor(result.nextCursor) } : {}),
        });
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
      const page = parsePageRequest(request.query, 50);
      if (!page) {
        response.status(400).json({ error: "Invalid pagination parameters." });
        return;
      }
      const auth = response.locals.auth as { sub: string };
      try {
        const result = await conversationRepository.listOwnedMessages(auth.sub, conversationId, page);
        if (!result) {
          response.status(404).json({ error: "Conversation not found." });
          return;
        }
        response.json({
          messages: result.messages.map(serializeMessage),
          ...(result.nextCursor ? { nextCursor: encodeCursor(result.nextCursor) } : {}),
        });
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

      const auth = response.locals.auth as { sub: string };
      try {
        const existingTurn = await conversationRepository.findTurnByClientMessageId(
          auth.sub,
          clientMessageId,
        );
        if (respondToIdempotentTurn(response, existingTurn)) {
          return;
        }
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

      let createFirstTurnResult;
      try {
        createFirstTurnResult = await conversationRepository.createFirstTurn({
          cognitoSubject: auth.sub,
          message: normalizedMessage,
          clientMessageId,
          assistantMetadata: { model: openAiModel },
        });
      } catch {
        response.status(500).json({ error: "Could not create the Conversation." });
        return;
      }
      if (createFirstTurnResult.kind !== "created") {
        respondToIdempotentTurn(response, createFirstTurnResult);
        return;
      }
      await streamPersistedTurn({
        request,
        response,
        turn: createFirstTurnResult.turn,
        messages: [{ role: "user", content: normalizedMessage }],
        conversationRepository,
        modelStreamingService,
      });
    },
  );

  app.post(
    "/v1/conversations/:conversationId/messages",
    requireAccessToken(verifyAccessToken),
    async (request, response) => {
      const conversationId = parseConversationId(request.params.conversationId);
      const { message, clientMessageId } = request.body as ChatRequestBody;
      const normalizedMessage = normalizeMessage(message);
      if (conversationId === undefined) {
        response.status(404).json({ error: "Conversation not found." });
        return;
      }
      if (!normalizedMessage || !isUuid(clientMessageId)) {
        response.status(400).json({
          error: "The message must be 1–10,000 characters and clientMessageId must be a UUID.",
        });
        return;
      }

      const auth = response.locals.auth as { sub: string };
      try {
        const existingTurn = await conversationRepository.findTurnByClientMessageId(
          auth.sub,
          clientMessageId,
        );
        if (respondToIdempotentTurn(response, existingTurn)) {
          return;
        }
        const guardrailResult = await guardrailService.evaluate(normalizedMessage);
        if (guardrailResult.action === "GUARDRAIL_INTERVENED") {
          streamGuardrailFallback(response);
          return;
        }
      } catch {
        response.status(503).json({ error: "Bedrock Guardrail is unavailable." });
        return;
      }

      let appendedTurn;
      try {
        appendedTurn = await conversationRepository.appendTurn({
          cognitoSubject: auth.sub,
          conversationId,
          message: normalizedMessage,
          clientMessageId,
          assistantMetadata: { model: openAiModel },
        });
      } catch {
        response.status(500).json({ error: "Could not append the Message." });
        return;
      }
      if (appendedTurn.kind === "not_found") {
        response.status(404).json({ error: "Conversation not found." });
        return;
      }
      if (appendedTurn.kind === "pending") {
        response.status(409).json({ error: "A response is already pending." });
        return;
      }
      if (appendedTurn.kind !== "created") {
        respondToIdempotentTurn(response, appendedTurn);
        return;
      }

      await streamPersistedTurn({
        request,
        response,
        turn: appendedTurn.turn,
        messages: appendedTurn.context,
        conversationRepository,
        modelStreamingService,
      });
    },
  );

  return app;
}

function respondToIdempotentTurn(
  response: express.Response,
  result: IdempotentTurnResult | Exclude<IdempotentTurnResult, { kind: "missing" }>,
): boolean {
  if (result.kind === "missing") {
    return false;
  }
  if (result.kind === "complete") {
    streamStoredTurn(response, result.turn, result.content);
    return true;
  }
  response.status(409).json({ error: "Turn delivery is not complete." });
  return true;
}

function streamStoredTurn(response: express.Response, turn: CreatedFirstTurn, content: string): void {
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
  if (content) {
    writeSse(response, "response.delta", { delta: content });
  }
  writeSse(response, "response.completed", {});
  response.end();
}

async function streamPersistedTurn(input: {
  request: express.Request;
  response: express.Response;
  turn: CreatedFirstTurn;
  messages: ModelMessage[];
  conversationRepository: ConversationRepository;
  modelStreamingService: ModelStreamingService;
}): Promise<void> {
  const abortController = new AbortController();
  let clientDisconnected = false;
  const abortIfClientDisconnects = () => {
    if (!input.response.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  };

  input.request.on("aborted", abortIfClientDisconnects);
  input.response.on("close", abortIfClientDisconnects);

  let content = "";

  try {
    const deltas = await input.modelStreamingService.start({
      messages: input.messages,
      signal: abortController.signal,
    });

    input.response.status(200);
    input.response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    input.response.setHeader("Cache-Control", "no-cache, no-transform");
    input.response.setHeader("Connection", "keep-alive");
    input.response.flushHeaders();
    writeSse(input.response, "turn.started", {
      conversationId: input.turn.conversationId.toString(),
      userMessageId: input.turn.userMessageId.toString(),
      assistantMessageId: input.turn.assistantMessageId.toString(),
    });

    for await (const delta of deltas) {
      content += delta;
      writeSse(input.response, "response.delta", { delta });
    }

    if (clientDisconnected || abortController.signal.aborted) {
      await input.conversationRepository.finishAssistantMessage(
        input.turn.assistantMessageId,
        "aborted",
        content,
      );
      return;
    }

    await input.conversationRepository.finishAssistantMessage(
      input.turn.assistantMessageId,
      "complete",
      content,
    );
    writeSse(input.response, "response.completed", {});
    input.response.end();
  } catch (error) {
    if (clientDisconnected || (error instanceof Error && error.name === "AbortError")) {
      await input.conversationRepository.finishAssistantMessage(
        input.turn.assistantMessageId,
        "aborted",
        content,
      );
      return;
    }

    await input.conversationRepository.finishAssistantMessage(
      input.turn.assistantMessageId,
      "error",
      content,
    );

    if (error instanceof ModelStreamingResponseError && !input.response.headersSent) {
      if (error.kind === "request_failed") {
        input.response.status(502).json({
          error: "OpenAI request failed.",
          details: error.details,
        });
        return;
      }
      input.response.status(502).json({ error: "OpenAI returned an empty stream." });
      return;
    }

    if (input.response.headersSent) {
      writeSse(input.response, "response.failed", { error: "Streaming failed." });
      input.response.end();
      return;
    }

    input.response.status(502).json({ error: "Streaming request to OpenAI failed." });
  } finally {
    input.request.off("aborted", abortIfClientDisconnects);
    input.response.off("close", abortIfClientDisconnects);
  }
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

function parsePageRequest(
  query: express.Request["query"],
  defaultLimit: number,
): { limit: number; cursor?: HistoryCursor } | undefined {
  const limit = query.limit === undefined ? defaultLimit : parseLimit(query.limit);
  if (limit === undefined) {
    return undefined;
  }
  if (query.cursor === undefined) {
    return { limit };
  }
  const cursor = typeof query.cursor === "string" ? decodeCursor(query.cursor) : undefined;
  return cursor ? { limit, cursor } : undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : undefined;
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.timestamp.toISOString(), i: cursor.id.toString() }))
    .toString("base64url");
}

function decodeCursor(value: string): HistoryCursor | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("t" in decoded) ||
      !("i" in decoded) ||
      typeof decoded.t !== "string" ||
      typeof decoded.i !== "string" ||
      !/^\d+$/.test(decoded.i)
    ) {
      return undefined;
    }
    const timestamp = new Date(decoded.t);
    if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== decoded.t) {
      return undefined;
    }
    return { timestamp, id: BigInt(decoded.i) };
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
  writeSse(response, "response.delta", { delta: fallbackMessage });
  writeSse(response, "response.completed", {});
  response.end();
}

function writeSse(response: express.Response, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
