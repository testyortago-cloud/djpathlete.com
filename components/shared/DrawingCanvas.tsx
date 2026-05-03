"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import type { KonvaEventObject } from "konva/lib/Node"
import type { DrawingJson, DrawingPath, DrawingTool } from "@/types/database"

// react-konva is canvas-only — disable SSR to avoid hydration issues.
const Stage = dynamic(() => import("react-konva").then((m) => m.Stage), { ssr: false })
const Layer = dynamic(() => import("react-konva").then((m) => m.Layer), { ssr: false })
const Line = dynamic(() => import("react-konva").then((m) => m.Line), { ssr: false })
const Arrow = dynamic(() => import("react-konva").then((m) => m.Arrow), { ssr: false })
const Rect = dynamic(() => import("react-konva").then((m) => m.Rect), { ssr: false })

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
  const common = {
    key: idx,
    stroke: path.color,
    strokeWidth: path.width,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  }
  if (path.tool === "pen") {
    return <Line {...common} points={flat} />
  }
  if (path.tool === "arrow") {
    return <Arrow {...common} fill={path.color} points={flat} />
  }
  // rectangle: 2 points → x/y/width/height
  const [x1, y1] = [flat[0], flat[1]]
  const [x2, y2] = [flat[2], flat[3]]
  return (
    <Rect
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
    if (mode === "edit") props.onChange(next)
  }

  // Re-render when window resizes or container size changes (parent passes new w/h)
  useEffect(() => { /* width/height props drive reflow */ }, [width, height])

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
