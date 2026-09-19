---
status: accepted
---

# Input guardrail runs before the model

The API evaluates each chat message with the configured Bedrock input guardrail before it calls OpenAI. An intervention returns a randomly selected, safe SSE response without calling the model, while an unavailable guardrail fails the request closed with `503`; this preserves the streaming client contract and ensures no unchecked message reaches the model.
