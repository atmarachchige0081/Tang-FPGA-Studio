import { useEffect, useRef, useState } from "react";
import { Box, ChevronDown, Command, Cpu, Moon, PanelBottom, PanelLeft, Search, Sun } from "lucide-react";
import { useWorkbench } from "../store/workbench";
import type { BuildAction } from "../types";
import { openQuickLauncher } from "./QuickLauncher";

interface Props {
  onRun: (action: BuildAction) => void;
  onSave: () => void;
}

type MenuId = "file" | "edit" | "project" | "build" | "hardware" | "help";

interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export function TitleBar({ onRun, onSave }: Props): React.JSX.Element {
  const store = useWorkbench();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const menuRoot = useRef<HTMLElement>(null);
  const toggleTheme = () => store.setTheme(store.theme === "light" ? "dark" : "light");
  const action = (run: () => void) => () => { setOpenMenu(null); run(); };
  const openSearch = (mode: "text" | "files" | "symbols") => {
    store.setActivity("search");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("fpga-studio:workspace-search", { detail: { mode } })), 0);
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenMenu(null); };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", escape); };
  }, []);

  const menus: Record<MenuId, MenuItem[]> = {
    file: [
      { label: "New FPGA project…", shortcut: "Ctrl+N", run: store.openProjectWizard },
      { label: "Go to project file…", shortcut: "Ctrl+P", run: () => openSearch("files") },
      { label: "Save active file", shortcut: "Ctrl+S", disabled: !store.activePath, run: onSave },
    ],
    edit: [
      { label: "Open action center…", shortcut: "Ctrl+K", run: openQuickLauncher },
      { label: "Toggle sidebar", run: store.toggleSidebar },
      { label: "Toggle output panel", run: store.toggleBottom },
      { label: store.theme === "light" ? "Use dark theme" : "Use light theme", shortcut: "Ctrl+Shift+L", run: toggleTheme },
    ],
    project: [
      { label: "Project explorer", run: () => { store.setActivity("explorer"); store.setView("editor"); } },
      { label: "Search project text…", shortcut: "Ctrl+Shift+F", run: () => openSearch("text") },
      { label: "Go to HDL symbol…", shortcut: "Ctrl+T", run: () => openSearch("symbols") },
      { label: "RTL analysis & architecture", run: () => store.setView("analysis") },
      { label: "Verification center", run: () => store.setView("verification") },
      { label: "Design Health", run: () => store.setView("health") },
      { label: "Traceability explorer", run: () => store.setView("traceability") },
      { label: "HDL pattern library", run: () => store.setActivity("ip") },
      { label: "Source control", run: () => store.setActivity("source") },
      { label: "Installed providers", run: () => store.setActivity("extensions") },
    ],
    build: [
      { label: "Lint HDL", disabled: Boolean(store.runningJob), run: () => onRun("lint") },
      { label: "Run simulation", disabled: Boolean(store.runningJob), run: () => onRun("sim") },
      { label: "Build bitstream", shortcut: "Ctrl+Shift+B", disabled: Boolean(store.runningJob), run: () => onRun("build") },
    ],
    hardware: [
      { label: "Hardware manager", run: () => store.setView("hardware") },
      { label: "On-chip logic analyzer", run: () => store.setView("analyzer") },
      { label: "UART terminal", run: () => store.setView("uart") },
      { label: "Detect JTAG chain", disabled: Boolean(store.runningJob), run: () => onRun("detect") },
    ],
    help: [
      { label: "Release notes", run: () => window.dispatchEvent(new Event("fpga-studio:release-notes")) },
      { label: "Search every action…", shortcut: "Ctrl+K", run: openQuickLauncher },
    ],
  };

  const renderMenu = (id: MenuId, label: string) => <div className="menu-wrap" key={id}>
    <button aria-haspopup="menu" aria-expanded={openMenu === id} onClick={() => setOpenMenu((current) => current === id ? null : id)}>{label}</button>
    {openMenu === id && <div className="app-menu" role="menu">{menus[id].map((item) => <button role="menuitem" key={item.label} disabled={item.disabled} onClick={action(item.run)}><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</button>)}</div>}
  </div>;

  return (
    <header className="titlebar" ref={menuRoot}>
      <div className="brand-mark" aria-label="FPGA Studio"><Cpu size={17} /><span>FPGA Studio</span><span className="version-chip">3.2</span></div>
      <nav className="menu-strip" aria-label="Application menu">
        {renderMenu("file", "File")}{renderMenu("edit", "Edit")}{renderMenu("project", "Project")}{renderMenu("build", "Build")}{renderMenu("hardware", "Hardware")}{renderMenu("help", "Help")}
      </nav>
      <button className="command-search" title="Open command center" onClick={openQuickLauncher}>
        <Search size={14} /><span>{store.project || "Open a workspace"}</span><kbd>Ctrl K</kbd><ChevronDown size={13} />
      </button>
      <div className="window-tools">
        <button className="icon-button" onClick={store.toggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar"><PanelLeft size={16} /></button>
        <button className="icon-button" onClick={store.toggleBottom} title="Toggle output panel" aria-label="Toggle output panel"><PanelBottom size={16} /></button>
        <button className="icon-button" onClick={toggleTheme} title="Toggle color theme" aria-label="Toggle color theme">{store.theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
        <button className="icon-button" title="Open action center" aria-label="Open action center" onClick={openQuickLauncher}><Command size={16} /></button>
        <span className="workspace-indicator" title="Local workspace"><Box size={13} /><span>Local</span></span>
      </div>
    </header>
  );
}
