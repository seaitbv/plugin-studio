import { AgentConfig, AVAILABLE_TOOLS } from "./plugin-types";

export interface ValidationIssue {
  field: string;
  severity: "error" | "warning";
  message: string;
  fix?: string;
}

const VALID_TOOLS = new Set(AVAILABLE_TOOLS);

// Common misspellings / non-existent tools
const TOOL_ALIASES: Record<string, string> = {
  WebSearch: "WebFetch",
  Search: "WebFetch",
  Fetch: "WebFetch",
  Grep2: "Grep",
  MultiGrep: "Grep",
  Task: "Agent",
};

export function validateAgent(agent: AgentConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!agent.name || agent.name === "new-agent") {
    issues.push({ field: "name", severity: "error", message: "Agent needs a proper name", fix: "Set a unique kebab-case name" });
  }

  if (!agent.description) {
    issues.push({ field: "description", severity: "error", message: "Description is required — Claude uses it to decide when to delegate", fix: "Add a clear description of when to use this agent" });
  }

  for (const tool of agent.tools) {
    // Strip Agent(...) syntax
    const baseTool = tool.replace(/\(.*\)/, "");
    if (!VALID_TOOLS.has(baseTool)) {
      const alias = TOOL_ALIASES[baseTool];
      issues.push({
        field: "tools",
        severity: "error",
        message: `"${tool}" is not a valid tool`,
        fix: alias ? `Use "${alias}" instead` : `Valid tools: ${AVAILABLE_TOOLS.join(", ")}`,
      });
    }
  }

  if (!agent.systemPrompt || agent.systemPrompt.trim().length < 20) {
    issues.push({ field: "systemPrompt", severity: "warning", message: "System prompt is very short or empty", fix: "Add detailed instructions for this agent" });
  }

  return issues;
}

export function getToolSuggestion(tool: string): string | null {
  return TOOL_ALIASES[tool] || null;
}
