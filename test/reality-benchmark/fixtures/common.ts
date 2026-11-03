export const UNKNOWN = "UNKNOWN" as const;

export function isObservedValue(value: unknown): boolean {
  return typeof value === "number" || value === UNKNOWN || value === null || typeof value === "string";
}
