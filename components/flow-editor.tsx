"use client";

import { useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Handle,
  Position,
  NodeProps,
  MarkerType,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plugin, AgentConfig, SkillConfig, McpServer, CommandConfig } from "@/lib/plugin-types";

type AnyNodeData = Record<string, unknown>;

// ─── Inference ────────────────────────────────────────────────────────────────
// How Claude Code decides what's related — from the actual docs + real plugin analysis:
//
// EXPLICIT (highest confidence):
//   Agent.skills[] frontmatter  → agent→skill
//   Agent.mcpServers[] frontmatter → agent→MCP
//   Agent.tools "Agent(x,y)" → orchestrator→worker
//
// SEMI-EXPLICIT (command text patterns):
//   subagent_type: plugin:agent-name → command→agent
//   "email-personalization skill" exact string → command/agent→skill
//
// INFERRED (fuzzy text matching):
//   Agent description/system prompt contains skill key words → agent→skill
//   Agent description says "Apify MCP connector" → agent→mcp (if mcp name matches)
//
// Key insight: hyphenated names like "lead-qualification" WON'T match \b word boundaries
// Solution: match on word-parts (≥4 chars) AND/OR exact slugified version

// Try multiple strategies to find `name` in `text`
function mentionedIn(text: string, name: string): boolean {
  const lower = text.toLowerCase();
  const nameLower = name.toLowerCase();

  // 1. Exact match (e.g. "lead-qualifier" literally in text)
  if (lower.includes(nameLower)) return true;

  // 2. subagent_type: plugin:name or "sales:lead-qualifier"
  if (lower.includes(`:${nameLower}`)) return true;

  // 3. Space-separated version: "lead qualification" for "lead-qualification"
  const spaced = nameLower.replace(/-/g, " ");
  if (lower.includes(spaced)) return true;

  // 4. Word-part scoring: all significant parts (≥4 chars) must appear
  const parts = nameLower.split(/-/).filter((p) => p.length >= 4);
  if (parts.length >= 2 && parts.every((p) => lower.includes(p))) return true;

  // 5. If single word name, use word boundary
  if (!nameLower.includes("-")) {
    return new RegExp(`\\b${nameLower}\\b`, "i").test(text);
  }

  return false;
}

function findMentions(text: string, names: string[]): string[] {
  return names.filter((name) => mentionedIn(text, name));
}

interface Relations {
  commandSpawnsAgents: Map<string, string[]>;   // commandId → [agentName]
  commandUsesSkills: Map<string, string[]>;      // commandId → [skillName]
  agentSpawnsAgents: Map<string, string[]>;      // agentId → [agentName]
  agentUsesMcp: Map<string, string[]>;           // agentId → [mcpName]
  agentUsesSkill: Map<string, string[]>;         // agentId → [skillName]
}

function inferRelations(plugin: Plugin): Relations {
  const commandSpawnsAgents = new Map<string, string[]>();
  const commandUsesSkills = new Map<string, string[]>();
  const agentSpawnsAgents = new Map<string, string[]>();
  const agentUsesMcp = new Map<string, string[]>();
  const agentUsesSkill = new Map<string, string[]>();

  const agentNames = plugin.agents.map((a) => a.name);
  const skillNames = plugin.skills.map((s) => s.name);
  const mcpNames = plugin.mcpServers.map((m) => m.name);

  // Commands → agents and skills they reference
  for (const cmd of (plugin.commands || [])) {
    const spawned = findMentions(cmd.content, agentNames);
    if (spawned.length > 0) commandSpawnsAgents.set(cmd.id, spawned);

    // Commands can also directly reference skills
    const usedSkills = findMentions(cmd.content, skillNames);
    if (usedSkills.length > 0) commandUsesSkills.set(cmd.id, usedSkills);
  }

  for (const agent of plugin.agents) {
    const text = agent.systemPrompt + "\n" + agent.description;

    // Explicit: Agent(x,y) in tools
    const agentTool = agent.tools.find((t) => t.match(/^Agent\(/));
    if (agentTool) {
      const m = agentTool.match(/Agent\(([^)]+)\)/);
      if (m) agentSpawnsAgents.set(agent.id, m[1].split(",").map((t) => t.trim()));
    } else if (/orchestrat|spawn|sub.?agent|delegate|task tool/i.test(text)) {
      const mentioned = findMentions(text, agentNames).filter((n) => n !== agent.name);
      if (mentioned.length > 0) agentSpawnsAgents.set(agent.id, mentioned);
    }

    // MCP: explicit first, then inferred
    if (agent.mcpServers?.length > 0) {
      agentUsesMcp.set(agent.id, agent.mcpServers);
    } else {
      const mentioned = findMentions(text, mcpNames);
      if (mentioned.length > 0) agentUsesMcp.set(agent.id, mentioned);
    }

    // Skills: explicit first, then inferred
    const explicitSkills = (agent as AgentConfig & { skills?: string[] }).skills || [];
    if (explicitSkills.length > 0) {
      agentUsesSkill.set(agent.id, explicitSkills);
    } else {
      const mentioned = findMentions(text, skillNames);
      if (mentioned.length > 0) agentUsesSkill.set(agent.id, mentioned);
    }
  }

  return { commandSpawnsAgents, commandUsesSkills, agentSpawnsAgents, agentUsesMcp, agentUsesSkill };
}

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(
  plugin: Plugin,
  onSelectAgent: (id: string) => void,
  selectedAgentId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const rel = inferRelations(plugin);
  const commands = plugin.commands || [];
  const { commandUsesSkills } = rel;

  // Determine which agents are workers (spawned by something)
  const spawnedNames = new Set<string>();
  rel.commandSpawnsAgents.forEach((names) => names.forEach((n) => spawnedNames.add(n)));
  rel.agentSpawnsAgents.forEach((names) => names.forEach((n) => spawnedNames.add(n)));

  // Orchestrator agents = spawn others or are commands
  const orchestratorAgentIds = new Set(rel.agentSpawnsAgents.keys());

  // ── Column layout ──────────────────────────────────────────────────────────
  // | MCP (x=0) | Commands (x=240) | Orchestrator Agents (x=500) | Worker Agents (x=760) | Skills (x=1020) |
  // If no commands: shift everything left
  // If no orchestrators: merge into one agent column

  const hasCmds = commands.length > 0;
  const hasOrchAgents = orchestratorAgentIds.size > 0;
  const hasWorkers = plugin.agents.some((a) => spawnedNames.has(a.name));

  const COL_MCP      = 0;
  const COL_CMD      = plugin.mcpServers.length > 0 ? 220 : 0;
  const COL_ORCH     = COL_CMD + (hasCmds ? 260 : 0);
  const COL_WORKER   = COL_ORCH + (hasOrchAgents || hasCmds ? 270 : 0);
  const COL_SKILL    = COL_WORKER + (hasWorkers || hasOrchAgents ? 270 : 260);

  const VGAP_AGENT   = 170;
  const VGAP_SMALL   = 130;

  // ── MCP nodes ──────────────────────────────────────────────────────────────
  plugin.mcpServers.forEach((server, i) => {
    nodes.push({
      id: `mcp-${server.id}`,
      type: "mcpNode",
      position: { x: COL_MCP, y: i * VGAP_SMALL + 80 },
      data: { server },
    });
  });

  // ── Command nodes (entry points) ──────────────────────────────────────────
  commands.forEach((cmd, i) => {
    nodes.push({
      id: `cmd-${cmd.id}`,
      type: "commandNode",
      position: { x: COL_CMD, y: i * VGAP_SMALL + 40 },
      data: { cmd },
    });
  });

  // ── Agent nodes ────────────────────────────────────────────────────────────
  const orchAgents = plugin.agents.filter((a) => orchestratorAgentIds.has(a.id) && !spawnedNames.has(a.name));
  const workerAgents = plugin.agents.filter((a) => spawnedNames.has(a.name));
  const soloAgents = plugin.agents.filter(
    (a) => !orchestratorAgentIds.has(a.id) && !spawnedNames.has(a.name)
  );

  // Place orch agents
  const xOrch = (hasCmds || plugin.mcpServers.length > 0) ? COL_ORCH : COL_ORCH;
  [...orchAgents, ...soloAgents].forEach((agent, i) => {
    nodes.push({
      id: `agent-${agent.id}`,
      type: "agentNode",
      position: { x: xOrch, y: i * VGAP_AGENT + 40 },
      data: { agent, isOrchestrator: orchestratorAgentIds.has(agent.id), onClick: onSelectAgent, selected: agent.id === selectedAgentId },
      selected: agent.id === selectedAgentId,
    });
  });

  // Place worker agents
  workerAgents.forEach((agent, i) => {
    nodes.push({
      id: `agent-${agent.id}`,
      type: "agentNode",
      position: { x: COL_WORKER, y: i * VGAP_AGENT + 40 },
      data: { agent, isOrchestrator: false, onClick: onSelectAgent, selected: agent.id === selectedAgentId },
      selected: agent.id === selectedAgentId,
    });
  });

  // ── Skill nodes ────────────────────────────────────────────────────────────
  plugin.skills.forEach((skill, i) => {
    nodes.push({
      id: `skill-${skill.id}`,
      type: "skillNode",
      position: { x: COL_SKILL, y: i * VGAP_SMALL + 40 },
      data: { skill },
    });
  });

  // ── Edges ──────────────────────────────────────────────────────────────────

  // Command → Agent (spawns)
  rel.commandSpawnsAgents.forEach((agentNames, cmdId) => {
    agentNames.forEach((agentName) => {
      const agent = plugin.agents.find((a) => a.name === agentName || agentName.includes(a.name) || a.name.includes(agentName));
      if (agent) {
        edges.push({
          id: `cmd-agent-${cmdId}-${agent.id}`,
          source: `cmd-${cmdId}`,
          target: `agent-${agent.id}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          animated: true,
          label: "spawns",
          labelStyle: { fill: "#f97316", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          style: { stroke: "#f97316", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#f97316", width: 16, height: 16 },
        });
      }
    });
  });

  // Agent → Agent (spawns)
  rel.agentSpawnsAgents.forEach((targetNames, sourceId) => {
    targetNames.forEach((targetName) => {
      const target = plugin.agents.find((a) => a.name === targetName || targetName.includes(a.name) || a.name.includes(targetName));
      if (target) {
        edges.push({
          id: `agent-agent-${sourceId}-${target.id}`,
          source: `agent-${sourceId}`,
          target: `agent-${target.id}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          animated: true,
          label: "delegates",
          labelStyle: { fill: "#00d2ff", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          style: { stroke: "#00d2ff", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#00d2ff", width: 16, height: 16 },
        });
      }
    });
  });

  // MCP → Agent
  rel.agentUsesMcp.forEach((mcpNames, agentId) => {
    mcpNames.forEach((mcpName) => {
      const mcp = plugin.mcpServers.find((m) => m.name === mcpName);
      if (mcp) {
        edges.push({
          id: `mcp-${mcp.id}-${agentId}`,
          source: `mcp-${mcp.id}`,
          target: `agent-${agentId}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          label: "tools",
          labelStyle: { fill: "#4ade80", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          style: { stroke: "#4ade80", strokeWidth: 1.5, strokeDasharray: "5 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#4ade80", width: 14, height: 14 },
        });
      }
    });
  });

  // Command → Skill (command text references a skill explicitly)
  commandUsesSkills.forEach((skillNameList, cmdId) => {
    skillNameList.forEach((skillName) => {
      const skill = plugin.skills.find((s) => mentionedIn(skillName, s.name) || mentionedIn(s.name, skillName));
      if (skill) {
        edges.push({
          id: `cmd-skill-${cmdId}-${skill.id}`,
          source: `cmd-${cmdId}`,
          target: `skill-${skill.id}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          label: "uses skill",
          labelStyle: { fill: "#c084fc", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          style: { stroke: "#c084fc", strokeWidth: 1.5, strokeDasharray: "5 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#c084fc", width: 14, height: 14 },
        });
      }
    });
  });

  // Agent → Skill
  rel.agentUsesSkill.forEach((skillNames, agentId) => {
    skillNames.forEach((skillName) => {
      const skill = plugin.skills.find((s) => s.name === skillName || skillName.includes(s.name) || s.name.includes(skillName));
      if (skill) {
        edges.push({
          id: `skill-${agentId}-${skill.id}`,
          source: `agent-${agentId}`,
          target: `skill-${skill.id}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          label: "uses",
          labelStyle: { fill: "#c084fc", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          style: { stroke: "#c084fc", strokeWidth: 1.5, strokeDasharray: "5 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#c084fc", width: 14, height: 14 },
        });
      }
    });
  });

  return { nodes, edges };
}

// ─── Node: Command ────────────────────────────────────────────────────────────

function CommandNode({ data }: NodeProps) {
  const { cmd } = data as { cmd: CommandConfig };
  return (
    <div className="rounded-xl border-2 border-orange-500/80 bg-orange-950/40 w-[185px] shadow-lg shadow-orange-500/10">
      <Handle type="target" position={Position.Left} id="left"
        style={{ background: "#f97316", width: 10, height: 10, border: "2px solid #0f172a" }} />
      <Handle type="source" position={Position.Right} id="right"
        style={{ background: "#f97316", width: 10, height: 10, border: "2px solid #0f172a" }} />
      <div className="px-3 py-2 border-b border-orange-800/40 bg-orange-900/20 rounded-t-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">⚡</span>
          <span className="font-semibold text-orange-200 text-xs truncate">/{cmd.name}</span>
        </div>
        <span className="text-xs text-orange-500">entry point</span>
      </div>
      <div className="px-3 py-2">
        {cmd.description && (
          <p className="text-xs text-orange-400/70 line-clamp-2 leading-tight">{cmd.description}</p>
        )}
        {cmd.argumentHint && (
          <span className="text-xs font-mono text-orange-600 mt-1 block">{cmd.argumentHint}</span>
        )}
      </div>
    </div>
  );
}

// ─── Node: Agent ─────────────────────────────────────────────────────────────

function AgentNode({ data }: NodeProps) {
  const { agent, isOrchestrator, onClick, selected } = data as {
    agent: AgentConfig; isOrchestrator: boolean; onClick: (id: string) => void; selected: boolean;
  };
  const modelBadge: Record<string, string> = {
    sonnet: "bg-blue-900/60 text-blue-300",
    opus: "bg-purple-900/60 text-purple-300",
    haiku: "bg-green-900/60 text-green-300",
    inherit: "bg-slate-700 text-slate-400",
  };
  return (
    <div
      className={`rounded-xl border-2 cursor-pointer transition-all w-[200px] ${
        isOrchestrator
          ? "bg-[#001d26] border-[#00d2ff] shadow-xl shadow-[#00d2ff]/15"
          : "bg-slate-800/90 border-slate-600 hover:border-slate-400"
      } ${selected ? "ring-2 ring-white/30" : ""}`}
      onClick={() => onClick(agent.id)}
    >
      <Handle type="target" position={Position.Left} id="left"
        style={{ background: isOrchestrator ? "#00d2ff" : "#64748b", width: 10, height: 10, border: "2px solid #0f172a" }} />
      <Handle type="source" position={Position.Right} id="right"
        style={{ background: isOrchestrator ? "#00d2ff" : "#64748b", width: 10, height: 10, border: "2px solid #0f172a" }} />
      <div className={`px-3 py-2 rounded-t-[10px] border-b ${
        isOrchestrator ? "bg-[#00d2ff]/10 border-[#00d2ff]/25" : "bg-slate-700/40 border-slate-700"
      }`}>
        <div className="flex items-center gap-2">
          <span>{isOrchestrator ? "🎯" : "🤖"}</span>
          <span className="font-semibold text-sm text-slate-100 truncate">{agent.name}</span>
        </div>
        {isOrchestrator && <span className="text-xs text-[#00d2ff]/70 font-medium">orchestrator</span>}
      </div>
      <div className="px-3 py-2 space-y-1.5">
        {agent.description && (
          <p className="text-xs text-slate-400 line-clamp-2 leading-tight">{agent.description}</p>
        )}
        <div className="flex flex-wrap gap-1 pt-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${modelBadge[agent.model] || modelBadge.inherit}`}>
            {agent.model}
          </span>
          {agent.tools.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
              {agent.tools.length}t
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Node: Skill ──────────────────────────────────────────────────────────────

function SkillNode({ data }: NodeProps) {
  const { skill } = data as { skill: SkillConfig };
  return (
    <div className="rounded-xl border border-purple-700/60 bg-purple-950/40 w-[175px]">
      <Handle type="target" position={Position.Left} id="left"
        style={{ background: "#c084fc", width: 10, height: 10, border: "2px solid #0f172a" }} />
      <div className="px-3 py-2 border-b border-purple-800/40 bg-purple-900/20 rounded-t-[10px]">
        <div className="flex items-center gap-1.5">
          <span>📚</span>
          <span className="font-medium text-purple-200 text-xs truncate">{skill.name}</span>
        </div>
        <span className="text-xs text-purple-500">skill</span>
      </div>
      {skill.description && (
        <div className="px-3 py-2">
          <p className="text-xs text-purple-400/70 line-clamp-3 leading-tight">{skill.description}</p>
        </div>
      )}
    </div>
  );
}

// ─── Node: MCP ────────────────────────────────────────────────────────────────

function McpNode({ data }: NodeProps) {
  const { server } = data as { server: McpServer };
  return (
    <div className="rounded-xl border border-green-700/60 bg-green-950/40 w-[165px]">
      <Handle type="source" position={Position.Right} id="right"
        style={{ background: "#4ade80", width: 10, height: 10, border: "2px solid #0f172a" }} />
      <div className="px-3 py-2 border-b border-green-800/40 bg-green-900/20 rounded-t-[10px]">
        <div className="flex items-center gap-1.5">
          <span>🔌</span>
          <span className="font-medium text-green-200 text-xs truncate">{server.name}</span>
        </div>
        <span className="text-xs text-green-500">MCP server</span>
      </div>
      <div className="px-3 py-2">
        <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 font-mono">{server.type}</span>
      </div>
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode, skillNode: SkillNode, mcpNode: McpNode, commandNode: CommandNode };

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FlowEditor({
  plugin, onSelectAgent, selectedAgentId,
}: {
  plugin: Plugin; onSelectAgent: (id: string) => void; selectedAgentId: string | null;
}) {
  const { nodes: init, edges: initEdges } = buildGraph(plugin, onSelectAgent, selectedAgentId);
  const [nodes, setNodes, onNodesChange] = useNodesState(init);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(plugin, onSelectAgent, selectedAgentId);
    setNodes(n); setEdges(e);
  }, [plugin, selectedAgentId, onSelectAgent, setNodes, setEdges]);

  const isEmpty = !plugin.agents.length && !plugin.skills.length && !plugin.mcpServers.length && !(plugin.commands || []).length;

  if (isEmpty) return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <p className="text-5xl mb-4">🕸️</p>
        <p className="text-slate-400 mb-1 font-medium">Flow is empty</p>
        <p className="text-slate-600 text-sm">Add agents, skills, MCP servers, or import a plugin ZIP</p>
      </div>
    </div>
  );

  return (
    <div className="w-full h-full">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.15} maxZoom={2}
        proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={24} size={1.5} />
        <Controls showInteractive={false} style={{ background: "#1e293b", borderColor: "#334155" }} />
        <MiniMap nodeColor={(n) => {
          if (n.type === "mcpNode") return "#4ade80";
          if (n.type === "skillNode") return "#c084fc";
          if (n.type === "commandNode") return "#f97316";
          return (n.data as AnyNodeData)?.isOrchestrator ? "#00d2ff" : "#475569";
        }} maskColor="rgba(10,15,30,0.85)" style={{ background: "#0f172a", border: "1px solid #1e293b" }} />

        <Panel position="top-right">
          <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3 backdrop-blur-sm shadow-xl min-w-[200px]">
            <p className="text-xs font-bold text-slate-300 mb-3">How Claude reads this plugin</p>
            <div className="space-y-2 mb-3">
              <Row emoji="⚡" color="text-orange-400" label="Entry point" desc="User types /command" />
              <Row emoji="🎯" color="text-[#00d2ff]" label="Orchestrator" desc="Spawns sub-agents" />
              <Row emoji="🤖" color="text-slate-300" label="Worker agent" desc="Does the actual work" />
              <Row emoji="🔌" color="text-green-400" label="MCP server" desc="External tools" />
              <Row emoji="📚" color="text-purple-400" label="Skill" desc="Knowledge/context injected" />
            </div>
            <div className="border-t border-slate-700 pt-2.5 space-y-1.5">
              <EdgeRow color="#f97316" label="spawns" solid />
              <EdgeRow color="#00d2ff" label="delegates to" solid />
              <EdgeRow color="#4ade80" label="provides tools" dashed />
              <EdgeRow color="#c084fc" label="loads knowledge" dashed />
            </div>
            <p className="text-xs text-slate-600 mt-2.5 leading-tight">
              Links auto-detected from agent names, descriptions & system prompts
            </p>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function Row({ emoji, color, label, desc }: { emoji: string; color: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-sm w-5 shrink-0">{emoji}</span>
      <div>
        <span className={`text-xs font-semibold ${color}`}>{label}</span>
        <p className="text-xs text-slate-500 leading-tight">{desc}</p>
      </div>
    </div>
  );
}

function EdgeRow({ color, label, solid, dashed }: { color: string; label: string; solid?: boolean; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="30" height="12" className="shrink-0">
        <line x1="0" y1="6" x2="22" y2="6" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 2" : undefined} />
        <polygon points="22,3 30,6 22,9" fill={color} />
      </svg>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}
