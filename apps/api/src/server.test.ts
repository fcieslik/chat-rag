import { describe, expect, it, vi } from "vitest";
import type { ConversationRepository } from "./db/conversationRepository.js";
import { startServer } from "./server.js";

describe("server startup", () => {
  it("refuses to listen and closes the pool when database readiness fails", async () => {
    const databaseError = new Error("certificate verification failed");
    const conversationRepository = {
      ready: vi.fn().mockRejectedValue(databaseError),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConversationRepository;
    const app = { listen: vi.fn() };

    await expect(startServer({ app, conversationRepository })).rejects.toBe(databaseError);
    expect(app.listen).not.toHaveBeenCalled();
    expect(conversationRepository.close).toHaveBeenCalledOnce();
  });
});
