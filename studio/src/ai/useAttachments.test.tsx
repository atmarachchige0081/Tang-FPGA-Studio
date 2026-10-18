// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as files from "./attachments";
import { useAttachments } from "./useAttachments";
import type { AiAttachment } from "../types";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("does not carry a late file read into another project", async () => {
  let finish!: (value:AiAttachment)=>void;
  vi.spyOn(files,"readAttachment").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const hook=renderHook(({scope})=>useAttachments(scope),{initialProps:{scope:"project A"}});
  let operation!:Promise<void>;
  act(()=>{operation=hook.result.current.add([new File(["rtl"],"top.sv")]);});
  expect(hook.result.current.loading).toBe(true);
  hook.rerender({scope:"project B"});
  await act(async()=>{finish({kind:"text",name:"top.sv",text:"old project source"});await operation;});
  expect(hook.result.current.attachments).toEqual([]);
  expect(hook.result.current.loading).toBe(false);
});
it("keeps earlier attachments when a later batch fails", async () => {
  const hook=renderHook(()=>useAttachments("project A"));
  await act(async()=>{await hook.result.current.add([new File(["rtl"],"top.sv")]);});
  await act(async()=>{await hook.result.current.add([new File(["secret"],".env")]);});
  expect(hook.result.current.attachments.map(file=>file.name)).toEqual(["top.sv"]);
  expect(hook.result.current.error).toContain("Sensitive");
});
