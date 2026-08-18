export type CyberwareGroupId =
  | 'cortex'
  | 'operatingSystem'
  | 'skeleton'
  | 'face'
  | 'nervousSystem'
  | 'armsHands'
  | 'legsFeet'
  | 'circulatorySystem'

export interface Cyberware {
  id: string
  name: string
  slotType: CyberwareGroupId
  description: string
  cyberCost: number
  shieldValue: number
  icon?: string
  playerCanView?: boolean
  playerCanEquip?: boolean
  allowedViewerProfileIds?: string[]
  allowedEquipperProfileIds?: string[]
}

export interface EquippedCyberwareSlotData {
  cyberwareId: string
}

export type EquippedCyberwareState = {
  [key in CyberwareGroupId]: (Cyberware | null)[]
}

export type SelectedSlot = {
  groupId: CyberwareGroupId
  slotIndex: number
} | null

export interface CyberwareTotals {
  cyberTotal: number
  shieldTotal: number
}
