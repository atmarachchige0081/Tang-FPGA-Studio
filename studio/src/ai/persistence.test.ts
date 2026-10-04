import { describe, expect, it } from "vitest";
import { defaultAiSettings, readActiveThread, readAiSettings, writeActiveThread, writeAiSettings } from "./persistence";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("AI noncredential persistence", () => {
  it("persists settings without accepting arbitrary fields", () => {
    const storage = memory();
    writeAiSettings({ ...defaultAiSettings, model: "gpt-5.6", alwaysAllowFileEdits: true }, storage);
    expect(readAiSettings(storage)).toMatchObject({ model: "gpt-5.6", alwaysAllowFileEdits: true });
    storage.values.set("fpga-studio.ai.settings.v1", JSON.stringify({ model: "../../bad", apiKey: "must-not-load" }));
    expect(readAiSettings(storage).model).toBe("");
    expect(readAiSettings(storage)).not.toHaveProperty("apiKey");
  });

  it("isolates active threads by project and rejects corrupt identifiers", () => {
    const storage = memory();
    writeActiveThread("projects/one", "thread-1", storage);
    expect(readActiveThread("projects/one", storage)).toBe("thread-1");
    expect(readActiveThread("projects/two", storage)).toBeNull();
    writeActiveThread("projects/one", null, storage);
    expect(readActiveThread("projects/one", storage)).toBeNull();
  });

  it("fails safely when storage is unavailable", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); } };
    expect(readAiSettings(blocked)).toEqual(defaultAiSettings);
    expect(readActiveThread("project", blocked)).toBeNull();
  });
});
