import { Blocks, Boxes, CircuitBoard, Files, GitBranch, Search } from "lucide-react";
import type { Activity } from "../types";
import { useWorkbench } from "../store/workbench";

const activities: Array<{ id: Activity; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "source", label: "Source control", icon: GitBranch },
  { id: "hardware", label: "Hardware", icon: CircuitBoard },
  { id: "ip", label: "IP library", icon: Boxes },
  { id: "extensions", label: "Extensions", icon: Blocks },
];

export function ActivityBar(): React.JSX.Element {
  const { activity, setActivity, setView, board } = useWorkbench();
  return (
    <nav className="activitybar" aria-label="Primary navigation">
      {activities.map(({ id, label, icon: Icon }) => (
        <button key={id} className={activity === id ? "active" : ""} onClick={() => setActivity(id)} title={label} aria-label={label}><Icon size={21} /></button>
      ))}
      <span className="activity-spacer" />
      <button title={`Open hardware manager · ${board?.name ?? "board loading"}`} aria-label="Open hardware manager" onClick={() => setView("hardware")}><span className="board-dot" /></button>
    </nav>
  );
}
