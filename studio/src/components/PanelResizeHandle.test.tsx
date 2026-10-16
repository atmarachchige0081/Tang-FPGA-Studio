// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PanelResizeHandle, usePanelLayout } from "./PanelResizeHandle";
beforeEach(() => { localStorage.clear(); usePanelLayout.setState({ sizes: { sidebar:240,assistant:390,bottom:220 } }); });
afterEach(cleanup);
it("resizes by keyboard, persists dimensions and resets a panel independently", () => {
  render(<PanelResizeHandle panel="sidebar"/>);
  const handle = screen.getByRole("separator",{name:"Resize sidebar"});
  fireEvent.keyDown(handle,{key:"ArrowRight",shiftKey:true});
  expect(usePanelLayout.getState().sizes.sidebar).toBe(280);
  expect(JSON.parse(localStorage.getItem("fpga-studio.layout")!).sidebar).toBe(280);
  fireEvent.doubleClick(handle);
  expect(usePanelLayout.getState().sizes).toEqual({sidebar:240,assistant:390,bottom:220});
});
it("bounds vertical resizing and gives upward arrows more output space", () => {
  render(<PanelResizeHandle panel="bottom"/>);
  const handle=screen.getByRole("separator",{name:"Resize bottom panel"});
  fireEvent.keyDown(handle,{key:"ArrowUp"});
  expect(usePanelLayout.getState().sizes.bottom).toBe(230);
  for(let i=0;i<100;i++) fireEvent.keyDown(handle,{key:"ArrowDown"});
  expect(usePanelLayout.getState().sizes.bottom).toBe(100);
});
