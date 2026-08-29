import { create } from "zustand";
import type { Activity, BoardProfile, BottomPanel, BuildEvent, BuildSummary, Diagnostic, GitStatus, HdlIndex, OpenFile, ProjectNode, ThemeMode, WorkbenchView } from "../types";

interface NavigationTarget {
  path: string;
  line: number;
  column: number;
  nonce: number;
}

interface WorkbenchState {
  ready: boolean;
  root: string;
  project: string;
  projectPath: string;
  tree: ProjectNode[];
  recentProjects: string[];
  activity: Activity;
  view: WorkbenchView;
  bottomPanel: BottomPanel;
  bottomOpen: boolean;
  sidebarOpen: boolean;
  theme: ThemeMode;
  tabs: OpenFile[];
  activePath: string | null;
  output: BuildEvent[];
  diagnostics: Diagnostic[];
  hdlIndex: HdlIndex | null;
  intelligenceStatus: "idle" | "indexing" | "ready" | "degraded";
  navigation: NavigationTarget | null;
  build: BuildSummary | null;
  runningJob: string | null;
  board: BoardProfile | null;
  git: GitStatus | null;
  projectWizardOpen: boolean;
  setWorkspace: (root: string, project: string, projectPath: string, tree: ProjectNode[], recentProjects?: string[]) => void;
  setActivity: (activity: Activity) => void;
  setView: (view: WorkbenchView) => void;
  setBottomPanel: (panel: BottomPanel) => void;
  toggleBottom: () => void;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeMode) => void;
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  markSaved: (path: string) => void;
  appendOutput: (event: BuildEvent) => void;
  clearOutput: () => void;
  setDiagnostics: (items: Diagnostic[]) => void;
  setHdlIndex: (index: HdlIndex | null, status?: WorkbenchState["intelligenceStatus"]) => void;
  navigateTo: (path: string, line?: number, column?: number) => void;
  clearNavigation: () => void;
  setBuild: (summary: BuildSummary) => void;
  setRunningJob: (jobId: string | null) => void;
  setBoard: (board: BoardProfile) => void;
  setGit: (git: GitStatus) => void;
  openProjectWizard: () => void;
  closeProjectWizard: () => void;
}

const storedTheme = (localStorage.getItem("fpga-studio.theme") as ThemeMode | null) ?? "dark";

export const useWorkbench = create<WorkbenchState>((set) => ({
  ready: false,
  root: "",
  project: "",
  projectPath: ".",
  tree: [],
  recentProjects: [],
  activity: "explorer",
  view: "welcome",
  bottomPanel: "output",
  bottomOpen: true,
  sidebarOpen: true,
  theme: storedTheme,
  tabs: [],
  activePath: null,
  output: [],
  diagnostics: [],
  hdlIndex: null,
  intelligenceStatus: "idle",
  navigation: null,
  build: null,
  runningJob: null,
  board: null,
  git: null,
  projectWizardOpen: false,
  setWorkspace: (root, project, projectPath, tree, recentProjects = []) => set({ root, project, projectPath, tree, recentProjects, ready: true, tabs: [], activePath: null, view: "welcome", hdlIndex: null, intelligenceStatus: "idle", navigation: null }),
  setActivity: (activity) => set({ activity, sidebarOpen: true }),
  setView: (view) => set({ view }),
  setBottomPanel: (bottomPanel) => set({ bottomPanel, bottomOpen: true }),
  toggleBottom: () => set((state) => ({ bottomOpen: !state.bottomOpen })),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setTheme: (theme) => {
    localStorage.setItem("fpga-studio.theme", theme);
    set({ theme });
  },
  openFile: (file) => set((state) => ({
    tabs: state.tabs.some((tab) => tab.path === file.path) ? state.tabs : [...state.tabs, file],
    activePath: file.path,
    view: "editor",
  })),
  closeFile: (path) => set((state) => {
    const index = state.tabs.findIndex((tab) => tab.path === path);
    const tabs = state.tabs.filter((tab) => tab.path !== path);
    const fallback = tabs[Math.max(0, index - 1)]?.path ?? tabs[0]?.path ?? null;
    return { tabs, activePath: state.activePath === path ? fallback : state.activePath, view: tabs.length ? state.view : "welcome" };
  }),
  updateFile: (path, content) => set((state) => ({ tabs: state.tabs.map((tab) => tab.path === path ? { ...tab, content } : tab) })),
  markSaved: (path) => set((state) => ({ tabs: state.tabs.map((tab) => tab.path === path ? { ...tab, savedContent: tab.content } : tab) })),
  appendOutput: (event) => set((state) => {
    const previous = state.output.at(-1);
    if (previous && previous.jobId === event.jobId && previous.phase === event.phase && previous.stream === event.stream && previous.message === event.message) return state;
    return { output: [...state.output.slice(-1999), event] };
  }),
  clearOutput: () => set({ output: [] }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setHdlIndex: (hdlIndex, intelligenceStatus = hdlIndex ? "ready" : "degraded") => set({ hdlIndex, intelligenceStatus }),
  navigateTo: (path, line = 1, column = 1) => set({ navigation: { path, line, column, nonce: Date.now() } }),
  clearNavigation: () => set({ navigation: null }),
  setBuild: (build) => set({ build }),
  setRunningJob: (runningJob) => set({ runningJob }),
  setBoard: (board) => set({ board }),
  setGit: (git) => set({ git }),
  openProjectWizard: () => set({ projectWizardOpen: true }),
  closeProjectWizard: () => set({ projectWizardOpen: false }),
}));
