import {
  ApplyGuardrailCommand,
  BedrockRuntimeClient,
  type ApplyGuardrailCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

export interface GuardrailResult {
  action: "NONE" | "GUARDRAIL_INTERVENED";
  detectedTopics: string[];
  detectedPii: Array<{ type: string }>;
  detectedContentFilters: string[];
  outputText?: string;
  latencyMs: number;
}

export interface GuardrailService {
  evaluate(message: string): Promise<GuardrailResult>;
}

export interface GuardrailClient {
  send(command: ApplyGuardrailCommand): Promise<ApplyGuardrailCommandOutput>;
}

interface GuardrailServiceOptions {
  environment?: NodeJS.ProcessEnv;
  client?: GuardrailClient;
}

export function createGuardrailService(
  options: GuardrailServiceOptions = {},
): GuardrailService {
  const environment = options.environment ?? process.env;
  const guardrailIdentifier = environment.BEDROCK_GUARDRAIL_ID?.trim();
  const guardrailVersion = environment.BEDROCK_GUARDRAIL_VERSION?.trim();
  const region = environment.AWS_REGION?.trim();
  const client = options.client ?? (region ? new BedrockRuntimeClient({ region }) : undefined);

  return {
    async evaluate(message) {
      if (!guardrailIdentifier || !guardrailVersion || !region || !client) {
        throw new Error("Bedrock Guardrail is not configured.");
      }

      const start = performance.now();
      const response = await client.send(
        new ApplyGuardrailCommand({
          guardrailIdentifier,
          guardrailVersion,
          source: "INPUT",
          outputScope: "FULL",
          content: [{ text: { text: message } }],
        }),
      );

      const outputText = collectOutputText(response);

      return {
        action:
          response.action === "GUARDRAIL_INTERVENED"
            ? "GUARDRAIL_INTERVENED"
            : "NONE",
        detectedTopics: collectDetectedTopics(response),
        detectedPii: collectDetectedPii(response),
        detectedContentFilters: collectDetectedContentFilters(response),
        ...(outputText ? { outputText } : {}),
        latencyMs: performance.now() - start,
      };
    },
  };
}

function collectDetectedTopics(response: ApplyGuardrailCommandOutput): string[] {
  return unique(
    (response.assessments ?? []).flatMap((assessment) =>
      (assessment.topicPolicy?.topics ?? [])
        .filter((topic) => topic.detected)
        .map((topic) => topic.name),
    ),
  ).filter((topic): topic is string => typeof topic === "string");
}

function collectDetectedPii(
  response: ApplyGuardrailCommandOutput,
): Array<{ type: string }> {
  return unique(
    (response.assessments ?? []).flatMap((assessment) =>
      (assessment.sensitiveInformationPolicy?.piiEntities ?? [])
        .filter((entity) => entity.detected)
        .map((entity) => entity.type),
    ),
  ).filter((type): type is string => typeof type === "string")
    .map((type) => ({ type }));
}

function collectDetectedContentFilters(
  response: ApplyGuardrailCommandOutput,
): string[] {
  return unique(
    (response.assessments ?? []).flatMap((assessment) =>
      (assessment.contentPolicy?.filters ?? [])
        .filter((filter) => filter.detected)
        .map((filter) => filter.type),
    ),
  ).filter((type): type is string => typeof type === "string");
}

function collectOutputText(
  response: ApplyGuardrailCommandOutput,
): string | undefined {
  const outputText = (response.outputs ?? [])
    .map((output) => output.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n");

  return outputText || undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}
