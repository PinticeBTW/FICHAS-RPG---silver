import { getBezierPath, Position } from '@xyflow/react'
import type { LoreRelation } from './lorelinkTypes'

interface Point { x: number; y: number }
interface GraphNode { id: string; position: Point; measured?: { width?: number; height?: number } }
interface Rect extends Point { width: number; height: number }
export interface LoreRoute { sourceHandle: string; targetHandle: string; labelOffset: Point }

const tau = Math.PI * 2
const angleDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
export function lorePorts(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * tau / count, x = Math.cos(angle), y = Math.sin(angle)
    return { id: `port-${index}`, angle, x: 50 + 50 * x, y: 50 + 50 * y,
      position: Math.abs(x) >= Math.abs(y) ? x >= 0 ? Position.Right : Position.Left : y >= 0 ? Position.Bottom : Position.Top }
  })
}
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/** Presentation only: positions and factual relations are never changed.
 * Allocate facing handles and separate crowded labels deterministically, including
 * parallel and opposite-direction relations. React Flow still owns the paths. */
export function routeLoreRelations(nodes: GraphNode[], relations: LoreRelation[]) {
  const boxes = new Map(nodes.map(n => [n.id, { ...n.position, width: n.measured?.width ?? 155, height: n.measured?.height ?? 156 }]))
  const center = (id: string) => { const b = boxes.get(id)!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const shown = relations.filter(r => !r.archived && boxes.has(r.source) && boxes.has(r.target) && r.source !== r.target)
  const endpoints = new Map<string, { relation: string; end: 'sourceHandle' | 'targetHandle'; angle: number }[]>()
  for (const r of shown) for (const [id, other, end] of [[r.source, r.target, 'sourceHandle'], [r.target, r.source, 'targetHandle']] as const) {
    const a = center(id), b = center(other), angle = (Math.atan2(b.y - a.y, b.x - a.x) + tau) % tau
    const list = endpoints.get(id) ?? []; list.push({ relation: r.id, end, angle }); endpoints.set(id, list)
  }
  const counts = new Map<string, number>(), routes = new Map<string, LoreRoute>()
  for (const [id, list] of endpoints) {
    const count = Math.max(12, Math.min(32, Math.ceil((list.length + 2) / 4) * 4))
    counts.set(id, count)
    const ports = lorePorts(count), used = new Map<string, number>()
    for (const endpoint of list.sort((a, b) => a.angle - b.angle || a.relation.localeCompare(b.relation))) {
      // Prefer unused facing points. For very dense fans, reuse a facing point
      // instead of making a curve leave from the back of a bubble.
      const port = [...ports].sort((a, b) => {
        const score = (p: typeof a) => angleDistance(p.angle, endpoint.angle)
          + (used.get(p.id) ?? 0) * 1.4 + (angleDistance(p.angle, endpoint.angle) > Math.PI / 2 ? 100 : 0)
        return score(a) - score(b) || a.id.localeCompare(b.id)
      })[0]
      used.set(port.id, (used.get(port.id) ?? 0) + 1)
      const route = routes.get(endpoint.relation) ?? { sourceHandle: '', targetHandle: '', labelOffset: { x: 0, y: 0 } }
      route[endpoint.end] = port.id; routes.set(endpoint.relation, route)
    }
  }
  const point = (id: string, handle: string) => {
    const box = boxes.get(id)!, port = lorePorts(counts.get(id) ?? 12).find(p => p.id === handle)!
    return { x: box.x + box.width * port.x / 100, y: box.y + box.height * port.y / 100, position: port.position }
  }
  const labels: Rect[] = []
  for (const r of [...shown].sort((a, b) => a.id.localeCompare(b.id))) {
    const route = routes.get(r.id)!, s = point(r.source, route.sourceHandle), t = point(r.target, route.targetHandle)
    const [, x, y] = getBezierPath({ sourceX: s.x, sourceY: s.y, sourcePosition: s.position, targetX: t.x, targetY: t.y, targetPosition: t.position })
    const length = Math.hypot(t.x - s.x, t.y - s.y) || 1
    const normal = { x: -(t.y - s.y) / length, y: (t.x - s.x) / length }
    const width = Math.min(184, Math.max(72, r.label.length * 7 + 24)), height = r.label.length > 22 ? 42 : 28
    const candidates = [0, 30, -30, 60, -60, 90, -90, 120, -120].map(distance => {
      const offset = { x: normal.x * distance, y: normal.y * distance }
      const box = { x: x + offset.x - width / 2, y: y + offset.y - height / 2, width, height }
      const collisions = [...boxes.values(), ...labels].reduce((sum, obstacle) => sum + overlap(box, obstacle), 0)
      return { box, offset, score: collisions * 100 + Math.abs(distance) }
    }).sort((a, b) => a.score - b.score)
    route.labelOffset = candidates[0].offset; labels.push(candidates[0].box)
  }
  return { counts, routes }
}
