import { useRef } from "react";

export function PaneSplitter({
  label,
  className,
  onDrag,
}: {
  label: string;
  className?: string;
  /** `position` is the pointer offset from the left edge of the pane grid. */
  onDrag: (delta: number, position: number) => void;
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
        const gridLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
        if (delta) onDrag(delta, event.clientX - gridLeft);
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
