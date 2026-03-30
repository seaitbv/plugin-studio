"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePluginStore } from "@/lib/plugin-store";
import { Plugin } from "@/lib/plugin-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  const router = useRouter();
  const { plugins, createPlugin, deletePlugin, importFromZip } = usePluginStore();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newPluginName, setNewPluginName] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = () => {
    if (!newPluginName.trim()) return;
    const plugin = createPlugin(newPluginName.trim());
    setShowNewDialog(false);
    setNewPluginName("");
    router.push(`/plugin/${plugin.id}`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const plugin = await importFromZip(file);
      router.push(`/plugin/${plugin.id}`);
    } catch (err) {
      console.error("Import failed:", err);
      alert("Failed to import ZIP. Make sure it's a valid Claude Code plugin.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e]">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#00d2ff]/20 border border-[#00d2ff]/40 flex items-center justify-center">
              <span className="text-[#00d2ff] text-sm font-bold">⚡</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-100">Plugin Studio</h1>
              <p className="text-xs text-slate-500">Claude Code · Cowork</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? "Importing..." : "↑ Import ZIP"}
            </Button>
            <Button
              className="bg-[#00d2ff] text-slate-900 hover:bg-[#00b8e0] font-semibold"
              onClick={() => setShowNewDialog(true)}
            >
              + New Plugin
            </Button>
          </div>
        </div>
      </header>

      <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleImport} />

      <main className="max-w-6xl mx-auto px-6 py-10">
        {plugins.length === 0 ? (
          <EmptyState
            onNew={() => setShowNewDialog(true)}
            onImport={() => fileInputRef.current?.click()}
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-100">Your Plugins</h2>
              <span className="text-slate-500 text-sm">{plugins.length} plugin{plugins.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plugins.map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  onOpen={() => router.push(`/plugin/${plugin.id}`)}
                  onDelete={() => deletePlugin(plugin.id)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* New Plugin Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-slate-100">New Plugin</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Plugin name</label>
              <Input
                placeholder="my-awesome-plugin"
                value={newPluginName}
                onChange={(e) => setNewPluginName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                autoFocus
              />
              <p className="text-xs text-slate-500 mt-1">
                Used as namespace for skills and agents (e.g. <code className="text-[#00d2ff]">/my-plugin:skill</code>)
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" className="border-slate-700 text-slate-300" onClick={() => setShowNewDialog(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#00d2ff] text-slate-900 hover:bg-[#00b8e0] font-semibold"
                onClick={handleCreate}
                disabled={!newPluginName.trim()}
              >
                Create Plugin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PluginCard({
  plugin,
  onOpen,
  onDelete,
}: {
  plugin: Plugin;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="bg-slate-900 border border-slate-800 rounded-xl p-5 cursor-pointer hover:border-[#00d2ff]/40 hover:bg-slate-800/50 transition-all group"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg bg-[#00d2ff]/10 border border-[#00d2ff]/20 flex items-center justify-center">
          <span className="text-[#00d2ff] text-lg">🔌</span>
        </div>
        <button
          className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-lg leading-none"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete plugin"
        >
          ×
        </button>
      </div>
      <h3 className="font-semibold text-slate-100 mb-1">{plugin.manifest.name}</h3>
      <p className="text-sm text-slate-500 mb-3 line-clamp-2">
        {plugin.manifest.description || "No description"}
      </p>
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline" className="border-slate-700 text-slate-400 text-xs">
          v{plugin.manifest.version}
        </Badge>
        {plugin.agents.length > 0 && (
          <Badge variant="outline" className="border-blue-800 text-blue-400 text-xs">
            {plugin.agents.length} agent{plugin.agents.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {plugin.skills.length > 0 && (
          <Badge variant="outline" className="border-purple-800 text-purple-400 text-xs">
            {plugin.skills.length} skill{plugin.skills.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {plugin.mcpServers.length > 0 && (
          <Badge variant="outline" className="border-green-800 text-green-400 text-xs">
            {plugin.mcpServers.length} MCP
          </Badge>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return (
    <div className="text-center py-24">
      <div className="w-20 h-20 rounded-2xl bg-[#00d2ff]/10 border border-[#00d2ff]/20 flex items-center justify-center mx-auto mb-6">
        <span className="text-4xl">🔌</span>
      </div>
      <h2 className="text-2xl font-bold text-slate-100 mb-3">No plugins yet</h2>
      <p className="text-slate-500 mb-8 max-w-md mx-auto">
        Create a new plugin from scratch or import an existing one from a ZIP file.
        Build multi-agent workflows with subagents and MCP servers.
      </p>
      <div className="flex gap-4 justify-center">
        <Button
          className="bg-[#00d2ff] text-slate-900 hover:bg-[#00b8e0] font-semibold px-6"
          onClick={onNew}
        >
          + New Plugin
        </Button>
        <Button
          variant="outline"
          className="border-slate-700 text-slate-300 hover:bg-slate-800 px-6"
          onClick={onImport}
        >
          ↑ Import ZIP
        </Button>
      </div>
    </div>
  );
}
