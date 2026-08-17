import { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Notes: (p: IconProps) => (
    <I {...p}>
      <path d="M7 3h8l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </I>
  ),
  Shortcuts: (p: IconProps) => (
    <I {...p}>
      <polygon
        points="12 3 14.5 9.5 21.5 10.2 16.2 14.8 17.8 21.5 12 18.2 6.2 21.5 7.8 14.8 2.5 10.2 9.5 9.5"
        fill="currentColor"
        stroke="none"
      />
    </I>
  ),
  Notebooks: (p: IconProps) => (
    <I {...p}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 3v18" />
    </I>
  ),
  Tags: (p: IconProps) => (
    <I {...p}>
      <path d="M3 12l9-9h8v8l-9 9z" />
      <circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </I>
  ),
  Templates: (p: IconProps) => (
    <I {...p}>
      <rect x="4" y="4" width="10" height="14" rx="1.2" />
      <path d="M10 8h10v12a1.2 1.2 0 0 1-1.2 1.2H10" />
      <path d="M7 9h4M7 12h4" />
    </I>
  ),
  Trash: (p: IconProps) => (
    <I {...p}>
      <path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13" />
    </I>
  ),
  Search: (p: IconProps) => (
    <I {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </I>
  ),
  Plus: (p: IconProps) => (
    <I {...p}>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  Chevron: (p: IconProps) => (
    <I {...p}>
      <path d="M8 10l4 4 4-4" />
    </I>
  ),
  Gear: (p: IconProps) => (
    <I {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 6.2l1.6 1.6M17.5 16.2l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.8l1.6-1.6M17.5 7.8l1.6-1.6" />
    </I>
  ),
  Pin: (p: IconProps) => (
    <I {...p}>
      <path d="M9 4h6l-1 7h3l-5 8-5-8h3z" />
    </I>
  ),
  Reminder: (p: IconProps) => (
    <I {...p}>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l2.5 1.5M9 4h6M5 6l1.5 2M19 6l-1.5 2" />
    </I>
  ),
  Paperclip: (p: IconProps) => (
    <I {...p}>
      <path d="M8.5 12.5l7-7a3.2 3.2 0 1 1 4.5 4.5l-8.2 8.2a4.5 4.5 0 0 1-6.4-6.4l7.5-7.5" />
    </I>
  ),
  Sidebar: (p: IconProps) => (
    <I {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </I>
  ),
  Print: (p: IconProps) => (
    <I {...p}>
      <path d="M7 8V4h10v4M7 16H5a2 2 0 0 1-2-2v-4h18v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="12" width="10" height="8" rx="1" />
    </I>
  ),
  Close: (p: IconProps) => (
    <I {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </I>
  ),
  Import: (p: IconProps) => (
    <I {...p}>
      <path d="M12 4v10M8 10l4 4 4-4M5 18h14" />
    </I>
  ),
  Bold: (p: IconProps) => (
    <I {...p}>
      <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
    </I>
  ),
  Italic: (p: IconProps) => (
    <I {...p}>
      <path d="M12 5h6M8 19h6M14.5 5l-5 14" />
    </I>
  ),
  Underline: (p: IconProps) => (
    <I {...p}>
      <path d="M7 5v7a5 5 0 0 0 10 0V5M6 19h12" />
    </I>
  ),
  Strike: (p: IconProps) => (
    <I {...p}>
      <path d="M5 12h14M8 7c1.2-1.5 6.5-2 8 1M8 17c1.8 1.8 8 1.4 8-1.2" />
    </I>
  ),
  List: (p: IconProps) => (
    <I {...p}>
      <path d="M9 7h11M9 12h11M9 17h11M5 7h.01M5 12h.01M5 17h.01" />
    </I>
  ),
  Ordered: (p: IconProps) => (
    <I {...p}>
      <path d="M10 7h11M10 12h11M10 17h11M5 6.5v3M4.5 9.5H6M4.5 15.5h2.2L4.5 18h2.3" />
    </I>
  ),
  Check: (p: IconProps) => (
    <I {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l3 3 5-6" />
    </I>
  ),
  Quote: (p: IconProps) => (
    <I {...p}>
      <path d="M7 17c2-3 3-5 3-8H6c0 3 1 5 1 8h0zM16 17c2-3 3-5 3-8h-4c0 3 1 5 1 8h0z" />
    </I>
  ),
  Code: (p: IconProps) => (
    <I {...p}>
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </I>
  ),
  Link: (p: IconProps) => (
    <I {...p}>
      <path d="M10 13a5 5 0 0 0 7.5.5l1.5-1.5a5 5 0 0 0-7-7L11 6" />
      <path d="M14 11a5 5 0 0 0-7.5-.5L5 12a5 5 0 0 0 7 7l1.1-.9" />
    </I>
  ),
  Attach: (p: IconProps) => (
    <I {...p}>
      <path d="M8.5 12.5l7-7a3.2 3.2 0 1 1 4.5 4.5l-8.2 8.2a4.5 4.5 0 0 1-6.4-6.4l7.5-7.5" />
    </I>
  ),
  Heading: (p: IconProps) => (
    <I {...p}>
      <path d="M6 5v14M18 5v14M6 12h12" />
    </I>
  ),
  More: (p: IconProps) => (
    <I {...p}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </I>
  ),
  Application: (p: IconProps) => (
    <I {...p}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 9h16" />
    </I>
  ),
  Keyboard: (p: IconProps) => (
    <I {...p}>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <path d="M7 11h.01M11 11h.01M15 11h.01M8.5 15h7" />
    </I>
  ),
  Account: (p: IconProps) => (
    <I {...p}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 19c1.2-3 3.5-4.5 7-4.5S17.8 16 19 19" />
    </I>
  ),
  Advanced: (p: IconProps) => (
    <I {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </I>
  ),
  Info: (p: IconProps) => (
    <I {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5M12 8h.01" />
    </I>
  ),
};
