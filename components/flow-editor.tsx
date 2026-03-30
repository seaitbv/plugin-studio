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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plugin } from "@/lib/plugin-types";

interface AgentNodeData {
  label: string;
  model: string;
  toolCount: number;
  isOrchestrator: boolean;
  agentId: string;
  onClick: (id: string) => void;
}

function AgentNode({ data }: { data: AgentNodeData }) {
  const modelColors: Record<string, string> = {
    sonnet: "text-blue-400 border-blue-600/40 bg-blue-600/10",
    opus: "text-purple-400 border-purple-600/40 bg-purple-600/10",
    haiku: "text-green-400 border-green-600/40 bg-green-600/10",
    inherit: "text-slate-400 border-slate-600/40 bg-slate-600/10",
  };

  return (
    <div
      className={`px-4 py-3 rounded-xl border cursor-pointer transition-all hover:scale-105 min-w-[160px] ${
        data.isOrchestrator
          ? "bg-[#00d2ff]/10 border-[#00d2ff]/50 shadow-lg shadow-[#00d2ff]/10"
          : "bg-slate-800 border-slate-600"
      }`}
      onClick={() => data.onClick(data.agentId)}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{data.isOrchestrator ? "🎯" : "🤖"}</span>
        <span className="font-semibold text-slate-100 text-sm truncate max-w-[120px]">{data.label}</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded border ${modelColors[data.model] || modelColors.inherit}`}>
          {data.model}
        </span>
        {data.toolCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded border border-slate-600/40 bg-slate-600/10 text-slate-400">
            {data.toolCount} tools
          </span>
        )}
        {data.isOrchestrator && (
          <span className="text-xs px-1.5 py-0.5 rounded border border-[#00d2ff]/40 bg-[#00d2ff]/10 text-[#00d2ff]">
            orchestrator
          </span>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };

export default function FlowEditor({
  plugin,
  onSelectAgent,
  selectedAgentId,
}: {
  plugin: Plugin;
  onSelectAgent: (id: string) => void;
  selectedAgentId: string | null;
}) {
  const buildGraph = useCallback(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const cols = Math.ceil(Math.sqrt(plugin.agents.length || 1));
    
    plugin.agents.forEach((agent, i) => {
      const isOrchestrator = agent.tools.some((t) => t.startsWith("Agent"));
      const col = i % cols;
      const row = Math.floor(i / cols);

      nodes.push({
        id: agent.id,
        type: "agentNode",
        position: { x: col * 220, y: row * 140 },
        data: {
          label: agent.name,
          model: agent.model,
          toolCount: agent.tools.length,
          isOrchestrator,
          agentId: agent.id,
          onClick: onSelectAgent,
        },
        selected: agent.id === selectedAgentId,
      });

      // Parse Agent(x,y) to create edges
      if (isOrchestrator) {
        const agentTool = agent.tools.find((t) => t.startsWith("Agent("));
        if (agentTool) {
          const match = agentTool.match(/Agent\(([^)]+)\)/);
          if (match) {
            const targets = match[1].split(",").map((t) => t.trim());
            targets.forEach((targetName) => {
              const targetAgent = plugin.agents.find((a) => a.name === targetName);
              if (targetAgent) {
                edges.push({
                  id: `${agent.id}->${targetAgent.id}`,
                  source: agent.id,
                  target: targetAgent.id,
                  animated: true,
                  style: { stroke: "#00d2ff", strokeWidth: 1.5, opacity: 0.6 },
                  markerEnd: { type: "arrowclosed" as const, color: "#00d2ff" },
                });
              }
            });
          }
        }
      }
    });

    return { nodes, edges };
  }, [plugin.agents, onSelectAgent, selectedAgentId]);

  const { nodes: initialNodes, edges: initialEdges } = buildGraph();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = buildGraph();
    setNodes(newNodes);
    setEdges(newEdges);
  }, [plugin.agents, selectedAgentId, buildGraph, setNodes, setEdges]);

  return (
    <div className="w-full h-full">
      {plugin.agents.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <p className="text-4xl mb-4">🤖</p>
            <p className="text-slate-500 mb-2">No agents yet</p>
            <p className="text-slate-600 text-sm">Add agents from the sidebar to build your flow</p>
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
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background variant={BackgroundVariant.Dots} color="#1e293b" gap={20} size={1} />
          <Controls className="!bg-slate-800 !border-slate-700" />
          <MiniMap
            nodeColor={(n) => (n.data as unknown as AgentNodeData).isOrchestrator ? "#00d2ff" : "#475569"}
            maskColor="rgba(10,15,30,0.8)"
          />
        </ReactFlow>
      )}
    </div>
  );
}
