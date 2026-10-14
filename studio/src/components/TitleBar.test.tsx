// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { version } from "../../package.json";
import { TitleBar } from "./TitleBar";

describe("title bar release label", () => {
  it("shows the packaged application version", () => {
    const { container } = render(<TitleBar onRun={() => undefined} onSave={() => undefined} />);
    expect(container.querySelector(".version-chip")?.textContent).toBe(version);
  });
});
