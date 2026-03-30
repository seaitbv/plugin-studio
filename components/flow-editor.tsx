"use client";

import { useCallback, useEffect } from "react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plugin } from "@/lib/plugin-types";

// ─── Node data types ─────────────────────────────────────────────────────────

interface AgentNodeData {
  label: string;
  model: string;
  toolCount: number;
  isOrchestrator: boolean;
  agentId: string;
  mcpCount: number;
  skillCount: number;
  onClick: (id: string) => void;
  [key: string]: unknown;
}

interface SkillNodeData {
  label: string;
  description: string;
  [key: string]: unknown;
}

interface McpNodeData {
  label: string;
  type: string;
  [key: string]: unknown;
}

// ─── Custom node components ───────────────────────────────────────────────────

function AgentNode({ data }: NodeProps) {
  const d = data as AgentNodeData;
  const modelColors: Record<string, string> = {
    sonnet: "text-blue-400",
    opus: "text-purple-400",
    haiku: "text-green-400",
    inherit: "text-slate-400",
  };

  return (
    <div
      className={`px-4 py-3 rounded-xl border-2 cursor-pointer transition-all hover:scale-105 min-w-[180px] max-w-[220px] ${
        d.isOrchestrator
          ? "bg-[#00d2ff]/10 border-[#00d2ff]/70 shadow-lg shadow-[#00d2ff]/20"
          : "bg-slate-800 border-slate-600 hover:border-slate-500"
      }`}
      onClick={() => d.onClick(d.agentId)}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500 !w-2 !h-2 !border-slate-400" />
      <Handle type="source" position={Position.Right} className="!bg-slate-500 !w-2 !h-2 !border-slate-400" />

      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{d.isOrchestrator ? "🎯" : "🤖"}</span>
        <span className="font-semibold text-slate-100 text-sm truncate">{d.label}</span>
      </div>

      <div className="flex gap-1 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded bg-slate-700 ${modelColors[d.model] || modelColors.inherit}`}>
          {d.model}
        </span>
        {d.toolCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
            {d.toolCount} tools
          </span>
        )}
        {d.mcpCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/60 text-green-400">
            {d.mcpCount} MCP
          </span>
        )}
        {d.skillCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-400">
            {d.skillCount} skills
          </span>
        )}
        {d.isOrchestrator && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[#00d2ff]/20 text-[#00d2ff]">
            orchestrator
          </span>
        )}
      </div>
    </div>
  );
}

function SkillNode({ data }: NodeProps) {
  const d = data as SkillNodeData;
  return (
    <div className="px-3 py-2.5 rounded-xl border border-purple-700/60 bg-purple-900/20 min-w-[150px] max-w-[180px]">
      <Handle type="target" position={Position.Left} className="!bg-purple-500 !w-2 !h-2 !border-purple-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">📚</span>
        <span className="font-medium text-purple-200 text-xs truncate">{d.label}</span>
      </div>
      {d.description && (
        <p className="text-xs text-purple-400/70 line-clamp-2 leading-tight">{d.description}</p>
      )}
    </div>
  );
}

function McpNode({ data }: NodeProps) {
  const d = data as McpNodeData;
  return (
    <div className="px-3 py-2.5 rounded-xl border border-green-700/60 bg-green-900/20 min-w-[140px] max-w-[170px]">
      <Handle type="source" position={Position.Right} className="!bg-green-500 !w-2 !h-2 !border-green-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">🔌</span>
        <span className="font-medium text-green-200 text-xs truncate">{d.label}</span>
      </div>
      <span className="text-xs px-1.5 py-0.5 rounded bg-green-900 text-green-500">{d.type}</span>
    </div>
  );
}

const nodeTypes = {
  agentNode: AgentNode,
  skillNode: SkillNode,
  mcpNode: McpNode,
};

// ─── Layout helper ─────────────────────────────────────────────────────────────

function buildGraph(
  plugin: Plugin,
  onSelectAgent: (id: string) => void,
  selectedAgentId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const agentCount = plugin.agents.length;
  const skillCount = plugin.skills.length;
  const mcpCount = plugin.mcpServers.length;

  // Layout: MCPs on left (x=0), Agents in middle (x=320), Skills on right (x=640)
  const agentSpacing = 160;
  const agentStartY = Math.max(0, ((mcpCount > agentCount ? mcpCount : agentCount) - agentCount) * agentSpacing / 2);

  // ── Agent nodes ─────────────────────────────────────────────────────────────
  plugin.agents.forEach((agent, i) => {
    const isOrchestrator = agent.tools.some((t) => t.startsWith("Agent"));
    nodes.push({
      id: `agent-${agent.id}`,
      type: "agentNode",
      position: { x: 320, y: agentStartY + i * agentSpacing },
      data: {
        label: agent.name,
        model: agent.model,
        toolCount: agent.tools.length,
        isOrchestrator,
        agentId: agent.id,
        mcpCount: agent.mcpServers.length,
        skillCount: (agent.skills || []).length,
        onClick: onSelectAgent,
      } as AgentNodeData,
      selected: agent.id === selectedAgentId,
    });

    // Orchestrator → worker edges
    if (isOrchestrator) {
      const agentTool = agent.tools.find((t) => t.startsWith("Agent("));
      if (agentTool) {
        const match = agentTool.match(/Agent\(([^)]+)\)/);
        if (match) {
          match[1].split(",").map((t) => t.trim()).forEach((targetName) => {
            const target = plugin.agents.find((a) => a.name === targetName);
            if (target) {
              edges.push({
                id: `orch-${agent.id}-${target.id}`,
                source: `agent-${agent.id}`,
                target: `agent-${target.id}`,
                animated: true,
                label: "delegates to",
                labelStyle: { fill: "#94a3b8", fontSize: 10 },
                labelBgStyle: { fill: "#0f172a" },
                style: { stroke: "#00d2ff", strokeWidth: 2, opacity: 0.7 },
                markerEnd: { type: "arrowclosed" as const, color: "#00d2ff" },
              });
            }
          });
        }
      }
    }
  });

  // ── MCP nodes (left column) ───────────────────────────────────────────────
  const mcpSpacing = 120;
  const mcpStartY = Math.max(0, (agentCount - mcpCount) * agentSpacing / 2);

  plugin.mcpServers.forEach((server, i) => {
    nodes.push({
      id: `mcp-${server.id}`,
      type: "mcpNode",
      position: { x: 0, y: mcpStartY + i * mcpSpacing },
      data: {
        label: server.name,
        type: server.type,
      } as McpNodeData,
    });

    // MCP → agents that use it
    plugin.agents.forEach((agent) => {
      if (agent.mcpServers.includes(server.name)) {
        edges.push({
          id: `mcp-${server.id}-${agent.id}`,
          source: `mcp-${server.id}`,
          target: `agent-${agent.id}`,
          label: "provides",
          labelStyle: { fill: "#4ade80", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a" },
          style: { stroke: "#4ade80", strokeWidth: 1.5, opacity: 0.5, strokeDasharray: "4 2" },
          markerEnd: { type: "arrowclosed" as const, color: "#4ade80" },
        });
      }
    });
  });

  // ── Skill nodes (right column) ────────────────────────────────────────────
  const skillSpacing = 120;
  const skillStartY = Math.max(0, (agentCount - skillCount) * agentSpacing / 2);

  plugin.skills.forEach((skill, i) => {
    nodes.push({
      id: `skill-${skill.id}`,
      type: "skillNode",
      position: { x: 660, y: skillStartY + i * skillSpacing },
      data: {
        label: skill.name,
        description: skill.description,
      } as SkillNodeData,
    });

    // Agents that have this skill in their skills list
    plugin.agents.forEach((agent) => {
      if ((agent.skills || []).includes(skill.name)) {
        edges.push({
          id: `skill-${skill.id}-${agent.id}`,
          source: `agent-${agent.id}`,
          target: `skill-${skill.id}`,
          label: "uses",
          labelStyle: { fill: "#c084fc", fontSize: 10 },
          labelBgStyle: { fill: "#0f172a" },
          style: { stroke: "#c084fc", strokeWidth: 1.5, opacity: 0.5, strokeDasharray: "4 2" },
          markerEnd: { type: "arrowclosed" as const, color: "#c084fc" },
        });
      }
    });
  });

  return { nodes, edges };
}

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

  const isEmpty = plugin.agents.length === 0 && plugin.skills.length === 0 && plugin.mcpServers.length === 0;

  return (
    <div className="w-full h-full relative">
      {/* Legend */}
      <div className="absolute top-3 right-3 z-10 flex gap-3 bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 backdrop-blur-sm">
        <LegendItem color="#00d2ff" label="Agent flow" />
        <LegendItem color="#4ade80" label="MCP" dashed />
        <LegendItem color="#c084fc" label="Skill" dashed />
      </div>

      {isEmpty ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <p className="text-4xl mb-4">🕸️</p>
            <p className="text-slate-500 mb-2">Flow is empty</p>
            <p className="text-slate-600 text-sm">Add agents, skills, and MCP servers from the sidebar</p>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={20} size={1} />
          <Controls className="!bg-slate-800 !border-slate-700" />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === "mcpNode") return "#4ade80";
              if (n.type === "skillNode") return "#c084fc";
              const d = n.data as AgentNodeData;
              return d?.isOrchestrator ? "#00d2ff" : "#475569";
            }}
            maskColor="rgba(10,15,30,0.8)"
          />
        </ReactFlow>
      )}
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-6 h-0.5 rounded"
        style={{
          opacity: 0.8,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
          background: dashed ? "transparent" : color,
        }}
      />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}
