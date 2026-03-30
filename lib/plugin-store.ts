"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Plugin, AgentConfig, SkillConfig, McpServer } from "./plugin-types";
import { exportPluginToZip, importPluginFromZip } from "./zip-utils";

interface PluginStore {
  plugins: Plugin[];
  currentPluginId: string | null;

  // Plugin CRUD
  createPlugin: (name: string) => Plugin;
  updatePlugin: (id: string, updates: Partial<Plugin>) => void;
  deletePlugin: (id: string) => void;
  setCurrentPlugin: (id: string | null) => void;
  getCurrentPlugin: () => Plugin | null;

  // Agent CRUD
  addAgent: (pluginId: string, agent?: Partial<AgentConfig>) => AgentConfig;
  updateAgent: (pluginId: string, agentId: string, updates: Partial<AgentConfig>) => void;
  deleteAgent: (pluginId: string, agentId: string) => void;

  // Skill CRUD
  addSkill: (pluginId: string, skill?: Partial<SkillConfig>) => SkillConfig;
  updateSkill: (pluginId: string, skillId: string, updates: Partial<SkillConfig>) => void;
  deleteSkill: (pluginId: string, skillId: string) => void;

  // MCP CRUD
  addMcpServer: (pluginId: string, server?: Partial<McpServer>) => McpServer;
  updateMcpServer: (pluginId: string, serverId: string, updates: Partial<McpServer>) => void;
  deleteMcpServer: (pluginId: string, serverId: string) => void;

  // ZIP
  exportToZip: (pluginId: string) => Promise<void>;
  importFromZip: (file: File) => Promise<Plugin>;
}

export const usePluginStore = create<PluginStore>()(
  persist(
    (set, get) => ({
      plugins: [],
      currentPluginId: null,

      createPlugin: (name: string) => {
        const plugin: Plugin = {
          id: crypto.randomUUID(),
          manifest: {
            name: name.toLowerCase().replace(/\s+/g, "-"),
            version: "1.0.0",
            description: "",
            author: { name: "" },
          },
          agents: [],
          skills: [],
          mcpServers: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({ plugins: [...state.plugins, plugin], currentPluginId: plugin.id }));
        return plugin;
      },

      updatePlugin: (id, updates) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
        }));
      },

      deletePlugin: (id) => {
        set((state) => ({
          plugins: state.plugins.filter((p) => p.id !== id),
          currentPluginId: state.currentPluginId === id ? null : state.currentPluginId,
        }));
      },

      setCurrentPlugin: (id) => set({ currentPluginId: id }),

      getCurrentPlugin: () => {
        const { plugins, currentPluginId } = get();
        return plugins.find((p) => p.id === currentPluginId) || null;
      },

      addAgent: (pluginId, agent = {}) => {
        const newAgent: AgentConfig = {
          id: crypto.randomUUID(),
          name: "new-agent",
          description: "",
          model: "inherit",
          tools: [],
          mcpServers: [],
          skills: [],
          permissionMode: "default",
          background: false,
          memory: "none",
          systemPrompt: "",
          ...agent,
        };
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? { ...p, agents: [...p.agents, newAgent], updatedAt: Date.now() }
              : p
          ),
        }));
        return newAgent;
      },

      updateAgent: (pluginId, agentId, updates) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? {
                  ...p,
                  agents: p.agents.map((a) => (a.id === agentId ? { ...a, ...updates } : a)),
                  updatedAt: Date.now(),
                }
              : p
          ),
        }));
      },

      deleteAgent: (pluginId, agentId) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? { ...p, agents: p.agents.filter((a) => a.id !== agentId), updatedAt: Date.now() }
              : p
          ),
        }));
      },

      addSkill: (pluginId, skill = {}) => {
        const newSkill: SkillConfig = {
          id: crypto.randomUUID(),
          name: "new-skill",
          description: "",
          content: "",
          ...skill,
        };
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? { ...p, skills: [...p.skills, newSkill], updatedAt: Date.now() }
              : p
          ),
        }));
        return newSkill;
      },

      updateSkill: (pluginId, skillId, updates) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? {
                  ...p,
                  skills: p.skills.map((s) => (s.id === skillId ? { ...s, ...updates } : s)),
                  updatedAt: Date.now(),
                }
              : p
          ),
        }));
      },

      deleteSkill: (pluginId, skillId) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? { ...p, skills: p.skills.filter((s) => s.id !== skillId), updatedAt: Date.now() }
              : p
          ),
        }));
      },

      addMcpServer: (pluginId, server = {}) => {
        const newServer: McpServer = {
          id: crypto.randomUUID(),
          name: "new-server",
          type: "stdio",
          command: "",
          args: [],
          env: {},
          ...server,
        };
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? { ...p, mcpServers: [...p.mcpServers, newServer], updatedAt: Date.now() }
              : p
          ),
        }));
        return newServer;
      },

      updateMcpServer: (pluginId, serverId, updates) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? {
                  ...p,
                  mcpServers: p.mcpServers.map((m) =>
                    m.id === serverId ? { ...m, ...updates } : m
                  ),
                  updatedAt: Date.now(),
                }
              : p
          ),
        }));
      },

      deleteMcpServer: (pluginId, serverId) => {
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.id === pluginId
              ? {
                  ...p,
                  mcpServers: p.mcpServers.filter((m) => m.id !== serverId),
                  updatedAt: Date.now(),
                }
              : p
          ),
        }));
      },

      exportToZip: async (pluginId) => {
        const plugin = get().plugins.find((p) => p.id === pluginId);
        if (!plugin) return;
        const blob = await exportPluginToZip(plugin);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${plugin.manifest.name}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      },

      importFromZip: async (file) => {
        const partial = await importPluginFromZip(file);
        const plugin: Plugin = {
          id: crypto.randomUUID(),
          manifest: partial.manifest || { name: file.name.replace(".zip", ""), version: "1.0.0" },
          agents: partial.agents || [],
          skills: partial.skills || [],
          mcpServers: partial.mcpServers || [],
          hooks: partial.hooks,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({ plugins: [...state.plugins, plugin], currentPluginId: plugin.id }));
        return plugin;
      },
    }),
    {
      name: "plugin-studio-plugins",
    }
  )
);
