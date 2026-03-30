import JSZip from "jszip";
import matter from "gray-matter";
import { Plugin, AgentConfig, SkillConfig, McpServer, CommandConfig } from "./plugin-types";

// ─── Robust agent frontmatter parser ────────────────────────────────────────
// Real-world agent files often have:
//   - <example> XML blocks inside the YAML section (invalid YAML → gray-matter crashes)
//   - tools as JSON array: ["Read", "Write"]  (should be string: Read, Write)
//   - multiline description values
// We strip XML first, then parse line-by-line.

function parseAgentFile(
  content: string,
  fallbackName: string
): { data: Record<string, unknown>; body: string } {
  // Split on the frontmatter delimiters
  // Match: ---\n<frontmatter>\n---\n<body>
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    // No frontmatter at all — whole file is body
    return { data: { name: fallbackName }, body: content.trim() };
  }

  const rawFm = match[1];
  const body = match[2].trim();

  // Strip XML/HTML blocks (e.g. <example>...</example>) — they break YAML parsing
  const cleanFm = rawFm
    .replace(/<\w[^>]*>[\s\S]*?<\/\w[^>]*>/g, "")
    .replace(/<[^>]+\/>/g, "")
    .replace(/^\s*[\r\n]/gm, "") // remove blank lines left by XML removal
    .trim();

  // Try gray-matter on the cleaned frontmatter
  try {
    const rebuilt = `---\n${cleanFm}\n---\n${body}`;
    const parsed = matter(rebuilt);
    if (parsed.data && Object.keys(parsed.data).length > 0) {
      return { data: parsed.data, body: parsed.content.trim() };
    }
  } catch {
    // fall through to line-by-line
  }

  // Line-by-line YAML parser (handles simple key: value pairs)
  const data: Record<string, unknown> = { name: fallbackName };
  let currentKey = "";
  let currentValue = "";

  const flush = () => {
    if (!currentKey) return;
    const v = currentValue.trim();
    // Try to parse as JSON (handles arrays like ["Read","Write"])
    if (v.startsWith("[") || v.startsWith("{")) {
      try {
        data[currentKey] = JSON.parse(v);
        return;
      } catch { /* keep as string */ }
    }
    data[currentKey] = v;
  };

  for (const line of cleanFm.split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (kv) {
      flush();
      currentKey = kv[1];
      currentValue = kv[2];
    } else if (currentKey && /^\s{2}/.test(line)) {
      currentValue += " " + line.trim();
    }
  }
  flush();

  return { data, body };
}

function normalizeTools(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    // Could be "Read, Write, Bash" or '["Read","Write"]'
    const s = raw.trim();
    if (s.startsWith("[")) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.map(String);
      } catch { /* fall through */ }
    }
    return s.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

// ─── Export ──────────────────────────────────────────────────────────────────

export async function exportPluginToZip(plugin: Plugin): Promise<Blob> {
  const zip = new JSZip();
  const root = zip.folder(plugin.manifest.name)!;

  // .claude-plugin/plugin.json
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
      const fm: Record<string, unknown> = {
        name: agent.name,
        description: agent.description,
        model: agent.model,
      };
      if (agent.tools.length > 0) fm.tools = agent.tools.join(", ");
      if (agent.mcpServers.length > 0) fm.mcpServers = agent.mcpServers;
      if (agent.permissionMode && agent.permissionMode !== "default")
        fm.permissionMode = agent.permissionMode;
      if (agent.maxTurns) fm.maxTurns = agent.maxTurns;
      if (agent.background) fm.background = agent.background;
      if (agent.memory && agent.memory !== "none") fm.memory = agent.memory;

      const fileContent = matter.stringify(agent.systemPrompt || "", fm);
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
        if (server.args?.length) serverConfig.args = server.args;
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

// ─── Import ──────────────────────────────────────────────────────────────────

export async function importPluginFromZip(file: File): Promise<Partial<Plugin>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    throw new Error(`Cannot read ZIP file: ${e}`);
  }

  const result: Partial<Plugin> = {
    agents: [],
    skills: [],
    mcpServers: [],
    commands: [],
    manifest: { name: "", version: "1.0.0" },
  };

  const allFiles = Object.keys(zip.files);

  // Detect root folder (ignore __MACOSX and hidden)
  const topLevelDirs = [
    ...new Set(
      allFiles
        .map((f) => f.split("/")[0])
        .filter((d) => d !== "__MACOSX" && !d.startsWith(".") && d !== "")
    ),
  ];
  const rootPrefix = topLevelDirs.length === 1 ? topLevelDirs[0] + "/" : "";

  for (const [path, zipFile] of Object.entries(zip.files)) {
    // Skip dirs, macOS metadata, hidden resource forks
    if (zipFile.dir) continue;
    if (path.startsWith("__MACOSX/")) continue;
    if (path.includes("/._")) continue;

    const rel = rootPrefix ? path.replace(rootPrefix, "") : path;
    if (!rel || rel.startsWith("__MACOSX")) continue;

    // ── plugin.json ──────────────────────────────────────────────────────────
    if (rel === ".claude-plugin/plugin.json" || rel === "plugin.json") {
      try {
        const content = await zipFile.async("string");
        result.manifest = JSON.parse(content);
      } catch { /* ignore malformed manifest */ }
      continue;
    }

    // ── agents/*.md ──────────────────────────────────────────────────────────
    if (rel.startsWith("agents/") && rel.endsWith(".md") && rel.split("/").length === 2) {
      const fallbackName = rel.split("/")[1].replace(".md", "");
      try {
        const content = await zipFile.async("string");
        const { data, body } = parseAgentFile(content, fallbackName);

        const agent: AgentConfig = {
          id: crypto.randomUUID(),
          name: String(data.name ?? fallbackName),
          description: String(data.description ?? ""),
          model: (data.model as AgentConfig["model"]) ?? "inherit",
          tools: normalizeTools(data.tools),
          mcpServers: Array.isArray(data.mcpServers)
            ? (data.mcpServers as string[])
            : [],
          skills: Array.isArray(data.skills) ? (data.skills as string[]) : [],
          permissionMode: String(data.permissionMode ?? "default"),
          maxTurns: data.maxTurns != null ? Number(data.maxTurns) : undefined,
          background: Boolean(data.background),
          memory: (data.memory as AgentConfig["memory"]) ?? "none",
          systemPrompt: body,
        };
        result.agents!.push(agent);
      } catch (e) {
        console.warn(`Skipping agent ${rel}:`, e);
      }
      continue;
    }

    // ── skills/<name>/SKILL.md ───────────────────────────────────────────────
    if (rel.match(/^skills\/[^/]+\/SKILL\.md$/)) {
      const skillName = rel.split("/")[1];
      try {
        const content = await zipFile.async("string");
        let description = "";
        let body = content;
        try {
          const parsed = matter(content);
          description = String(parsed.data.description ?? "");
          body = parsed.content.trim();
        } catch { /* ignore */ }

        const skill: SkillConfig = {
          id: crypto.randomUUID(),
          name: skillName,
          description,
          content: body,
        };
        result.skills!.push(skill);
      } catch (e) {
        console.warn(`Skipping skill ${rel}:`, e);
      }
      continue;
    }

    // ── commands/*.md ────────────────────────────────────────────────────────
    // Commands are slash-commands / orchestrator entry points
    if (rel.match(/^commands\/[^/]+\.md$/) && !rel.includes("/._")) {
      const cmdName = rel.split("/")[1].replace(".md", "");
      try {
        const content = await zipFile.async("string");
        // Parse frontmatter if present
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        let description = "";
        let body = content;
        let argumentHint: string | undefined;
        let allowedTools: string[] | undefined;

        if (match) {
          body = match[2].trim();
          // simple key: value parse
          for (const line of match[1].split(/\r?\n/)) {
            const kv = line.match(/^([a-zA-Z_-]+):\s*(.+)$/);
            if (kv) {
              if (kv[1] === "description") description = kv[2].trim();
              if (kv[1] === "argument-hint") argumentHint = kv[2].trim();
              if (kv[1] === "allowed-tools") allowedTools = kv[2].split(",").map(t => t.trim());
            }
          }
        }

        const cmd: CommandConfig = {
          id: crypto.randomUUID(),
          name: cmdName,
          description: description || `/${cmdName} command`,
          content: body,
          argumentHint,
          allowedTools,
        };
        result.commands!.push(cmd);
      } catch (e) {
        console.warn(`Skipping command ${rel}:`, e);
      }
      continue;
    }

    // ── .mcp.json ─────────────────────────────────────────────────────────────
    if (rel === ".mcp.json") {
      try {
        const content = await zipFile.async("string");
        const mcpConfig = JSON.parse(content);
        const servers = mcpConfig.mcpServers ?? {};
        for (const [name, cfg] of Object.entries(servers) as [string, Record<string, unknown>][]) {
          const server: McpServer = {
            id: crypto.randomUUID(),
            name,
            type: cfg.command ? "stdio" : "http",
            command: cfg.command as string | undefined,
            args: cfg.args as string[] | undefined,
            url: cfg.url as string | undefined,
            env: (cfg.env as Record<string, string>) ?? {},
          };
          result.mcpServers!.push(server);
        }
      } catch { /* ignore */ }
      continue;
    }
  }

  // Fallback: use ZIP filename as plugin name if manifest had none
  if (!result.manifest?.name) {
    result.manifest = {
      ...result.manifest,
      name: file.name.replace(/\.zip$/i, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
      version: "1.0.0",
    };
  }

  return result;
}
