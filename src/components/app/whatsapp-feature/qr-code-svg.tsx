"use client";

import * as React from "react";
import { generateQRMatrix } from "@/lib/whatsapp/qr-generator";

interface QRCodeSvgProps {
  value: string;
  size?: number;
  className?: string;
}

export function QRCodeSvg({ value, size = 224, className }: QRCodeSvgProps) {
  const matrix = React.useMemo(() => {
    try {
      return generateQRMatrix(value);
    } catch {
      return generateQRMatrix("skelo-whatsapp-lead-capture");
    }
  }, [value]);

  const margin = 2;
  const n = matrix.length;
  const viewSize = n + margin * 2;

  return (
    <div className="bg-white p-2.5 rounded-xl border border-border/80 shadow-xs flex items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${viewSize} ${viewSize}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className={className}
      >
        <rect width="100%" height="100%" fill="#ffffff" />
        {matrix.map((row, r) =>
          row.map((cell, c) =>
            cell ? (
              <rect
                key={`${r}-${c}`}
                x={c + margin}
                y={r + margin}
                width="1"
                height="1"
                fill="#052820"
              />
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}

