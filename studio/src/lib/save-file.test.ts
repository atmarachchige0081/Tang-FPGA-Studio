import { afterEach, expect, it, vi } from "vitest";
import { bridge } from "./bridge";
import { persistFile } from "./save-file";
import { useWorkbench } from "../store/workbench";
afterEach(()=>vi.restoreAllMocks());
it("does not apply an old project's save acknowledgement to a new same-path buffer",async()=>{
 const file={path:"rtl/top.sv",name:"top.sv",language:"systemverilog",content:"submitted",savedContent:"old"};
 useWorkbench.setState({root:"fixture",projectPath:"old",tabs:[file]});
 let finish!: ()=>void;
 vi.spyOn(bridge,"writeText").mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const pending=persistFile("fixture","old",file);
 const other={...file,content:"new project edits",savedContent:"new project disk"};
 useWorkbench.getState().setWorkspace("fixture","New","new",[]);
 useWorkbench.getState().openFile(other);
 finish(); expect(await pending).toBe(false);
 expect(useWorkbench.getState().tabs[0]).toEqual(other);
});
it("keeps typing made during a successful save dirty",async()=>{
 const file={path:"rtl/top.sv",name:"top.sv",language:"systemverilog",content:"submitted",savedContent:"old"};
 useWorkbench.setState({root:"fixture",projectPath:".",tabs:[file]});
 let finish!: ()=>void;
 vi.spyOn(bridge,"writeText").mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const pending=persistFile("fixture",".",file);
 useWorkbench.getState().updateFile(file.path,"new typing");
 finish(); expect(await pending).toBe(true);
 expect(useWorkbench.getState().tabs[0]).toMatchObject({content:"new typing",savedContent:"submitted"});
});
it("does not mark a failed write saved",async()=>{
 const file={path:"rtl/top.sv",name:"top.sv",language:"systemverilog",content:"submitted",savedContent:"old"};
 useWorkbench.setState({root:"fixture",projectPath:".",tabs:[file]});
 vi.spyOn(bridge,"writeText").mockRejectedValue(Error("disk full"));
 await expect(persistFile("fixture",".",file)).rejects.toThrow("disk full");
 expect(useWorkbench.getState().tabs[0]).toEqual(file);
});
