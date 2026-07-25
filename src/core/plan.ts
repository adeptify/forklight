import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  expandHome,
  requireNonEmptyString,
  requireObject,
  requireStringArray,
} from "./parse-helpers.js";
import { assessTaskQuality, loadTaskSpec } from "./task.js";
import type { TaskPolicy } from "./settings.js";
import type { ContractTaskSpec, QualityReport } from "./types.js";

export interface WorkPlanItem {
  id: string;
  taskFile: string;
  dependsOn: string[];
  task: ContractTaskSpec;
  quality: QualityReport;
}

export interface WorkPlan {
  version: 1;
  name: string;
  objective: string;
  planFile: string;
  items: WorkPlanItem[];
  waves: string[][];
}

export interface WorkPlanReport {
  passed: boolean;
  score: number;
  issues: string[];
  plan: WorkPlan;
}

const object = requireObject;
const stringValue = requireNonEmptyString;
const stringArray = requireStringArray;

function dependencyWaves(ids: string[], dependencies: Map<string, string[]>): string[][] {
  const remaining = new Set(ids);
  const completed = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => (dependencies.get(id) ?? []).every((dependency) => completed.has(dependency)))
      .sort();
    if (ready.length === 0) return [];
    waves.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      completed.add(id);
    }
  }
  return waves;
}

export async function loadWorkPlan(
  planFileInput: string,
  policy?: TaskPolicy,
): Promise<WorkPlanReport> {
  const planFile = path.resolve(expandHome(planFileInput));
  const rawText = await readFile(planFile, "utf8");
  const root = object(planFile.endsWith(".json") ? JSON.parse(rawText) : YAML.parse(rawText), "plan");
  if (root.version !== 1) throw new Error("plan.version must be 1");
  if (!Array.isArray(root.items)) throw new Error("plan.items must be an array");

  const issues: string[] = [];
  const ids = new Set<string>();
  const rawItems = root.items.map((value, index) => {
    const item = object(value, `plan.items[${index}]`);
    const id = stringValue(item.id, `plan.items[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      issues.push(`Task ID ${id} must use lower-case letters, numbers, and hyphens`);
    }
    if (ids.has(id)) issues.push(`Task ID ${id} is duplicated`);
    ids.add(id);
    return {
      id,
      taskFile: path.resolve(
        path.dirname(planFile),
        expandHome(stringValue(item.task, `plan.items[${index}].task`)),
      ),
      dependsOn: stringArray(item.dependsOn, `plan.items[${index}].dependsOn`),
    };
  });
  if (rawItems.length < 2) issues.push("A work plan must contain at least two independently reviewable tasks");

  for (const item of rawItems) {
    for (const dependency of item.dependsOn) {
      if (!ids.has(dependency)) issues.push(`Task ${item.id} depends on unknown task ${dependency}`);
      if (dependency === item.id) issues.push(`Task ${item.id} cannot depend on itself`);
    }
  }

  const loadedItems: WorkPlanItem[] = [];
  for (const item of rawItems) {
    const loaded = await loadTaskSpec(item.taskFile, policy);
    const quality = assessTaskQuality(loaded.spec, policy?.contractQuality);
    if (loaded.spec.version !== 2) {
      issues.push(`Task ${item.id} uses legacy contract version 1`);
      continue;
    }
    if (!quality.passed) {
      issues.push(...quality.issues.map((issue) => `Task ${item.id}: ${issue}`));
    }
    loadedItems.push({ ...item, task: loaded.spec, quality });
  }

  const dependencies = new Map(rawItems.map((item) => [item.id, item.dependsOn]));
  const waves = dependencyWaves(rawItems.map((item) => item.id), dependencies);
  if (rawItems.length > 0 && waves.length === 0) issues.push("Task dependencies contain a cycle");
  const qualityScores = loadedItems.map((item) => item.quality.score);
  const contractScore = qualityScores.length === 0
    ? 0
    : Math.round(qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length);
  const structuralPenalty = Math.min(50, issues.length * 10);
  const score = Math.max(0, contractScore - structuralPenalty);
  const plan: WorkPlan = {
    version: 1,
    name: stringValue(root.name, "plan.name"),
    objective: stringValue(root.objective, "plan.objective"),
    planFile,
    items: loadedItems,
    waves,
  };
  return { passed: issues.length === 0, score, issues, plan };
}

export async function assertWorkPlan(
  planFileInput: string,
  policy?: TaskPolicy,
): Promise<WorkPlanReport> {
  const report = await loadWorkPlan(planFileInput, policy);
  if (!report.passed) {
    throw new Error(
      `Work Plan quality gate failed (${report.score}/100):\n${report.issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
  }
  return report;
}
