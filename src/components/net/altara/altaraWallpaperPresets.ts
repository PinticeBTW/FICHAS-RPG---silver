export const altaraWallpaperPresetIds = [
  'altara-nocturne',
  'altara-atlas',
  'altara-silk',
] as const

export type AltaraWallpaperPresetId = (typeof altaraWallpaperPresetIds)[number]

export function isAltaraWallpaperPresetId(value: unknown): value is AltaraWallpaperPresetId {
  return typeof value === 'string'
    && altaraWallpaperPresetIds.some((presetId) => presetId === value)
}

export function altaraWallpaperPresetToTheme(id: AltaraWallpaperPresetId) {
  return id.replace('altara-', '') as 'nocturne' | 'atlas' | 'silk'
}
