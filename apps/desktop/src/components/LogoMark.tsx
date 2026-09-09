export function LogoMark({ large = false }: { large?: boolean }) {
  return (
    <div className={`logo-mark${large ? " large" : ""}`} role="img" aria-label="Notebook">
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <path d="M8 34V6h7l10 17V6h7v28h-7L15 17v17Z" transform="matrix(1.15 0 0 1.15 -3 -5)" fill="currentColor" />
      </svg>
    </div>
  );
}
