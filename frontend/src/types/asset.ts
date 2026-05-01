/**
 * Asset types — shared between AssetPanel, ProjectHome, and future components.
 * Matches the DB schema in backend/db.js assets table.
 */

export type AssetType = 'CHARACTER' | 'SCENE' | 'PROP'

/** Local (in-component) asset item, used during generation in AssetPanel */
export interface AssetItem {
  id: string
  type: AssetType
  name: string
  desc: string
  prompt: string
  selected: boolean
  dbId?: string  // set after DB persist
}

/** Persisted asset from the /api/assets endpoint */
export interface DbAsset {
  id: string
  projectId: string
  userId: string
  type: AssetType
  name: string
  description: string
  prompt: string
  imageUrl: string | null
  savedId: string | null
  tags: string[]
  createdAt: string
  usedInProjects: string[]
}

export const TYPE_LABEL: Record<AssetType, string> = {
  CHARACTER: '角色',
  SCENE: '场景',
  PROP: '道具',
}

export const TYPE_COLOR: Record<AssetType, string> = {
  CHARACTER: 'rgba(99,179,237,0.15)',
  SCENE:     'rgba(104,211,145,0.15)',
  PROP:      'rgba(246,173,85,0.15)',
}
