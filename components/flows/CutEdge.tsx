"use client";

import { createContext, useContext, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from "@xyflow/react";
import { Scissors } from "lucide-react";

/** False on a read-only canvas: lines can't be cut there. */
export const EdgeEditContext = createContext(true);

/**
 * A connection line with a scissors button in its middle, shown while the
 * pointer is on the line or the line is selected. Clicking it cuts the line
 * (same as selecting it and pressing Delete, which still works).
 */
export function CutEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const editable = useContext(EdgeEditContext);
  const { deleteElements } = useReactFlow();
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const showCut = editable && (hover || selected);

  return (
    <>
      <g onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          interactionWidth={22}
          style={{
            ...style,
            ...(selected || hover ? { stroke: "var(--flow-edge-active)", strokeWidth: 3.5 } : null),
          }}
        />
      </g>
      {showCut && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan absolute w-7 h-7 rounded-full bg-white dark:bg-[#1f2c33] border border-gray-200 shadow-md flex items-center justify-center text-gray-500 hover:text-red-500 hover:border-red-300 cursor-pointer"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
            title="Cut this line"
            aria-label="Cut this line"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
