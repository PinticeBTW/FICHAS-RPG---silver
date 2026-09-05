import { memo, useEffect, useMemo, useState } from 'react'
import { Background, ConnectionMode, Controls, Handle, MarkerType, ReactFlow, applyNodeChanges, useUpdateNodeInternals, type Node,
  type NodeProps, type ReactFlowInstance, type XYPosition } from '@xyflow/react'
import { Building2, CalendarDays, CircleHelp, MapPin, Package, UserRound } from 'lucide-react'
import { SharedMediaImage } from '../shared/SharedMediaImage'
import { loreKinds, type LoreData, type LoreEntity, type LoreKind } from '../../lib/lorelinkTypes'
import { lorePorts, routeLoreRelations } from '../../lib/lorelinkGraph'
import { LoreEdge, type LoreFlowEdge } from './LoreEdge'
import '@xyflow/react/dist/style.css'

const symbols = { person: UserRound, event: CalendarDays, location: MapPin, organization: Building2, object: Package, note: CircleHelp }
type BubbleNode = Node<{ entity: LoreEntity; portCount?: number }, 'lore'>
export type LoreMapInstance = ReactFlowInstance<BubbleNode, LoreFlowEdge>
const Bubble = memo(function Bubble({ id, data, selected, isConnectable }: NodeProps<BubbleNode>) {
  const { entity } = data
  const count = data.portCount ?? 12
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => { updateInternals(id) }, [id, count, updateInternals])
  const Icon = symbols[entity.kind as LoreKind]
  return <div className={`lore-bubble ${selected ? 'is-selected' : ''}`} data-kind={entity.kind}>
    {lorePorts(count).map((port, index) => <Handle key={port.id} id={port.id} type="source" position={port.position} isConnectable={isConnectable}
      aria-label={`Ponto de ligação ${index + 1}`} title="Arrasta para outra bolha para criar uma relação"
      style={{ left: `${port.x}%`, top: `${port.y}%`, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />)}
    <div className="lore-bubble__portrait">
      {entity.image ? <SharedMediaImage source={entity.image} variant="thumbnail" alt="" /> : <Icon size={28} />}
    </div>
    <strong>{entity.name}</strong><span>{loreKinds[entity.kind]}</span>
  </div>
})
const nodeTypes = { lore: Bubble }
const edgeTypes = { lore: LoreEdge }

interface Props {
  data: LoreData; entities: LoreEntity[]; selected: string | null;
  onSelect: (id: string) => void; onCreate: (position: XYPosition) => void;
  onMove: (id: string, position: XYPosition) => void; onConnect: (source: string, target: string) => void;
  onRelation: (id: string) => void; onReady: (flow: LoreMapInstance) => void;
}
export function LoreMap({ data, entities, selected, onSelect, onCreate, onMove, onConnect, onRelation, onReady }: Props) {
  const [flow, setFlow] = useState<LoreMapInstance | null>(null)
  const [dragPositions, setDragPositions] = useState<Record<string, XYPosition>>({})
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({})
  const entityMap = useMemo(() => new Map(entities.map(e => [e.id, e])), [entities])
  const nodes: BubbleNode[] = useMemo(() => data.nodes.filter(n => !n.hidden && entityMap.has(n.entity_id)).map(n => ({
    id: n.entity_id, type: 'lore', position: dragPositions[n.entity_id] ?? { x: n.x, y: n.y },
    measured: measurements[n.entity_id],
    data: { entity: entityMap.get(n.entity_id)! }, selected: selected === n.entity_id,
    ariaLabel: `${loreKinds[entityMap.get(n.entity_id)!.kind]}: ${entityMap.get(n.entity_id)!.name}`,
  })), [data.nodes, entityMap, selected, dragPositions, measurements])
  const routing = useMemo(() => routeLoreRelations(nodes, data.relations), [nodes, data.relations])
  const portNodes = useMemo(() => nodes.map(n => ({ ...n, data: { ...n.data, portCount: routing.counts.get(n.id) ?? 12 } })), [nodes, routing])
  const edges: LoreFlowEdge[] = data.relations.filter(r => routing.routes.has(r.id)).map(r => ({
    id: r.id, type: 'lore', source: r.source, target: r.target, label: r.label,
    sourceHandle: routing.routes.get(r.id)!.sourceHandle, targetHandle: routing.routes.get(r.id)!.targetHandle,
    data: { offset: routing.routes.get(r.id)!.labelOffset, onOpen: onRelation,
      name: `Relação: ${entityMap.get(r.source)?.name} → ${r.label} → ${entityMap.get(r.target)?.name}` },
    markerEnd: { type: MarkerType.ArrowClosed, color: r.visibility === 'private' ? '#89969e' : '#f3e600' },
    style: { stroke: r.visibility === 'private' ? '#89969e' : '#f3e600', strokeWidth: 1.5 },
    ariaLabel: `Relação: ${r.label}`,
  }))
  return <div className="lore-map" aria-label="Mapa da História" onDoubleClick={event => {
    if (data.role === 'player' || !(event.target as Element).classList.contains('react-flow__pane')) return
    onCreate(flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 0, y: 0 })
  }}>
    <ReactFlow<BubbleNode, LoreFlowEdge> nodes={portNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} colorMode="dark"
      connectionMode={ConnectionMode.Loose} isValidConnection={connection => connection.source !== connection.target}
      onInit={instance => { setFlow(instance); onReady(instance) }} fitView fitViewOptions={{ maxZoom: 1.1, padding: 0.25 }} minZoom={0.15} maxZoom={2.5}
      deleteKeyCode={null} zoomOnDoubleClick={false} nodesDraggable={data.role !== 'player'} nodesConnectable={data.role !== 'player'}
      onNodeClick={(_, node) => onSelect(node.id)} onEdgeClick={(_, edge) => onRelation(edge.id)}
      onNodesChange={changes => {
        const dimensions = changes.filter(c => c.type === 'dimensions')
        if (dimensions.length) setMeasurements(current => {
          const next = { ...current }
          for (const change of dimensions) if (change.dimensions) next[change.id] = change.dimensions
          return next
        })
        const changed = applyNodeChanges(changes.filter(c => c.type === 'position'), nodes)
        setDragPositions(current => {
          const next = { ...current }
          for (const change of changes) if (change.type === 'position' && change.dragging) {
            const node = changed.find(n => n.id === change.id); if (node) next[node.id] = node.position
          }
          return next
        })
      }}
      onNodeDragStop={(_, node) => {
        onMove(node.id, node.position)
        setDragPositions(current => { const next = { ...current }; delete next[node.id]; return next })
      }}
      onConnect={connection => onConnect(connection.source, connection.target)}>
      <Background gap={28} size={1} color="#303437" />
      <Controls showInteractive={false} />
    </ReactFlow>
    {!nodes.length && <div className="lore-map-empty"><CircleHelp size={32} /><h2>{data.role !== 'player' ? data.character_id ? 'A tua história começa aqui.' : 'O teu universo começa aqui.' : 'História do universo'}</h2>
      <p>{data.role !== 'player'
        ? entities.length ? 'Coloca uma ficha no mapa ou ajusta os filtros.' : 'Cria a primeira ficha para começar a ligar a tua história.'
        : entities.length ? 'Consulta a vista Fichas ou ajusta os filtros.' : 'As fichas reveladas pelo GM aparecem aqui. Esta conta tem acesso de leitura.'}</p>
      {data.role !== 'player' && <button className="signal-button" onClick={() => onCreate({ x: 0, y: 0 })}>+ Criar ficha</button>}
    </div>}
    <p className="lore-map-hint">Arrasta o fundo para explorar · Usa a roda para ampliar{data.role !== 'player' ? ' · Liga os pontos das bolhas' : ''}</p>
  </div>
}
