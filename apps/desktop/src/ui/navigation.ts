export type NavLocation = {
  filter: {
    type: string;
    id?: string;
    name?: string;
    query?: string;
  };
  noteId: string | null;
};

export function sameNavLocation(a: NavLocation, b: NavLocation): boolean {
  if ((a.noteId || null) !== (b.noteId || null)) return false;
  if (a.filter.type !== b.filter.type) return false;
  if ((a.filter.id || "") !== (b.filter.id || "")) return false;
  if ((a.filter.query || "") !== (b.filter.query || "")) return false;
  return true;
}

export function pushNavHistory(
  past: NavLocation[],
  current: NavLocation,
  next: NavLocation,
  limit = 50
): { past: NavLocation[]; future: NavLocation[] } | null {
  if (sameNavLocation(current, next)) return null;
  return {
    past: [...past, current].slice(-limit),
    future: [],
  };
}

export function stepNavBack(
  past: NavLocation[],
  current: NavLocation,
  future: NavLocation[]
): { past: NavLocation[]; current: NavLocation; future: NavLocation[] } | null {
  if (!past.length) return null;
  return {
    past: past.slice(0, -1),
    current: past[past.length - 1],
    future: [current, ...future],
  };
}

export function stepNavForward(
  past: NavLocation[],
  current: NavLocation,
  future: NavLocation[]
): { past: NavLocation[]; current: NavLocation; future: NavLocation[] } | null {
  if (!future.length) return null;
  const [next, ...rest] = future;
  return {
    past: [...past, current],
    current: next,
    future: rest,
  };
}

export const LAST_SESSION_KEY = "notebook.lastSession";

export type LastSession = NavLocation;

export function parseLastSession(raw: string | null): LastSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastSession>;
    if (!parsed || typeof parsed !== "object" || !parsed.filter?.type) return null;
    return {
      filter: {
        type: String(parsed.filter.type),
        id: parsed.filter.id,
        name: parsed.filter.name,
        query: parsed.filter.query,
      },
      noteId: parsed.noteId || null,
    };
  } catch {
    return null;
  }
}
