import { SNAPSHOT_VERSION, type SimulationSnapshot } from "../core/types";

/** Serialize a snapshot to a JSON string for save-to-file / storage. */
export function snapshotToJSON(snapshot: SimulationSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Parse and lightly validate a snapshot from JSON. Throws on a bad shape. */
export function snapshotFromJSON(json: string): SimulationSnapshot {
  const parsed = JSON.parse(json) as unknown;
  if (!isSnapshot(parsed)) {
    throw new Error("snapshotFromJSON: malformed snapshot");
  }
  if (parsed.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `snapshotFromJSON: unsupported version ${parsed.version} (expected ${SNAPSHOT_VERSION})`,
    );
  }
  return parsed;
}

/** Deep, structured copy of a snapshot (no shared references). */
export function cloneSnapshot(snapshot: SimulationSnapshot): SimulationSnapshot {
  return structuredClone(snapshot);
}

function isSnapshot(value: unknown): value is SimulationSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    typeof v.seed === "number" &&
    typeof v.rngState === "number" &&
    typeof v.time === "object" &&
    v.time !== null &&
    typeof v.systems === "object" &&
    v.systems !== null
  );
}
