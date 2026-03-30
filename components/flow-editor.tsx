"use client";

import { useCallback, useEffect, useRef } from "react";
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
import { Plugin, AgentConfig, SkillConfig, McpServer } from "@/lib/plugin-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnyNodeData = Record<string, unknown>;

// ─── Inference: build relationships from system prompt text ──────────────────

function inferRelationships(plugin: Plugin): {
  agentSpawns: Map<string, string[]>;       // orchestratorId → [workerName]
  agentUsesMcp: Map<string, string[]>;      // agentId → [mcpName]
  agentUsesSkill: Map<string, string[]>;    // agentId → [skillName]
  commandSpawns: Map<string, string[]>;     // commandName → [agentName]
} {
  const agentSpawns = new Map<string, string[]>();
  const agentUsesMcp = new Map<string, string[]>();
  const agentUsesSkill = new Map<string, string[]>();
  const commandSpawns = new Map<string, string[]>();

  const agentNames = plugin.agents.map((a) => a.name);
  const skillNames = plugin.skills.map((s) => s.name);
  const mcpNames = plugin.mcpServers.map((m) => m.name);

  // Helper: find all agent/skill/mcp names mentioned in a text block
  function findMentions(text: string, names: string[]): string[] {
    return names.filter((name) => {
      const escaped = name.replace(/[-]/g, "[-_]?");
      return new RegExp(`\\b${escaped}\\b`, "i").test(text);
    });
  }

  // Analyze each agent's system prompt
  for (const agent of plugin.agents) {
    const text = agent.systemPrompt + " " + agent.description;
    const isOrchestrator = agent.tools.some((t) => t.startsWith("Agent")) ||
      /orchestrat|spawn|sub.?agent|delegate|task tool/i.test(text);

    if (isOrchestrator) {
      // Check explicit Agent(...) in tools
      const agentTool = agent.tools.find((t) => t.match(/^Agent\(/));
      if (agentTool) {
        const m = agentTool.match(/Agent\(([^)]+)\)/);
        if (m) {
          agentSpawns.set(agent.id, m[1].split(",").map((t) => t.trim()));
        }
      } else {
        // Infer from system prompt mentions
        const mentioned = findMentions(text, agentNames).filter((n) => n !== agent.name);
        if (mentioned.length > 0) agentSpawns.set(agent.id, mentioned);
      }
    }

    // Explicit mcpServers field
    if (agent.mcpServers.length > 0) {
      agentUsesMcp.set(agent.id, agent.mcpServers);
    } else {
      // Infer from prompt
      const mentioned = findMentions(text, mcpNames);
      if (mentioned.length > 0) agentUsesMcp.set(agent.id, mentioned);
    }

    // Explicit skills field
    const agentSkills = (agent as AgentConfig & { skills?: string[] }).skills || [];
    if (agentSkills.length > 0) {
      agentUsesSkill.set(agent.id, agentSkills);
    } else {
      // Infer from prompt
      const mentioned = findMentions(text, skillNames);
      if (mentioned.length > 0) agentUsesSkill.set(agent.id, mentioned);
    }
  }

  // Analyze commands (stored in plugin.hooks as a convention — or we derive from agent descriptions)
  // Commands that mention agent names → they spawn those agents
  // (commands are not stored as full objects yet, but we can look at agent descriptions for "spawned by")

  return { agentSpawns, agentUsesMcp, agentUsesSkill, commandSpawns };
}

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(
  plugin: Plugin,
  onSelectAgent: (id: string) => void,
  selectedAgentId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const { agentSpawns, agentUsesMcp, agentUsesSkill } = inferRelationships(plugin);

  // Identify orchestrators vs workers
  const orchestratorIds = new Set(agentSpawns.keys());
  // Also mark agents that ARE targets of spawning
  const workerNames = new Set<string>();
  agentSpawns.forEach((targets) => targets.forEach((t) => workerNames.add(t)));

  // ── Layout constants ───────────────────────────────────────────────────────
  // Columns: MCP (x=0) | Orchestrators (x=260) | Workers (x=560) | Skills (x=860)
  // If no orchestrator separation needed, all agents go in center

  const orchestrators = plugin.agents.filter((a) => orchestratorIds.has(a.id));
  const workers = plugin.agents.filter((a) => !orchestratorIds.has(a.id));
  const hasOrchestratorSplit = orchestrators.length > 0 && workers.length > 0;

  const COL_MCP = 0;
  const COL_ORCH = hasOrchestratorSplit ? 260 : 280;
  const COL_WORKER = hasOrchestratorSplit ? 580 : 280;
  const COL_SKILL = hasOrchestratorSplit ? 880 : 560;

  const VGAP = 160;
  const MCP_GAP = 130;
  const SKILL_GAP = 130;

  // ── MCP nodes ──────────────────────────────────────────────────────────────
  plugin.mcpServers.forEach((server, i) => {
    nodes.push({
      id: `mcp-${server.id}`,
      type: "mcpNode",
      position: { x: COL_MCP, y: i * MCP_GAP + 40 },
      data: { server },
    });
  });

  // ── Orchestrator agent nodes ───────────────────────────────────────────────
  orchestrators.forEach((agent, i) => {
    nodes.push({
      id: `agent-${agent.id}`,
      type: "agentNode",
      position: { x: COL_ORCH, y: i * VGAP + 40 },
      data: {
        agent,
        isOrchestrator: true,
        onClick: onSelectAgent,
        selected: agent.id === selectedAgentId,
      },
      selected: agent.id === selectedAgentId,
    });
  });

  // ── Worker / solo agent nodes ──────────────────────────────────────────────
  const soloAgents = hasOrchestratorSplit ? workers : plugin.agents;
  soloAgents.forEach((agent, i) => {
    const isOrchestrator = orchestratorIds.has(agent.id);
    nodes.push({
      id: `agent-${agent.id}`,
      type: "agentNode",
      position: { x: COL_WORKER, y: i * VGAP + 40 },
      data: {
        agent,
        isOrchestrator,
        onClick: onSelectAgent,
        selected: agent.id === selectedAgentId,
      },
      selected: agent.id === selectedAgentId,
    });
  });

  // ── Skill nodes ────────────────────────────────────────────────────────────
  plugin.skills.forEach((skill, i) => {
    nodes.push({
      id: `skill-${skill.id}`,
      type: "skillNode",
      position: { x: COL_SKILL, y: i * SKILL_GAP + 40 },
      data: { skill },
    });
  });

  // ── Edges: Orchestrator → Worker ───────────────────────────────────────────
  agentSpawns.forEach((targetNames, sourceId) => {
    targetNames.forEach((targetName, idx) => {
      const target = plugin.agents.find(
        (a) => a.name === targetName || a.name.includes(targetName) || targetName.includes(a.name)
      );
      if (target) {
        edges.push({
          id: `spawn-${sourceId}-${target.id}`,
          source: `agent-${sourceId}`,
          target: `agent-${target.id}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          animated: true,
          label: "spawns",
          labelStyle: { fill: "#00d2ff", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.8 },
          style: { stroke: "#00d2ff", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#00d2ff", width: 16, height: 16 },
        });
      }
    });
  });

  // ── Edges: MCP → Agent ────────────────────────────────────────────────────
  agentUsesMcp.forEach((mcpNames, agentId) => {
    mcpNames.forEach((mcpName) => {
      const mcp = plugin.mcpServers.find((m) => m.name === mcpName);
      if (mcp) {
        edges.push({
          id: `mcp-edge-${mcp.id}-${agentId}`,
          source: `mcp-${mcp.id}`,
          target: `agent-${agentId}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          label: "tools",
          labelStyle: { fill: "#4ade80", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.8 },
          style: { stroke: "#4ade80", strokeWidth: 1.5, strokeDasharray: "5 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#4ade80", width: 14, height: 14 },
        });
      }
    });
  });

  // ── Edges: Agent → Skill ──────────────────────────────────────────────────
  agentUsesSkill.forEach((skillNames, agentId) => {
    skillNames.forEach((skillName) => {
      const skill = plugin.skills.find(
        (s) => s.name === skillName || s.name.includes(skillName) || skillName.includes(s.name)
      );
      if (skill) {
        edges.push({
          id: `skill-edge-${agentId}-${skill.id}`,
          source: `agent-${agentId}`,
          target: `skill-${skill.id}`,
          sourceHandle: "right",
          targetHandle: "left",
          type: "smoothstep",
          label: "context",
          labelStyle: { fill: "#c084fc", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.8 },
          style: { stroke: "#c084fc", strokeWidth: 1.5, strokeDasharray: "5 3" },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#c084fc", width: 14, height: 14 },
        });
      }
    });
  });

  return { nodes, edges };
}

// ─── Node: Agent ─────────────────────────────────────────────────────────────

function AgentNode({ data }: NodeProps) {
  const { agent, isOrchestrator, onClick, selected } = data as {
    agent: AgentConfig;
    isOrchestrator: boolean;
    onClick: (id: string) => void;
    selected: boolean;
  };

  const modelBadge: Record<string, string> = {
    sonnet: "bg-blue-900/60 text-blue-300",
    opus: "bg-purple-900/60 text-purple-300",
    haiku: "bg-green-900/60 text-green-300",
    inherit: "bg-slate-700 text-slate-400",
  };

  return (
    <div
      className={`rounded-xl border-2 cursor-pointer transition-all select-none w-[200px] ${
        isOrchestrator
          ? "bg-[#001d26] border-[#00d2ff] shadow-xl shadow-[#00d2ff]/20"
          : "bg-slate-800/90 border-slate-600 hover:border-slate-400"
      } ${selected ? "ring-2 ring-white/30" : ""}`}
      onClick={() => onClick(agent.id)}
    >
      {/* Left handle — receives connections */}
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ background: isOrchestrator ? "#00d2ff" : "#64748b", width: 10, height: 10, border: "2px solid #0f172a" }}
      />
      {/* Right handle — sends connections */}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ background: isOrchestrator ? "#00d2ff" : "#64748b", width: 10, height: 10, border: "2px solid #0f172a" }}
      />

      {/* Header */}
      <div className={`px-3 py-2 rounded-t-[10px] border-b ${
        isOrchestrator ? "bg-[#00d2ff]/15 border-[#00d2ff]/30" : "bg-slate-700/50 border-slate-700"
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{isOrchestrator ? "🎯" : "🤖"}</span>
          <span className="font-semibold text-sm text-slate-100 truncate">{agent.name}</span>
        </div>
        {isOrchestrator && (
          <span className="text-xs text-[#00d2ff]/80 font-medium">orchestrator</span>
        )}
      </div>

      {/* Body */}
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
              {agent.tools.length} tools
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
    <div className="rounded-xl border border-purple-700/60 bg-purple-950/40 w-[180px]">
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ background: "#c084fc", width: 10, height: 10, border: "2px solid #0f172a" }}
      />
      <div className="px-3 py-2 border-b border-purple-800/40 bg-purple-900/20 rounded-t-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">📚</span>
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
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ background: "#4ade80", width: 10, height: 10, border: "2px solid #0f172a" }}
      />
      <div className="px-3 py-2 border-b border-green-800/40 bg-green-900/20 rounded-t-[10px]">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🔌</span>
          <span className="font-medium text-green-200 text-xs truncate">{server.name}</span>
        </div>
        <span className="text-xs text-green-500">MCP server</span>
      </div>
      <div className="px-3 py-2">
        <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 font-mono">{server.type}</span>
        {server.command && (
          <p className="text-xs text-green-600 mt-1 truncate font-mono">{server.command}</p>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode, skillNode: SkillNode, mcpNode: McpNode };

// ─── Main component ───────────────────────────────────────────────────────────

export default function FlowEditor({
  plugin,
  onSelectAgent,
  selectedAgentId,
}: {
  plugin: Plugin;
  onSelectAgent: (id: string) => void;
  selectedAgentId: string | null;
}) {
  const { nodes: init, edges: initEdges } = buildGraph(plugin, onSelectAgent, selectedAgentId);
  const [nodes, setNodes, onNodesChange] = useNodesState(init);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(plugin, onSelectAgent, selectedAgentId);
    setNodes(n);
    setEdges(e);
  }, [plugin, selectedAgentId, onSelectAgent, setNodes, setEdges]);

  const isEmpty =
    plugin.agents.length === 0 &&
    plugin.skills.length === 0 &&
    plugin.mcpServers.length === 0;

  if (isEmpty) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-4">🕸️</p>
          <p className="text-slate-400 mb-2 font-medium">Flow is empty</p>
          <p className="text-slate-600 text-sm">Add agents, skills, and MCP servers from the sidebar to visualize your plugin architecture</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={24} size={1.5} />
        <Controls
          showInteractive={false}
          style={{ background: "#1e293b", borderColor: "#334155" }}
        />
        <MiniMap
          nodeColor={(n) => {
            if (n.type === "mcpNode") return "#4ade80";
            if (n.type === "skillNode") return "#c084fc";
            const d = n.data as AnyNodeData;
            return (d?.isOrchestrator as boolean) ? "#00d2ff" : "#475569";
          }}
          maskColor="rgba(10,15,30,0.85)"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}
        />

        {/* Legend panel */}
        <Panel position="top-right">
          <div className="bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3 backdrop-blur-sm shadow-xl">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Legend</p>
            <div className="space-y-2">
              <LegendRow color="#00d2ff" label="Orchestrator spawns agent" solid />
              <LegendRow color="#4ade80" label="MCP provides tools" dashed />
              <LegendRow color="#c084fc" label="Agent uses skill" dashed />
            </div>
            <div className="mt-3 pt-3 border-t border-slate-700 space-y-1.5">
              <NodeLegend color="#00d2ff" emoji="🎯" label="Orchestrator agent" />
              <NodeLegend color="#64748b" emoji="🤖" label="Worker agent" />
              <NodeLegend color="#4ade80" emoji="🔌" label="MCP server" />
              <NodeLegend color="#c084fc" emoji="📚" label="Skill / knowledge" />
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

function LegendRow({ color, label, solid, dashed }: { color: string; label: string; solid?: boolean; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="12" className="shrink-0">
        <line
          x1="0" y1="6" x2="20" y2="6"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "4 2" : undefined}
        />
        <polygon points="20,3 28,6 20,9" fill={color} />
      </svg>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

function NodeLegend({ color, emoji, label }: { color: string; emoji: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-4 h-4 rounded shrink-0 flex items-center justify-center text-xs"
        style={{ border: `1.5px solid ${color}`, background: `${color}20` }}
      >
        {emoji}
      </div>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}
