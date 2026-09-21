import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationCommand = join(process.cwd(), "scripts", "run-ecs-migration.mjs");

async function runMigrationTask(scenario: string) {
  const binDirectory = await mkdtemp(join(tmpdir(), "chat-rag-fake-aws-"));
  const awsCommand = join(binDirectory, "aws");
  await writeFile(
    awsCommand,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_AWS_SCENARIO;
const command = process.argv.slice(2).join(" ");
const network = {
  services: [{ networkConfiguration: { awsvpcConfiguration: {
    subnets: ["subnet-a", "subnet-b"], securityGroups: ["sg-api"], assignPublicIp: "DISABLED"
  } } }]
};
const task = {
  tasks: [{ taskArn: "arn:aws:ecs:eu-central-1:123:task/migration", lastStatus: "STOPPED",
    stoppedReason: "Essential container in task exited",
    containers: [{ name: "chat-rag-api-migration", exitCode: scenario === "non-zero-exit" ? 1 : 0 }]
  }]
};
if (command.startsWith("ecs describe-services")) console.log(JSON.stringify(network));
else if (command.startsWith("ecs describe-task-definition")) console.log(JSON.stringify({ taskDefinition: { containerDefinitions: [{ name: "chat-rag-api-migration", essential: true }] } }));
else if (command.startsWith("ecs run-task")) console.log(JSON.stringify(scenario === "launch-failure" ? { failures: [{ reason: "RESOURCE:MEMORY" }], tasks: [] } : { failures: [], tasks: [{ taskArn: "arn:aws:ecs:eu-central-1:123:task/migration" }] }));
else if (command.startsWith("ecs wait tasks-stopped")) process.exit(0);
else if (command.startsWith("ecs describe-tasks")) {
  if (scenario === "missing-task") task.tasks = [];
  else {
    if (scenario === "missing-container") task.tasks[0].containers = [];
    if (scenario === "abnormal-stop") task.tasks[0].stoppedReason = "CannotPullContainerError";
  }
  console.log(JSON.stringify(task));
} else process.exit(2);
`,
  );
  await chmod(awsCommand, 0o755);

  const child = spawn("node", [migrationCommand, "arn:aws:ecs:eu-central-1:123:task-definition/chat-rag-api-migration:1"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      FAKE_AWS_SCENARIO: scenario,
      PATH: `${binDirectory}:${process.env.PATH}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [code] = (await once(child, "exit")) as [number | null];
  await rm(binDirectory, { recursive: true, force: true });
  return { code, output };
}

describe("ECS migration command", () => {
  it("allows deployment after the named migration container exits successfully", async () => {
    await expect(runMigrationTask("success")).resolves.toMatchObject({ code: 0 });
  });

  it("fails when the migration container exits non-zero", async () => {
    await expect(runMigrationTask("non-zero-exit")).resolves.toMatchObject({ code: 1 });
  });

  it("fails when ECS does not report the migration container", async () => {
    await expect(runMigrationTask("missing-container")).resolves.toMatchObject({ code: 1 });
  });

  it("fails when ECS does not report the stopped migration task", async () => {
    await expect(runMigrationTask("missing-task")).resolves.toMatchObject({ code: 1 });
  });

  it("fails when ECS reports an abnormal stop reason", async () => {
    await expect(runMigrationTask("abnormal-stop")).resolves.toMatchObject({ code: 1 });
  });

  it("fails when ECS cannot launch the migration task", async () => {
    await expect(runMigrationTask("launch-failure")).resolves.toMatchObject({ code: 1 });
  });
});
