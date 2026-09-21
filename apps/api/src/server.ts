import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import {
  createConversationRepository,
  type ConversationRepository,
} from "./db/conversationRepository.js";

interface ServerApplication {
  listen(port: number, hostname: string, callback: () => void): Server;
}

interface ServerOptions {
  app?: ServerApplication;
  conversationRepository?: ConversationRepository;
  port?: number;
}

export async function startServer(options: ServerOptions = {}): Promise<Server> {
  const conversationRepository = options.conversationRepository ?? createConversationRepository();
  try {
    await conversationRepository.ready();
  } catch (error) {
    await conversationRepository.close();
    throw error;
  }

  const app = options.app ?? createApp({ conversationRepository });
  const port = options.port ?? Number(process.env.PORT ?? 8000);
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on port ${port}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      conversationRepository.close().finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error: unknown) => {
    console.error("Database readiness check failed", error);
    process.exitCode = 1;
  });
}
