// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { bridge } from "./bridge";
import { openWorkspaceLocation } from "./navigation";
import { useWorkbench } from "../store/workbench";
afterEach(() => vi.restoreAllMocks());
it("does not open an old project's pending read in the newly selected project", async () => {
 useWorkbench.setState({root:"workspace",projectPath:"old",tabs:[],navigation:null});
 let finish!: (value:string)=>void;
 vi.spyOn(bridge,"readText").mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const pending=openWorkspaceLocation("rtl/top.sv");
 useWorkbench.getState().setWorkspace("workspace","New","new",[]);
 finish("old project contents"); await pending;
 expect(useWorkbench.getState().tabs).toEqual([]);
 expect(useWorkbench.getState().navigation).toBeNull();
});
it("still opens a location in the current project",async()=>{
 useWorkbench.setState({root:"workspace",projectPath:"demo",tabs:[],navigation:null});
 vi.spyOn(bridge,"readText").mockResolvedValue("module top; endmodule");
 await openWorkspaceLocation("rtl/top.sv",4,2);
 expect(useWorkbench.getState().tabs[0]?.path).toBe("demo/rtl/top.sv");
 expect(useWorkbench.getState().navigation).toMatchObject({path:"demo/rtl/top.sv",line:4,column:2});
});
it("can navigate an open unsaved buffer even when its disk file was deleted",async()=>{
 const file={path:"demo/rtl/top.sv",name:"top.sv",language:"systemverilog",content:"unsaved",savedContent:"saved"};
 useWorkbench.setState({root:"workspace",projectPath:"demo",tabs:[file],activePath:null});
 const read=vi.spyOn(bridge,"readText").mockRejectedValue(Error("file missing"));
 await openWorkspaceLocation("rtl/top.sv",8,2);
 expect(read).not.toHaveBeenCalled();
 expect(useWorkbench.getState().activePath).toBe(file.path);
});
