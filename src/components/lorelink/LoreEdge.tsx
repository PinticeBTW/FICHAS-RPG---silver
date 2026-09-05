import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'

export type LoreFlowEdge = Edge<{ offset: { x: number; y: number }; name: string; onOpen: (id: string) => void }, 'lore'>
export function LoreEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, data }: EdgeProps<LoreFlowEdge>) {
  const [path, x, y] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const offset = data?.offset ?? { x: 0, y: 0 }
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={18} />
    {Math.hypot(offset.x, offset.y) > 1 && <path className="lore-label-guide" d={`M ${x} ${y} L ${x + offset.x} ${y + offset.y}`} />}
    <EdgeLabelRenderer><button className="lore-edge-label nodrag nopan" title={data?.name} aria-label={data?.name}
      style={{ transform: `translate(-50%, -50%) translate(${x + offset.x}px, ${y + offset.y}px)` }}
      onClick={() => data?.onOpen(id)}>{label}</button></EdgeLabelRenderer>
  </>
}
