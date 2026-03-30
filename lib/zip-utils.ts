import JSZip from "jszip";
import matter from "gray-matter";
import { Plugin, AgentConfig, SkillConfig, McpServer } from "./plugin-types";

/**
 * Robustly parse an agent .md file.
 * Handles real-world dirty frontmatter:
 * - <example> XML blocks inside the YAML section
 * - multi-line description values
 * - JSON array tools
 */
function parseAgentFile(content: string, fallbackName: string): { data: Record<string, unknown>; body: string } {
  // Try standard gray-matter first
  try {
    const parsed = matter(content);
    // If we got at least a name or description, trust it
    if (parsed.data && (parsed.data.name || parsed.data.description || parsed.data.model)) {
      return { data: parsed.data, body: parsed.content.trim() };
    }
  } catch {
    // fall through to manual parser
  }

  // Manual parser: extract frontmatter between first --- and last --- before body
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { data: { name: fallbackName }, body: content };
  }

  const rawFrontmatter = fmMatch[1];
  const body = fmMatch[2].trim();
  const data: Record<string, unknown> = { name: fallbackName };

  // Strip XML blocks like <example>...</example> and <commentary>...</commentary>
  const cleanedFm = rawFrontmatter
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "")
    .replace(/<[^>]+\/>/g, "")
    .trim();

  // Parse line by line
  let currentKey = "";
  let currentValue = "";

  const flushCurrent = () => {
    if (currentKey) {
      data[currentKey] = currentValue.trim();
    }
  };

  for (const line of cleanedFm.split("\n")) {
    // key: value line
    const kvMatch = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (kvMatch) {
      flushCurrent();
      currentKey = kvMatch[1];
      currentValue = kvMatch[2];
    } else if (currentKey && line.startsWith("  ")) {
      // continuation of multiline value
      currentValue += " " + line.trim();
    }
  }
  flushCurrent();

  // Parse tools from JSON array string if needed
  if (typeof data.tools === "string") {
    const toolStr = data.tools as string;
    if (toolStr.startsWith("[")) {
      try {
        data.tools = JSON.parse(toolStr);
      } catch {
        // leave as string
      }
    }
  }

  return { data, body };
}

export async function exportPluginToZip(plugin: Plugin): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(plugin.manifest.name)!;

  // plugin.json
  const manifestDir = root.folder(".claude-plugin")!;
  manifestDir.file(
    "plugin.json",
    JSON.stringify(
      {
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        author: plugin.manifest.author,
      },
      null,
      2
    )
  );

  // agents/
  if (plugin.agents.length > 0) {
    const agentsDir = root.folder("agents")!;
    for (const agent of plugin.agents) {
      const frontmatter: Record<string, unknown> = {
        name: agent.name,
        description: agent.description,
        model: agent.model,
      };
      if (agent.tools.length > 0) frontmatter.tools = agent.tools.join(", ");
      if (agent.mcpServers.length > 0) frontmatter.mcpServers = agent.mcpServers;
      if (agent.permissionMode && agent.permissionMode !== "default")
        frontmatter.permissionMode = agent.permissionMode;
      if (agent.maxTurns) frontmatter.maxTurns = agent.maxTurns;
      if (agent.background) frontmatter.background = agent.background;
      if (agent.memory && agent.memory !== "none") frontmatter.memory = agent.memory;

      const fileContent = matter.stringify(agent.systemPrompt || "", frontmatter);
      agentsDir.file(`${agent.name}.md`, fileContent);
    }
  }

  // skills/
  if (plugin.skills.length > 0) {
    const skillsDir = root.folder("skills")!;
    for (const skill of plugin.skills) {
      const skillFolder = skillsDir.folder(skill.name)!;
      const fileContent = matter.stringify(skill.content || "", {
        description: skill.description,
      });
      skillFolder.file("SKILL.md", fileContent);
    }
  }

  // .mcp.json
  if (plugin.mcpServers.length > 0) {
    const mcpConfig: Record<string, unknown> = { mcpServers: {} };
    for (const server of plugin.mcpServers) {
      const serverConfig: Record<string, unknown> = {};
      if (server.type === "stdio") {
        serverConfig.command = server.command;
        if (server.args) serverConfig.args = server.args;
      } else {
        serverConfig.url = server.url;
      }
      if (server.env && Object.keys(server.env).length > 0) {
        serverConfig.env = server.env;
      }
      (mcpConfig.mcpServers as Record<string, unknown>)[server.name] = serverConfig;
    }
    root.file(".mcp.json", JSON.stringify(mcpConfig, null, 2));
  }

  // hooks/hooks.json
  if (plugin.hooks && Object.keys(plugin.hooks).length > 0) {
    const hooksDir = root.folder("hooks")!;
    hooksDir.file("hooks.json", JSON.stringify({ hooks: plugin.hooks }, null, 2));
  }

  return zip.generateAsync({ type: "blob" });
}

export async function importPluginFromZip(file: File): Promise<Partial<Plugin>> {
  const zip = await JSZip.loadAsync(file);
  const result: Partial<Plugin> = {
    agents: [],
    skills: [],
    mcpServers: [],
    manifest: { name: "", version: "1.0.0" },
  };

  // Find root folder — ignore macOS metadata dirs and hidden dirs
  const files = Object.keys(zip.files);
  const topLevelDirs = [...new Set(
    files
      .map((f) => f.split("/")[0])
      .filter((d) => d !== "__MACOSX" && !d.startsWith(".") && d !== "")
  )];
  const rootPrefix = topLevelDirs.length === 1 ? topLevelDirs[0] + "/" : "";

  // Parse plugin.json
  const manifestFile =
    zip.file(`${rootPrefix}.claude-plugin/plugin.json`) ||
    zip.file("plugin.json");
  if (manifestFile) {
    const content = await manifestFile.async("string");
    result.manifest = JSON.parse(content);
  }

  // Parse agents
  for (const [path, zipFile] of Object.entries(zip.files)) {
    if (zipFile.dir) continue;
    if (path.startsWith("__MACOSX/") || path.includes("/._")) continue;
    const relativePath = path.replace(rootPrefix, "");

    if (relativePath.startsWith("agents/") && relativePath.endsWith(".md")) {
      const content = await zipFile.async("string");
      const { data, body } = parseAgentFile(content, relativePath.split("/").pop()!.replace(".md", ""));

      // Normalize tools: support both "Read, Write" string and ["Read","Write"] array
      const rawTools = data.tools;
      let toolsArray: string[] = [];
      if (typeof rawTools === "string") {
        toolsArray = rawTools.split(",").map((t: string) => t.trim()).filter(Boolean);
      } else if (Array.isArray(rawTools)) {
        toolsArray = rawTools.map((t: unknown) => String(t).trim());
      }

      const agent: AgentConfig = {
        id: crypto.randomUUID(),
        name: String(data.name || relativePath.split("/").pop()!.replace(".md", "")),
        description: String(data.description || ""),
        model: (data.model as AgentConfig["model"]) || "inherit",
        tools: toolsArray,
        mcpServers: (data.mcpServers as string[]) || [],
        permissionMode: String(data.permissionMode || "default"),
        maxTurns: data.maxTurns as number | undefined,
        background: Boolean(data.background) || false,
        memory: (data.memory as AgentConfig["memory"]) || "none",
        systemPrompt: body,
      };
      result.agents!.push(agent);
    }

    if (relativePath.match(/^skills\/[^/]+\/SKILL\.md$/)) {
      const content = await zipFile.async("string");
      const parsed = matter(content);
      const skillName = relativePath.split("/")[1];
      const skill: SkillConfig = {
        id: crypto.randomUUID(),
        name: skillName,
        description: parsed.data.description || "",
        content: parsed.content.trim(),
      };
      result.skills!.push(skill);
    }

    if (relativePath === ".mcp.json") {
      const content = await zipFile.async("string");
      const mcpConfig = JSON.parse(content);
      const servers = mcpConfig.mcpServers || {};
      for (const [name, cfg] of Object.entries(servers) as [string, Record<string, unknown>][]) {
        const server: McpServer = {
          id: crypto.randomUUID(),
          name,
          type: cfg.command ? "stdio" : "http",
          command: cfg.command as string | undefined,
          args: cfg.args as string[] | undefined,
          url: cfg.url as string | undefined,
          env: (cfg.env as Record<string, string>) || {},
        };
        result.mcpServers!.push(server);
      }
    }
  }

  return result;
}
