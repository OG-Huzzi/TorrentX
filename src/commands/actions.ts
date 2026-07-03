import { MagnetActions } from "../services/magnet-actions.js";
import { ResultStore } from "../services/result-store.js";

export async function executeStoredAction(
  action: "magnet" | "open" | "export",
  rawIndex: string,
  file?: string,
): Promise<void> {
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("Result index must be a positive integer.");
  }

  const result = await new ResultStore().get(index);
  if (!result) {
    throw new Error("No saved result at that index. Run a search first.");
  }

  const actions = new MagnetActions();
  if (action === "magnet") {
    try {
      await actions.copy(result);
      console.log(`Copied result ${index} to the clipboard.`);
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  } else if (action === "open") {
    await actions.open(result);
    console.log(`Opened result ${index}.`);
  } else {
    const destination = await actions.export(result, file);
    console.log(`Exported result ${index} to ${destination}.`);
  }
}
