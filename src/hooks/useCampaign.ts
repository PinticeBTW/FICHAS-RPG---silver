import { useCampaignContext } from '../providers/CampaignProvider'

export function useCampaign() {
  return useCampaignContext()
}
