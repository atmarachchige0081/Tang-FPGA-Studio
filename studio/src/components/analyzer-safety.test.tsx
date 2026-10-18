// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import { LogicAnalyzerView, TraceabilityView } from "./HardwareIntelligence";
import type { AnalyzerWorkspace } from "../types";
let workspace:AnalyzerWorkspace;
beforeEach(async()=>{
 useWorkbench.setState({root:"Browser preview",projectPath:".",runningJob:null,tabs:[],navigation:null});
 workspace=await bridge.analyzerWorkspace("Browser preview",".");
 workspace.config={...workspace.config,channels:[{id:0,signal:"a",width:1,radix:"binary"},{id:1,signal:"b",width:1,radix:"binary"},{id:2,signal:"bus",width:8,radix:"hex"}],trigger:{combinator:"and",clauses:[{channelId:1,operation:"rising",value:"0"}]}};
 workspace.signals=workspace.config.channels.map(c=>({id:c.signal,name:c.signal,hierarchy:c.signal,width:c.width,kind:"wire",observable:true}));
 vi.spyOn(bridge,"analyzerWorkspace").mockResolvedValue(workspace);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("preserves trigger signal identity when removing an earlier probe",async()=>{
 const save=vi.spyOn(bridge,"saveAnalyzerConfig").mockResolvedValue(workspace);
 const ui=render(<LogicAnalyzerView onRun={vi.fn(async()=>true)}/>);
 await screen.findByText("Observable hierarchy");
 fireEvent.click(ui.container.querySelector(".signal-list button")!);
 fireEvent.click(screen.getByRole("button",{name:"Save probes"}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 const config=save.mock.calls[0]![2];
 const trigger=config.trigger.clauses[0]!;
 expect(config.channels.find(c=>c.id===trigger.channelId)?.signal).toBe("b");
});
it("changes edge triggers to comparison when selecting a bus",async()=>{
 const save=vi.spyOn(bridge,"saveAnalyzerConfig").mockResolvedValue(workspace);
 const ui=render(<LogicAnalyzerView onRun={vi.fn(async()=>true)}/>);
 await screen.findByText("Observable hierarchy");
 fireEvent.change(ui.container.querySelector('.trigger-row select')!,{target:{value:"2"}});
 fireEvent.click(screen.getByRole("button",{name:"Save probes"}));
 await waitFor(()=>expect(save).toHaveBeenCalled());
 expect(save.mock.calls[0]![2].trigger.clauses[0]?.operation).toBe("compare");
});
it("locks editable analyzer configuration while a save is pending",async()=>{
 vi.spyOn(bridge,"saveAnalyzerConfig").mockReturnValue(new Promise(()=>undefined));
 render(<LogicAnalyzerView onRun={vi.fn(async()=>true)}/>);
 await screen.findByText("Observable hierarchy");
 fireEvent.click(screen.getByRole("button",{name:"Save probes"}));
 await waitFor(()=>expect(bridge.saveAnalyzerConfig).toHaveBeenCalled());
 expect(screen.getByLabelText("Clock port").matches(':disabled')).toBe(true);
});
it("navigates traceability source links to the actual source line",async()=>{
 render(<TraceabilityView/>);
 const source=await screen.findAllByRole("button",{name:/rtl\/top.sv.*line/i});
 fireEvent.click(source[0]!);
 await waitFor(()=>expect(useWorkbench.getState().activePath).toBe("rtl/top.sv"));
 expect(useWorkbench.getState().navigation?.line).toBeGreaterThan(1);
});
