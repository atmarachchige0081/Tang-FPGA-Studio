import { AlertTriangle, Bell, CheckCircle2, GitBranch, Radio, ShieldCheck, Wifi } from "lucide-react";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";

export function StatusBar(): React.JSX.Element {
  const { diagnostics, activePath, tabs, build, runningJob, git, setActivity, setBottomPanel, setView } = useWorkbench();
  const active = tabs.find((tab) => tab.path === activePath);
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  return <footer className="statusbar"><div className="status-left"><button title={git?.message ?? "Open Source Control"} onClick={() => setActivity("source")}><GitBranch size={13}/> {git?.repository ? git.branch ?? "detached" : git?.available === false ? "Git missing" : "Git..."}</button><span><ShieldCheck size={13}/> local only</span><button title="Open Problems" onClick={() => setBottomPanel("problems")}><CheckCircle2 size={13}/> {errors}</button><button title="Open Problems" onClick={() => setBottomPanel("problems")}><AlertTriangle size={13}/> {warnings}</button></div><div className="status-right">{runningJob && <span className="status-running"><span className="status-spinner"/> FPGA job running</span>}<button title="Open build dashboard" onClick={() => setView("dashboard")}><Radio size={13}/> {build?.status ?? "ready"}</button><span><Wifi size={13}/> {bridge.isDesktop() ? "Desktop" : "Browser preview"}</span>{active && <><span>{active.language}</span><span>UTF-8</span></>}<button title="Open output notifications" aria-label="Open output notifications" onClick={() => setBottomPanel("output")}><Bell size={13}/></button></div></footer>;
}
