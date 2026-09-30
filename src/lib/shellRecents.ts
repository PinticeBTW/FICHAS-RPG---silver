export function readRecentSheetIds(userId: string): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`ghost-grid:recents:v1:${userId}`) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
export function rememberSheet(userId: string, sheetId: string) {
  try {
    localStorage.setItem(
      `ghost-grid:recents:v1:${userId}`,
      JSON.stringify(
        [
          sheetId,
          ...readRecentSheetIds(userId).filter((id) => id !== sheetId),
        ].slice(0, 8),
      ),
    );
  } catch {
    /* Optional history. */
  }
}
