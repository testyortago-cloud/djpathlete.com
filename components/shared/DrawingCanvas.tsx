"use client"

// IMPORTANT: this component MUST be loaded by its consumers via
// `next/dynamic` with `{ ssr: false }`. react-konva uses canvas APIs
// that don't exist on the server. Per-primitive dynamic imports
// (Stage, Layer, ...) blow up on Next 16's `'default' in module` check
// because react-konva's class instances mishandle the `in` operator.
// Lifting `ssr: false` up to the consumer is the supported pattern.

import { useRef, useState } from "react"
import { Stage, Layer, Line, Arrow, Rect, Circle, Group } from "react-konva"
import type { KonvaEventObject } from "konva/lib/Node"
import type { DrawingJson, DrawingPath, DrawingTool } from "@/types/database"

interface ViewProps {
  mode: "view"
  width: number
  height: number
  drawing: DrawingJson | null
}

interface EditProps {
  mode: "edit"
  width: number
  height: number
  /** Active drawing tool. New strokes use this tool until it changes. */
  tool: DrawingTool
  /** Active stroke color (must be one of the picker's hex values). */
  color: string
  /** Stroke width in pixels (2-8). */
  strokeWidth: number
  /** The drawing being authored. Parent owns state. */
  drawing: DrawingJson
  /** Called whenever the drawing's paths change. */
  onChange: (drawing: DrawingJson) => void
}

type Props = ViewProps | EditProps

/** Project a normalized [0,1] point to pixel coords for the current size. */
function project(p: [number, number], w: number, h: number): [number, number] {
  return [p[0] * w, p[1] * h]
}

/** Inverse: pixel → normalized [0,1]. */
function normalize(x: number, y: number, w: number, h: number): [number, number] {
  return [
    Math.max(0, Math.min(1, x / w)),
    Math.max(0, Math.min(1, y / h)),
  ]
}

function flatten(points: Array<[number, number]>, w: number, h: number): number[] {
  const out: number[] = []
  for (const p of points) {
    const [px, py] = project(p, w, h)
    out.push(px, py)
  }
  return out
}

function renderPath(path: DrawingPath, idx: number, w: number, h: number) {
  const flat = flatten(path.points, w, h)
  // Common visual props — `key` is intentionally NOT here, React 19 forbids
  // spreading a `key` and the dev warning is fatal in strict mode.
  const common = {
    stroke: path.color,
    strokeWidth: path.width,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  }
  if (path.tool === "pen") {
    return <Line key={idx} {...common} points={flat} />
  }
  if (path.tool === "arrow") {
    return <Arrow key={idx} {...common} fill={path.color} points={flat} />
  }
  if (path.tool === "pin") {
    // Loom-style drop-pin (1 point). Radius scales with stroke width.
    const [x, y] = [flat[0], flat[1]]
    const r = Math.max(10, path.width * 2.5)
    return (
      <Group key={idx} x={x} y={y}>
        {/* Soft drop shadow */}
        <Circle radius={r + 2} fill="rgba(0,0,0,0.35)" y={1.5} />
        {/* Filled badge */}
        <Circle radius={r} fill={path.color} stroke="#ffffff" strokeWidth={2} />
        {/* Inner dot for sharper read */}
        <Circle radius={Math.max(2, r * 0.25)} fill="#ffffff" />
      </Group>
    )
  }
  // rectangle: 2 points → x/y/width/height
  const [x1, y1] = [flat[0], flat[1]]
  const [x2, y2] = [flat[2], flat[3]]
  return (
    <Rect
      key={idx}
      {...common}
      x={Math.min(x1, x2)}
      y={Math.min(y1, y2)}
      width={Math.abs(x2 - x1)}
      height={Math.abs(y2 - y1)}
      fillEnabled={false}
    />
  )
}

export function DrawingCanvas(props: Props) {
  const { mode, width, height } = props
  const drawing = props.drawing ?? { paths: [] }

  // Edit-mode state for the in-progress path
  const [draftPath, setDraftPath] = useState<DrawingPath | null>(null)
  const drawingRef = useRef<DrawingJson>(drawing)
  drawingRef.current = drawing

  function pointerXY(e: KonvaEventObject<PointerEvent>): [number, number] | null {
    const stage = e.target.getStage()
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    return normalize(pos.x, pos.y, width, height)
  }

  function onPointerDown(e: KonvaEventObject<PointerEvent>) {
    if (mode !== "edit") return
    const xy = pointerXY(e)
    if (!xy) return

    // Pin is a single-click placement — no drag, no draft phase.
    if (props.tool === "pin") {
      const pinPath: DrawingPath = {
        tool: "pin",
        color: props.color,
        width: props.strokeWidth,
        points: [xy],
      }
      props.onChange({ paths: [...drawingRef.current.paths, pinPath] })
      return
    }

    setDraftPath({
      tool: props.tool,
      color: props.color,
      width: props.strokeWidth,
      points: [xy, xy],
    })
  }

  function onPointerMove(e: KonvaEventObject<PointerEvent>) {
    if (mode !== "edit" || !draftPath) return
    const xy = pointerXY(e)
    if (!xy) return
    setDraftPath((prev) => {
      if (!prev) return prev
      if (prev.tool === "pen") {
        return { ...prev, points: [...prev.points, xy] }
      }
      // arrow + rectangle: keep first point, update second
      return { ...prev, points: [prev.points[0], xy] }
    })
  }

  function onPointerUp() {
    if (mode !== "edit" || !draftPath) return
    const next: DrawingJson = {
      paths: [...drawingRef.current.paths, draftPath],
    }
    setDraftPath(null)
    props.onChange(next)
  }

  return (
    <div
      className={mode === "edit" ? "pointer-events-auto" : "pointer-events-none"}
      style={{ width, height }}
    >
      <Stage
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <Layer>
          {drawing.paths.map((p, i) => renderPath(p, i, width, height))}
          {draftPath && renderPath(draftPath, drawing.paths.length, width, height)}
        </Layer>
      </Stage>
    </div>
  )
}
