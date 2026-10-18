// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { bridge } from "../lib/bridge";
import { useWorkbench } from "../store/workbench";
import { TerminalPane } from "./TerminalPane";
const terminal=vi.hoisted(()=>({input:(_text:string)=>{}}));
vi.mock("@xterm/xterm",()=>({Terminal:class {
 options={};cols=80;rows=24;
 loadAddon(){} open(){} write(){} clear(){} dispose(){} focus(){}
 onData(callback:(text:string)=>void){terminal.input=callback;return {dispose(){}};}
}}));
vi.mock("@xterm/addon-fit",()=>({FitAddon:class{fit(){}}}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("does not replay queued terminal input after the panel was disposed",async()=>{
 vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
 useWorkbench.setState({root:"fixture",projectPath:"."});
 vi.spyOn(bridge,"onTerminalEvent").mockResolvedValue(()=>undefined);
 vi.spyOn(bridge,"terminalOpen").mockResolvedValue({id:"shell",sequence:1,data:"",exited:false});
 vi.spyOn(bridge,"terminalResize").mockResolvedValue();
 let finish!: ()=>void;
 const write=vi.spyOn(bridge,"terminalWrite").mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue();
 const ui=render(<TerminalPane/>);
 await waitFor(()=>expect(bridge.terminalOpen).toHaveBeenCalled());
 await act(async()=>{});
 act(()=>terminal.input("first"));await waitFor(()=>expect(write).toHaveBeenCalledTimes(1));
 act(()=>terminal.input("queued"));ui.unmount();
 await act(async()=>{finish();});
 expect(write).toHaveBeenCalledTimes(1);
});
