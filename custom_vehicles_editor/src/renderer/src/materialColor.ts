export function materialColor(material: string): string {
  const named: Record<string, string> = {
    RED_CONCRETE: '#b63a3a',
    BLUE_CONCRETE: '#345cb8',
    YELLOW_CONCRETE: '#e0bd34',
    WHITE_CONCRETE: '#d8dcdf',
    BLACK_CONCRETE: '#202328',
    GRAY_CONCRETE: '#62676d',
    LIGHT_GRAY_CONCRETE: '#9ca1a4',
    GLASS: '#a7d9df',
    TINTED_GLASS: '#4f5365',
    IRON_BLOCK: '#c8ced0',
    GOLD_BLOCK: '#f0cb44',
    STONE: '#7d8185',
    OAK_PLANKS: '#b58b50',
    SEA_LANTERN: '#b7e3d4',
    GLOWSTONE: '#d6a64a'
  }
  const exact = named[material]
  if (exact !== undefined) return exact
  let hash = 2166136261
  for (const character of material) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 34% 50%)`
}
