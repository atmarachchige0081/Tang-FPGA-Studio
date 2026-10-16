// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bridge } from "./bridge";
import { useProjectFileSync } from "./file-sync";
import { useWorkbench } from "../store/workbench";
function Sync() { useProjectFileSync(); return null; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const file={path:"rtl/top.sv",name:"top.sv",language:"systemverilog",content:"old",savedContent:"old"};
it("updates open buffers while the assistant is closed and preserves edits typed during a read",async () => {
 useWorkbench.setState({root:"fixture",projectPath:".",tabs:[file],activePath:file.path,tree:[],aiPanelOpen:false});
 let complete: (data: Array<{path:string;version:string;content:string;missing:boolean}>)=>void=()=>undefined;
 vi.spyOn(bridge,"syncProjectFiles").mockImplementation(()=>new Promise((resolve)=>{complete=resolve;}));
 vi.spyOn(bridge,"projectTree").mockResolvedValue([]);
 render(<Sync/>);
 await waitFor(()=>expect(bridge.syncProjectFiles).toHaveBeenCalledTimes(1));
 act(()=>useWorkbench.getState().updateFile(file.path,"typing"));
 await act(async()=>{complete([{path:file.path,version:"2",content:"agent edit",missing:false}]);});
 expect(useWorkbench.getState().tabs[0]?.content).toBe("typing");
 expect(useWorkbench.getState().tabs[0]?.externalContent).toBe("agent edit");
});
it("ignores a late response from a previous project",async () => {
 useWorkbench.setState({root:"fixture",projectPath:"old",tabs:[file],tree:[]});
 let complete: (data: Array<{path:string;version:string;content:string;missing:boolean}>)=>void=()=>undefined;
 vi.spyOn(bridge,"syncProjectFiles").mockImplementationOnce(()=>new Promise((resolve)=>{complete=resolve;})).mockResolvedValue([]);
 vi.spyOn(bridge,"projectTree").mockResolvedValue([]);
 render(<Sync/>);
 await waitFor(()=>expect(bridge.syncProjectFiles).toHaveBeenCalledTimes(1));
 act(()=>useWorkbench.setState({projectPath:"new",tabs:[{...file,content:"new project",savedContent:"new project"}]}));
 await act(async()=>{complete([{path:file.path,version:"2",content:"old project's edit",missing:false}]);});
 expect(useWorkbench.getState().tabs[0]?.content).toBe("new project");
});

it("keeps healthy files updating when another file cannot be read",async () => {
 useWorkbench.setState({root:"fixture",projectPath:".",tabs:[file],tree:[],output:[]});
 vi.spyOn(bridge,"syncProjectFiles").mockResolvedValue([{path:"missing/top.sv",version:"",content:null,missing:false,error:"Folder unavailable"},{path:file.path,version:"2",content:"healthy update",missing:false}]);
 vi.spyOn(bridge,"projectTree").mockResolvedValue([]);
 render(<Sync/>);
 await waitFor(()=>expect(useWorkbench.getState().tabs[0]?.content).toBe("healthy update"));
 expect(useWorkbench.getState().output.some((line)=>line.message.includes("Folder unavailable"))).toBe(true);
});
