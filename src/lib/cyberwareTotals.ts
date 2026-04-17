import type { CyberwareTotals, EquippedCyberwareState } from '../types/cyberware'

export function calculateCyberwareTotals(equippedCyberware: EquippedCyberwareState): CyberwareTotals {
  let cyberTotal = 0
  let shieldTotal = 0

  for (const slots of Object.values(equippedCyberware)) {
    for (const cyberware of slots) {
      if (!cyberware) {
        continue
      }

      cyberTotal += cyberware.cyberCost
      shieldTotal += cyberware.shieldValue
    }
  }

  return { cyberTotal, shieldTotal }
}
