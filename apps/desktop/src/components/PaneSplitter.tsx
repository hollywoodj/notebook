import { useRef } from "react";

export function PaneSplitter({
  label,
  className,
  onDrag,
}: {
  label: string;
  className?: string;
  onDrag: (delta: number) => void;
}) {
  const lastX = useRef<number | null>(null);

  return (
    <div
      className={className ? `pane-splitter ${className}` : "pane-splitter"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        lastX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastX.current == null || !event.currentTarget.hasPointerCapture(event.pointerId)) {
          return;
        }
        const delta = event.clientX - lastX.current;
        lastX.current = event.clientX;
        if (delta) onDrag(delta);
      }}
      onPointerUp={(event) => {
        lastX.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
    />
  );
}
