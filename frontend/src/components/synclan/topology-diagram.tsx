"use client";

import { useMemo } from "react";

export interface TopologyNode {
  name: string;
  ip: string;
  status: "UP" | "STALE";
  is_admin?: boolean;
  free_ram_mb: number;
}

interface TopologyDiagramProps {
  nodes: TopologyNode[];
}

// Layout: admin node in the center, clients placed around it on a circle.
// Compute positions deterministically so the layout is stable between renders.
function computeLayout(nodes: TopologyNode[]) {
  const W = 360;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const radius = 105;

  // Find admin (or 127.0.0.1) to put in center
  const adminIdx = nodes.findIndex(
    (n) => n.is_admin || n.ip === "127.0.0.1"
  );

  const ordered = [...nodes];
  let admin: TopologyNode | null = null;
  if (adminIdx >= 0) {
    admin = ordered.splice(adminIdx, 1)[0];
  } else if (ordered.length > 0) {
    admin = ordered.shift() ?? null;
  }

  const clientPositions = ordered.map((n, i) => {
    const angle = (i / Math.max(ordered.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      node: n,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });

  return { W, H, cx, cy, admin, clientPositions };
}

export function TopologyDiagram({ nodes }: TopologyDiagramProps) {
  const layout = useMemo(() => computeLayout(nodes), [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        No nodes connected
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${layout.W} ${layout.H}`}
        className="w-full"
        role="img"
        aria-label="Network topology diagram"
      >
        <defs>
          <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.78 0.18 160 / 0.5)" />
            <stop offset="100%" stopColor="oklch(0.78 0.18 160 / 0)" />
          </radialGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="oklch(0.78 0.18 160 / 0.6)" />
            <stop offset="100%" stopColor="oklch(0.72 0.13 180 / 0.6)" />
          </linearGradient>
        </defs>

        {/* subtle grid */}
        <g opacity="0.4">
          {[0, 60, 120, 180, 240, 300, 360].map((x) => (
            <line
              key={`v${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={layout.H}
              stroke="oklch(1 0 0 / 0.04)"
            />
          ))}
          {[0, 56, 112, 168, 224, 280].map((y) => (
            <line
              key={`h${y}`}
              x1={0}
              y1={y}
              x2={layout.W}
              y2={y}
              stroke="oklch(1 0 0 / 0.04)"
            />
          ))}
        </g>

        {/* glow under admin */}
        <circle cx={layout.cx} cy={layout.cy} r={48} fill="url(#centerGrad)" />

        {/* connection lines + animated flow */}
        {layout.clientPositions.map((p, i) => {
          const isUp = p.node.status === "UP";
          const stroke = isUp
            ? "url(#lineGrad)"
            : "oklch(0.65 0.22 22 / 0.4)";
          return (
            <g key={`${p.node.ip}-${i}`}>
              {/* base line */}
              <line
                x1={layout.cx}
                y1={layout.cy}
                x2={p.x}
                y2={p.y}
                stroke={stroke}
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
              {/* animated dashed flow on top (only when UP) */}
              {isUp && (
                <line
                  x1={layout.cx}
                  y1={layout.cy}
                  x2={p.x}
                  y2={p.y}
                  stroke="oklch(0.78 0.18 160 / 0.9)"
                  strokeWidth={2}
                  className="animate-flow"
                />
              )}
            </g>
          );
        })}

        {/* client nodes */}
        {layout.clientPositions.map((p, i) => {
          const isUp = p.node.status === "UP";
          const fill = isUp
            ? "oklch(0.78 0.18 160 / 0.18)"
            : "oklch(0.65 0.22 22 / 0.18)";
          const stroke = isUp
            ? "oklch(0.78 0.18 160 / 0.7)"
            : "oklch(0.65 0.22 22 / 0.7)";
          return (
            <g key={`client-${p.node.ip}-${i}`}>
              {/* pulse ring on UP clients */}
              {isUp && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={12}
                  fill="none"
                  stroke="oklch(0.78 0.18 160 / 0.5)"
                  strokeWidth={1}
                  className="pulse-ring"
                  style={{ transformOrigin: `${p.x}px ${p.y}px` }}
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={11}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.5}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={3}
                fill={isUp ? "oklch(0.85 0.18 160)" : "oklch(0.65 0.22 22)"}
              />
              <text
                x={p.x}
                y={p.y + 24}
                textAnchor="middle"
                fontSize={8}
                fill="oklch(0.7 0.01 220)"
                fontFamily="monospace"
              >
                {p.node.name.length > 12
                  ? p.node.name.slice(0, 11) + "…"
                  : p.node.name}
              </text>
            </g>
          );
        })}

        {/* admin node (center) */}
        {layout.admin && (
          <g>
            <circle
              cx={layout.cx}
              cy={layout.cy}
              r={18}
              fill="oklch(0.78 0.18 160 / 0.18)"
              stroke="oklch(0.85 0.18 160)"
              strokeWidth={2}
            />
            <circle
              cx={layout.cx}
              cy={layout.cy}
              r={6}
              fill="oklch(0.85 0.18 160)"
            />
            <text
              x={layout.cx}
              y={layout.cy + 36}
              textAnchor="middle"
              fontSize={9}
              fontWeight="bold"
              fill="oklch(0.85 0.18 160)"
              fontFamily="monospace"
            >
              ADMIN
            </text>
            <text
              x={layout.cx}
              y={layout.cy + 48}
              textAnchor="middle"
              fontSize={7}
              fill="oklch(0.6 0.01 220)"
              fontFamily="monospace"
            >
              {layout.admin.name}
            </text>
          </g>
        )}
      </svg>

      {/* legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          UP
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          STALE
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full border border-emerald-400/70" />
          Admin node
        </span>
      </div>
    </div>
  );
}
