export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: { name: string; email?: string };
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: "inherit" | "sonnet" | "opus" | "haiku";
  tools: string[];
  mcpServers: string[];
  skills: string[]; // skill names this agent uses
  permissionMode?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: "none" | "user" | "project" | "local";
  systemPrompt: string;
}

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface McpServer {
  id: string;
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface CommandConfig {
  id: string;
  name: string;
  description: string;
  content: string;           // full markdown body (the orchestration logic)
  argumentHint?: string;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
}

export interface Plugin {
  id: string;
  manifest: PluginManifest;
  agents: AgentConfig[];
  skills: SkillConfig[];
  mcpServers: McpServer[];
  commands: CommandConfig[]; // entry-point commands (commands/ dir)
  hooks?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export const AVAILABLE_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Grep", "Glob",
  "WebFetch", "Agent", "TodoRead", "TodoWrite",
];

export const AGENT_PRESETS = {
  orchestrator: {
    model: "sonnet" as const,
    tools: ["Read", "Bash", "Agent"],
    description: "Coordinates work across specialized agents. Delegates tasks to workers based on their expertise.",
  },
  researcher: {
    model: "haiku" as const,
    tools: ["Read", "Grep", "Glob", "Bash", "WebFetch"],
    description: "Research specialist. Use proactively for information gathering and analysis tasks.",
  },
  worker: {
    model: "inherit" as const,
    tools: ["Read", "Write", "Edit", "Bash"],
    description: "Implementation specialist. Use for coding, file editing, and technical tasks.",
  },
};
