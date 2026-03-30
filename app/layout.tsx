import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plugin Studio — Claude Code Plugin Builder",
  description: "Visual editor for creating Claude Code & Cowork plugins with subagents, skills, and MCP servers",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0f1e] text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
