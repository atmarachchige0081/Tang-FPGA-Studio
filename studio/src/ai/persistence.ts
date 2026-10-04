export interface AiSettings {
  model: string;
  effort: string;
  alwaysAllowFileEdits: boolean;
  includeDiagnostics: boolean;
  includeToolOutput: boolean;
}

const settingsKey = "fpga-studio.ai.settings.v1";

export const defaultAiSettings: AiSettings = {
  model: "",
  effort: "",
  alwaysAllowFileEdits: false,
  includeDiagnostics: true,
  includeToolOutput: true,
};

export function readAiSettings(storage?: Pick<Storage, "getItem">): AiSettings {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(settingsKey) ?? "{}");
    return {
      model: typeof value.model === "string" && /^[A-Za-z0-9._-]{0,100}$/.test(value.model) ? value.model : "",
      effort: typeof value.effort === "string" && ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value.effort) ? value.effort : "",
      alwaysAllowFileEdits: value.alwaysAllowFileEdits === true,
      includeDiagnostics: value.includeDiagnostics !== false,
      includeToolOutput: value.includeToolOutput !== false,
    };
  } catch {
    return { ...defaultAiSettings };
  }
}

export function writeAiSettings(settings: AiSettings, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // The settings remain active for this session when storage is unavailable.
  }
}

function threadKey(projectPath: string): string {
  let hash = 2166136261;
  for (const character of projectPath.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fpga-studio.ai.thread.${(hash >>> 0).toString(16)}`;
}

export function readActiveThread(projectPath: string, storage?: Pick<Storage, "getItem">): string | null {
  try {
    const value = (storage ?? localStorage).getItem(threadKey(projectPath));
    return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeActiveThread(projectPath: string, threadId: string | null, storage?: Pick<Storage, "setItem" | "removeItem">): void {
  try {
    const target = storage ?? localStorage;
    if (threadId) target.setItem(threadKey(projectPath), threadId);
    else target.removeItem(threadKey(projectPath));
  } catch {
    // App Server retains history even if the active UI selection cannot be stored.
  }
}
