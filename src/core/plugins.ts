import { pathToFileURL } from "node:url";
import type { SourceAdapter } from "../types/search.js";
import type { HttpClient } from "../services/http-client.js";

function isSourceAdapter(value: unknown): value is SourceAdapter {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SourceAdapter>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.reliability === "number" &&
    Array.isArray(candidate.mediaTypes) &&
    typeof candidate.search === "function"
  );
}

/**
 * Load plugin source adapters from user-supplied module paths (the `plugins`
 * entries of the user-level config file). Each module may export:
 *   - a SourceAdapter instance as `default` or `source`, or
 *   - a factory `createSource(http)` / `default(http)` returning one.
 *
 * Invalid modules fail loudly with the offending path — a silently skipped
 * plugin is impossible to debug.
 */
export async function loadPluginSources(
  paths: readonly string[],
  http: HttpClient,
): Promise<SourceAdapter[]> {
  const loaded: SourceAdapter[] = [];

  for (const pluginPath of paths) {
    let module: Record<string, unknown>;
    try {
      module = (await import(pathToFileURL(pluginPath).href)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to load source plugin ${pluginPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const exported = module["createSource"] ?? module["source"] ?? module["default"];
    const value =
      typeof exported === "function"
        ? (exported as (http: HttpClient) => unknown)(http)
        : exported;

    if (!isSourceAdapter(value)) {
      throw new Error(
        `Source plugin ${pluginPath} does not export a valid SourceAdapter ` +
          "(needs id, name, reliability, mediaTypes and a search function).",
      );
    }
    loaded.push(value);
  }

  return loaded;
}
