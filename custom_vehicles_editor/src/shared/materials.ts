import materialData from './block-materials.json'

export interface BlockMaterialCatalog {
  paperVersion: string
  generated: boolean
  materials: string[]
}

const GENERATED_MATERIALS = materialData satisfies string[]

export const BLOCK_MATERIAL_CATALOG: BlockMaterialCatalog = {
  paperVersion: '1.21.1',
  generated: true,
  materials: GENERATED_MATERIALS
}
export const BLOCK_MATERIALS = Object.freeze([...GENERATED_MATERIALS].sort())
export const BLOCK_MATERIAL_SET: ReadonlySet<string> = new Set(BLOCK_MATERIALS)

export function isBlockMaterial(value: string): boolean {
  return BLOCK_MATERIAL_SET.has(value)
}
