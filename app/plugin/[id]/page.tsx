"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePluginStore } from "@/lib/plugin-store";
import { AgentConfig, SkillConfig, McpServer, AGENT_PRESETS } from "@/lib/plugin-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";

const FlowEditor = dynamic(() => import("@/components/flow-editor"), { ssr: false });
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type PanelType = { type: "agent"; id: string } | { type: "skill"; id: string } | { type: "mcp"; id: string } | null;

export default function PluginEditorPage() {
  const { id } = useParams();
  const router = useRouter();
  const { plugins, updatePlugin, addAgent, updateAgent, deleteAgent, addSkill, updateSkill, deleteSkill, addMcpServer, updateMcpServer, deleteMcpServer, exportToZip } = usePluginStore();
  const plugin = plugins.find((p) => p.id === id);
  const [activePanel, setActivePanel] = useState<PanelType>(null);

  if (!plugin) {
    return (
      <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-400 mb-4">Plugin not found</p>
          <Button onClick={() => router.push("/")} variant="outline" className="border-slate-700 text-slate-300">
            ← Back to home
          </Button>
        </div>
      </div>
    );
  }

  const selectedAgent = activePanel?.type === "agent" ? plugin.agents.find((a) => a.id === activePanel.id) : null;
  const selectedSkill = activePanel?.type === "skill" ? plugin.skills.find((s) => s.id === activePanel.id) : null;
  const selectedMcp = activePanel?.type === "mcp" ? plugin.mcpServers.find((m) => m.id === activePanel.id) : null;

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/")} className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
            ← Home
          </button>
          <span className="text-slate-700">/</span>
          <span className="text-slate-200 font-semibold">{plugin.manifest.name}</span>
          <Badge variant="outline" className="border-slate-700 text-slate-400 text-xs">v{plugin.manifest.version}</Badge>
        </div>
        <Button
          className="bg-[#00d2ff] text-slate-900 hover:bg-[#00b8e0] font-semibold text-sm"
          onClick={() => exportToZip(plugin.id)}
        >
          ↓ Export ZIP
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-slate-800 flex flex-col overflow-y-auto bg-slate-950/50">
          {/* Manifest */}
          <div className="p-4 border-b border-slate-800">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Manifest</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-500">Name</label>
                <Input
                  value={plugin.manifest.name}
                  onChange={(e) => updatePlugin(plugin.id, { manifest: { ...plugin.manifest, name: e.target.value } })}
                  className="mt-1 h-7 text-sm bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Version</label>
                <Input
                  value={plugin.manifest.version}
                  onChange={(e) => updatePlugin(plugin.id, { manifest: { ...plugin.manifest, version: e.target.value } })}
                  className="mt-1 h-7 text-sm bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Description</label>
                <Textarea
                  value={plugin.manifest.description || ""}
                  onChange={(e) => updatePlugin(plugin.id, { manifest: { ...plugin.manifest, description: e.target.value } })}
                  className="mt-1 text-sm bg-slate-800 border-slate-700 text-slate-100 resize-none h-16"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Author</label>
                <Input
                  value={plugin.manifest.author?.name || ""}
                  onChange={(e) => updatePlugin(plugin.id, { manifest: { ...plugin.manifest, author: { name: e.target.value } } })}
                  className="mt-1 h-7 text-sm bg-slate-800 border-slate-700 text-slate-100"
                  placeholder="Your name"
                />
              </div>
            </div>
          </div>

          {/* Agents */}
          <SidebarSection
            title="Agents"
            count={plugin.agents.length}
            onAdd={() => {
              const a = addAgent(plugin.id);
              setActivePanel({ type: "agent", id: a.id });
            }}
          >
            {plugin.agents.map((agent) => (
              <SidebarItem
                key={agent.id}
                label={agent.name}
                color="blue"
                active={activePanel?.type === "agent" && activePanel.id === agent.id}
                onClick={() => setActivePanel({ type: "agent", id: agent.id })}
                onDelete={() => { deleteAgent(plugin.id, agent.id); setActivePanel(null); }}
              />
            ))}
          </SidebarSection>

          {/* Skills */}
          <SidebarSection
            title="Skills"
            count={plugin.skills.length}
            onAdd={() => {
              const s = addSkill(plugin.id);
              setActivePanel({ type: "skill", id: s.id });
            }}
          >
            {plugin.skills.map((skill) => (
              <SidebarItem
                key={skill.id}
                label={skill.name}
                color="purple"
                active={activePanel?.type === "skill" && activePanel.id === skill.id}
                onClick={() => setActivePanel({ type: "skill", id: skill.id })}
                onDelete={() => { deleteSkill(plugin.id, skill.id); setActivePanel(null); }}
              />
            ))}
          </SidebarSection>

          {/* MCP Servers */}
          <SidebarSection
            title="MCP Servers"
            count={plugin.mcpServers.length}
            onAdd={() => {
              const m = addMcpServer(plugin.id);
              setActivePanel({ type: "mcp", id: m.id });
            }}
          >
            {plugin.mcpServers.map((server) => (
              <SidebarItem
                key={server.id}
                label={server.name}
                color="green"
                active={activePanel?.type === "mcp" && activePanel.id === server.id}
                onClick={() => setActivePanel({ type: "mcp", id: server.id })}
                onDelete={() => { deleteMcpServer(plugin.id, server.id); setActivePanel(null); }}
              />
            ))}
          </SidebarSection>
        </aside>

        {/* Main area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <Tabs defaultValue="flow" className="h-full flex flex-col">
              <div className="border-b border-slate-800 px-4">
                <TabsList className="bg-transparent border-0 h-10">
                  <TabsTrigger value="flow" className="text-slate-400 data-[state=active]:text-[#00d2ff] data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#00d2ff] rounded-none">
                    Flow
                  </TabsTrigger>
                  <TabsTrigger value="json" className="text-slate-400 data-[state=active]:text-[#00d2ff] data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#00d2ff] rounded-none">
                    JSON Preview
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="flow" className="flex-1 m-0 overflow-hidden">
                <FlowEditor
                  plugin={plugin}
                  onSelectAgent={(id) => setActivePanel({ type: "agent", id })}
                  selectedAgentId={activePanel?.type === "agent" ? activePanel.id : null}
                />
              </TabsContent>
              <TabsContent value="json" className="flex-1 m-0 overflow-hidden p-4">
                <MonacoEditor
                  height="100%"
                  language="json"
                  value={JSON.stringify(plugin, null, 2)}
                  theme="vs-dark"
                  options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right panel */}
          {activePanel && (
            <div className="w-96 border-l border-slate-800 overflow-y-auto bg-slate-950/50">
              {selectedAgent && (
                <AgentPanel
                  agent={selectedAgent}
                  mcpServers={plugin.mcpServers}
                  onChange={(updates) => updateAgent(plugin.id, selectedAgent.id, updates)}
                  onClose={() => setActivePanel(null)}
                />
              )}
              {selectedSkill && (
                <SkillPanel
                  skill={selectedSkill}
                  onChange={(updates) => updateSkill(plugin.id, selectedSkill.id, updates)}
                  onClose={() => setActivePanel(null)}
                />
              )}
              {selectedMcp && (
                <McpPanel
                  server={selectedMcp}
                  onChange={(updates) => updateMcpServer(plugin.id, selectedMcp.id, updates)}
                  onClose={() => setActivePanel(null)}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar helpers ────────────────────────────────────────────────────────

function SidebarSection({ title, count, onAdd, children }: {
  title: string; count: number; onAdd: () => void; children: React.ReactNode;
}) {
  return (
    <div className="p-4 border-b border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
        <button onClick={onAdd} className="text-slate-500 hover:text-[#00d2ff] text-lg leading-none transition-colors" title={`Add ${title.toLowerCase().slice(0, -1)}`}>+</button>
      </div>
      {count === 0 ? (
        <p className="text-xs text-slate-600 italic">None yet</p>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </div>
  );
}

function SidebarItem({ label, color, active, onClick, onDelete }: {
  label: string; color: "blue" | "purple" | "green"; active: boolean; onClick: () => void; onDelete: () => void;
}) {
  const colors = { blue: "bg-blue-500/20 text-blue-300", purple: "bg-purple-500/20 text-purple-300", green: "bg-green-500/20 text-green-300" };
  return (
    <div
      className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer group ${active ? "bg-slate-700" : "hover:bg-slate-800"}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${colors[color]}`} />
        <span className="text-sm text-slate-300 truncate">{label}</span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-sm"
      >×</button>
    </div>
  );
}

// ─── Agent Panel ─────────────────────────────────────────────────────────────

import { AVAILABLE_TOOLS } from "@/lib/plugin-types";

function AgentPanel({ agent, mcpServers, onChange, onClose }: {
  agent: AgentConfig;
  mcpServers: McpServer[];
  onChange: (u: Partial<AgentConfig>) => void;
  onClose: () => void;
}) {
  const toggleTool = (tool: string) => {
    const tools = agent.tools.includes(tool)
      ? agent.tools.filter((t) => t !== tool)
      : [...agent.tools, tool];
    onChange({ tools });
  };

  const applyPreset = (preset: keyof typeof AGENT_PRESETS) => {
    onChange(AGENT_PRESETS[preset]);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-100">Agent Editor</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
      </div>

      {/* Presets */}
      <div>
        <label className="text-xs text-slate-500 mb-2 block">Quick preset</label>
        <div className="flex gap-2">
          {(["orchestrator", "researcher", "worker"] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className="px-3 py-1 text-xs rounded border border-slate-700 text-slate-400 hover:border-[#00d2ff]/50 hover:text-[#00d2ff] transition-colors capitalize"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <Field label="Name">
        <Input value={agent.name} onChange={(e) => onChange({ name: e.target.value })} className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8" />
      </Field>

      <Field label="Description" hint="Claude uses this to decide when to delegate">
        <Textarea
          value={agent.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="bg-slate-800 border-slate-700 text-slate-100 text-sm resize-none h-20"
          placeholder="Describe when Claude should use this agent..."
        />
      </Field>

      <Field label="Model">
        <select
          value={agent.model}
          onChange={(e) => onChange({ model: e.target.value as AgentConfig["model"] })}
          className="w-full h-8 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm px-2"
        >
          {["inherit", "sonnet", "opus", "haiku"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>

      <Field label="Tools">
        <div className="flex flex-wrap gap-1.5 mt-1">
          {AVAILABLE_TOOLS.map((tool) => (
            <button
              key={tool}
              onClick={() => toggleTool(tool)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                agent.tools.includes(tool)
                  ? "border-[#00d2ff]/60 bg-[#00d2ff]/10 text-[#00d2ff]"
                  : "border-slate-700 text-slate-500 hover:border-slate-500"
              }`}
            >
              {tool}
            </button>
          ))}
        </div>
      </Field>

      <Field label="MCP Servers" hint="Select servers available to this agent">
        <div className="flex flex-wrap gap-1.5 mt-1">
          {mcpServers.length === 0 ? (
            <p className="text-xs text-slate-600">No MCP servers defined</p>
          ) : (
            mcpServers.map((srv) => (
              <button
                key={srv.id}
                onClick={() => {
                  const list = agent.mcpServers.includes(srv.name)
                    ? agent.mcpServers.filter((s) => s !== srv.name)
                    : [...agent.mcpServers, srv.name];
                  onChange({ mcpServers: list });
                }}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  agent.mcpServers.includes(srv.name)
                    ? "border-green-600/60 bg-green-600/10 text-green-400"
                    : "border-slate-700 text-slate-500 hover:border-slate-500"
                }`}
              >
                {srv.name}
              </button>
            ))
          )}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Permission Mode">
          <select
            value={agent.permissionMode || "default"}
            onChange={(e) => onChange({ permissionMode: e.target.value })}
            className="w-full h-8 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm px-2"
          >
            {["default", "acceptEdits", "dontAsk", "bypassPermissions", "plan"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Memory">
          <select
            value={agent.memory || "none"}
            onChange={(e) => onChange({ memory: e.target.value as AgentConfig["memory"] })}
            className="w-full h-8 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm px-2"
          >
            {["none", "user", "project", "local"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Max Turns">
          <Input
            type="number"
            value={agent.maxTurns || ""}
            onChange={(e) => onChange({ maxTurns: e.target.value ? parseInt(e.target.value) : undefined })}
            className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8"
            placeholder="unlimited"
          />
        </Field>
        <Field label="Background">
          <div className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={agent.background || false}
              onChange={(e) => onChange({ background: e.target.checked })}
              className="accent-[#00d2ff]"
            />
            <span className="text-sm text-slate-400">Run in background</span>
          </div>
        </Field>
      </div>

      <Field label="System Prompt">
        <div className="mt-1 rounded-lg overflow-hidden border border-slate-700 h-48">
          <MonacoEditor
            height="192px"
            language="markdown"
            value={agent.systemPrompt}
            onChange={(v) => onChange({ systemPrompt: v || "" })}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on", lineNumbers: "off" }}
          />
        </div>
      </Field>
    </div>
  );
}

// ─── Skill Panel ──────────────────────────────────────────────────────────────

function SkillPanel({ skill, onChange, onClose }: {
  skill: SkillConfig;
  onChange: (u: Partial<SkillConfig>) => void;
  onClose: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-100">Skill Editor</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
      </div>
      <Field label="Skill Name" hint="Becomes the folder name and command (e.g. /plugin:name)">
        <Input value={skill.name} onChange={(e) => onChange({ name: e.target.value })} className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8" />
      </Field>
      <Field label="Description" hint="When should Claude invoke this skill?">
        <Textarea
          value={skill.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className="bg-slate-800 border-slate-700 text-slate-100 text-sm resize-none h-16"
        />
      </Field>
      <Field label="Content (SKILL.md body)">
        <div className="mt-1 rounded-lg overflow-hidden border border-slate-700 h-72">
          <MonacoEditor
            height="288px"
            language="markdown"
            value={skill.content}
            onChange={(v) => onChange({ content: v || "" })}
            theme="vs-dark"
            options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }}
          />
        </div>
      </Field>
    </div>
  );
}

// ─── MCP Panel ────────────────────────────────────────────────────────────────

function McpPanel({ server, onChange, onClose }: {
  server: McpServer;
  onChange: (u: Partial<McpServer>) => void;
  onClose: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-100">MCP Server</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none">×</button>
      </div>
      <Field label="Server Name">
        <Input value={server.name} onChange={(e) => onChange({ name: e.target.value })} className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8" />
      </Field>
      <Field label="Type">
        <select
          value={server.type}
          onChange={(e) => onChange({ type: e.target.value as McpServer["type"] })}
          className="w-full h-8 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-sm px-2"
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </Field>
      {server.type === "stdio" ? (
        <>
          <Field label="Command">
            <Input value={server.command || ""} onChange={(e) => onChange({ command: e.target.value })} className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8" placeholder="npx" />
          </Field>
          <Field label="Args" hint="Space-separated">
            <Input
              value={(server.args || []).join(" ")}
              onChange={(e) => onChange({ args: e.target.value.split(" ").filter(Boolean) })}
              className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8"
              placeholder="-y @company/mcp-server"
            />
          </Field>
        </>
      ) : (
        <Field label="URL">
          <Input value={server.url || ""} onChange={(e) => onChange({ url: e.target.value })} className="bg-slate-800 border-slate-700 text-slate-100 text-sm h-8" placeholder="https://..." />
        </Field>
      )}
    </div>
  );
}

// ─── Field helper ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-slate-500 block mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-600 mb-1">{hint}</p>}
      {children}
    </div>
  );
}
