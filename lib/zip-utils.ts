import JSZip from "jszip";
import matter from "gray-matter";
import { Plugin, AgentConfig, SkillConfig, McpServer } from "./plugin-types";

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

  // Find root folder
  const files = Object.keys(zip.files);
  const topLevelDirs = [...new Set(files.map((f) => f.split("/")[0]))];
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
    const relativePath = path.replace(rootPrefix, "");

    if (relativePath.startsWith("agents/") && relativePath.endsWith(".md")) {
      const content = await zipFile.async("string");
      const parsed = matter(content);
      const agent: AgentConfig = {
        id: crypto.randomUUID(),
        name: parsed.data.name || relativePath.split("/").pop()!.replace(".md", ""),
        description: parsed.data.description || "",
        model: parsed.data.model || "inherit",
        tools: parsed.data.tools
          ? typeof parsed.data.tools === "string"
            ? parsed.data.tools.split(",").map((t: string) => t.trim())
            : parsed.data.tools
          : [],
        mcpServers: parsed.data.mcpServers || [],
        permissionMode: parsed.data.permissionMode || "default",
        maxTurns: parsed.data.maxTurns,
        background: parsed.data.background || false,
        memory: parsed.data.memory || "none",
        systemPrompt: parsed.content.trim(),
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
