import { spawnSync } from "node:child_process";

const [migrationTaskDefinition] = process.argv.slice(2);
const cluster = process.env.ECS_CLUSTER ?? "chat-rag-cluster";
const service = process.env.ECS_SERVICE ?? "chat-rag-api-service";
const containerName = process.env.ECS_MIGRATION_CONTAINER ?? "chat-rag-api-migration";

function fail(message) {
  throw new Error(message);
}

function awsJson(arguments_) {
  const result = spawnSync("aws", [...arguments_, "--output", "json"], {
    encoding: "utf8",
  });
  if (result.error) fail(`Could not run AWS CLI: ${result.error.message}`);
  if (result.status !== 0) fail(`AWS CLI failed: ${result.stderr.trim() || arguments_.join(" ")}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`AWS CLI returned invalid JSON for: ${arguments_.join(" ")}`);
  }
}

function aws(arguments_) {
  const result = spawnSync("aws", arguments_, { encoding: "utf8" });
  if (result.error) fail(`Could not run AWS CLI: ${result.error.message}`);
  if (result.status !== 0) fail(`AWS CLI failed: ${result.stderr.trim() || arguments_.join(" ")}`);
}

function serviceNetworkConfiguration() {
  const response = awsJson(["ecs", "describe-services", "--cluster", cluster, "--services", service]);
  if (!Array.isArray(response.services) || response.services.length !== 1) fail("ECS service was not found");

  const configuration = response.services[0]?.networkConfiguration?.awsvpcConfiguration;
  if (!configuration || !Array.isArray(configuration.subnets) || configuration.subnets.length === 0) {
    fail("ECS service has no awsvpc subnets");
  }
  if (!Array.isArray(configuration.securityGroups) || configuration.securityGroups.length === 0) {
    fail("ECS service has no awsvpc security groups");
  }
  if (configuration.assignPublicIp !== "DISABLED") {
    fail("ECS service must have public IP assignment disabled");
  }
  return { awsvpcConfiguration: configuration };
}

function verifyMigrationDefinition() {
  const response = awsJson(["ecs", "describe-task-definition", "--task-definition", migrationTaskDefinition]);
  const container = response.taskDefinition?.containerDefinitions?.find((candidate) => candidate.name === containerName);
  if (!container?.essential) fail(`Migration container ${containerName} must be essential`);
}

function runMigration(networkConfiguration) {
  const response = awsJson([
    "ecs",
    "run-task",
    "--cluster",
    cluster,
    "--task-definition",
    migrationTaskDefinition,
    "--launch-type",
    "FARGATE",
    "--count",
    "1",
    "--network-configuration",
    JSON.stringify(networkConfiguration),
  ]);
  if (Array.isArray(response.failures) && response.failures.length > 0) fail("ECS could not launch the migration task");
  if (!Array.isArray(response.tasks) || response.tasks.length !== 1 || typeof response.tasks[0]?.taskArn !== "string") {
    fail("ECS did not return exactly one migration task");
  }
  return response.tasks[0].taskArn;
}

function verifyStoppedMigration(taskArn) {
  aws(["ecs", "wait", "tasks-stopped", "--cluster", cluster, "--tasks", taskArn]);
  const response = awsJson(["ecs", "describe-tasks", "--cluster", cluster, "--tasks", taskArn]);
  if (!Array.isArray(response.tasks) || response.tasks.length !== 1) fail("ECS did not return the migration task");

  const task = response.tasks[0];
  if (task.lastStatus !== "STOPPED") fail("Migration task did not stop");
  if (task.stoppedReason !== "Essential container in task exited") {
    fail(`Migration task stopped abnormally: ${task.stoppedReason ?? "missing stop reason"}`);
  }
  const container = task.containers?.find((candidate) => candidate.name === containerName);
  if (!container) fail(`Migration container ${containerName} was not reported by ECS`);
  if (container.exitCode !== 0) fail(`Migration container exited with code ${container.exitCode ?? "missing"}`);
}

try {
  if (!migrationTaskDefinition) fail("Usage: run-ecs-migration.mjs <migration-task-definition-arn>");
  verifyMigrationDefinition();
  const taskArn = runMigration(serviceNetworkConfiguration());
  verifyStoppedMigration(taskArn);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
