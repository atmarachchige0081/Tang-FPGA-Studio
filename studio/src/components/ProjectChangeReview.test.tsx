// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import { ProjectChangeReview } from "./ProjectChangeReview";
vi.mock("../lib/monaco-loader",()=>({}));
vi.mock("@monaco-editor/react",()=>({DiffEditor:({original,modified,options}:{original:string;modified:string;options:{readOnly:boolean}})=><div aria-label="File diff"><pre>{original}</pre><pre>{modified}</pre><span>{options.readOnly?"Read only":"Editable"}</span></div>}));
const change={path:"rtl/top.sv",before:"module before;",after:"module after;",kind:"modified" as const,revision:3,hunks:[{oldStart:1,oldLines:1,newStart:1,newLines:1}]};
beforeEach(()=>useWorkbench.setState({root:"fixture",projectPath:".",fileChanges:[change],fileChangeRevision:3,changeReviewOpen:true,changeReviewPath:change.path,changeTrackingLimited:false}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("shows before and after for a file without a Git repository or AI provider",()=>{
 render(<ProjectChangeReview/>);
 expect(screen.getByText("module before;")).toBeTruthy();expect(screen.getByText("module after;")).toBeTruthy();
 expect(screen.getByText("Read only")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Close change review"}));
 expect(useWorkbench.getState().changeReviewOpen).toBe(false);
});
it("marks only the displayed revision reviewed without writing source files",async()=>{
 const mark=vi.spyOn(bridge,"markChangeReviewed").mockResolvedValue();
 const write=vi.spyOn(bridge,"writeText");
 vi.spyOn(bridge,"pollProjectChanges").mockResolvedValue({revision:4,changes:[],limited:false});
 render(<ProjectChangeReview/>);
 fireEvent.click(screen.getByRole("button",{name:"Mark file reviewed"}));
 await waitFor(()=>expect(mark).toHaveBeenCalledWith("fixture",".",change.path,3));
 await waitFor(()=>expect(useWorkbench.getState().fileChanges).toHaveLength(0));
 expect(write).not.toHaveBeenCalled();
});
