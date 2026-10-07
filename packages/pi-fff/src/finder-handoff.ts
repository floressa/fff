import type { FileFinderApi } from "@ff-labs/fff-node";

/**
 * Hands the cwd picker from one extension instance to the next across a pi
 * session replacement (/new, /resume, /fork, /reload).
 *
 * Pi tears the extension down and loads it again (jiti, moduleCache: false) on
 * every replacement, so module state does not survive. Without a handoff each
 * switch destroys the index and rescans the same tree. The slot lives on
 * globalThis so the next instance in this process can claim it.
 */

const SLOT = Symbol.for("@ff-labs/pi-fff/finder-handoff");

/** Shutdown reasons after which pi starts another session in this process. */
const REPLACEMENT_REASONS: ReadonlySet<string> = new Set([
  "new",
  "resume",
  "fork",
  "reload",
]);

export interface FinderHandoff {
  /** Identifies the cwd and options the picker was opened with. */
  key: string;
  /** The picker, or its in-flight creation. */
  finder: Promise<FileFinderApi>;
}

type Slot = { [SLOT]?: FinderHandoff };

export function isReplacement(reason: unknown): boolean {
  return typeof reason === "string" && REPLACEMENT_REASONS.has(reason);
}

/** Leave a picker for the next instance. Replaces (and destroys) an unclaimed one. */
export function parkFinder(handoff: FinderHandoff): void {
  const slot = globalThis as Slot;
  const previous = slot[SLOT];
  slot[SLOT] = handoff;
  if (previous && previous.finder !== handoff.finder) discardFinder(previous);
}

/** Take the parked picker, if any. The caller owns it from now on. */
export function takeParkedFinder(): FinderHandoff | null {
  const slot = globalThis as Slot;
  const handoff = slot[SLOT] ?? null;
  delete slot[SLOT];
  return handoff;
}

/** Destroy a handed-off picker once its creation settles. */
export function discardFinder(handoff: FinderHandoff): void {
  handoff.finder.then(
    (finder) => {
      if (!finder.isDestroyed) finder.destroy();
    },
    () => undefined,
  );
}

/**
 * Resolve a handoff: the picker when its key matches. Otherwise destroy it and
 * return null; it is gone before the caller opens a new picker on the same
 * databases.
 */
export async function claimFinder(
  handoff: FinderHandoff,
  key: string,
): Promise<FileFinderApi | null> {
  const finder = await handoff.finder.catch(() => null);
  if (!finder || finder.isDestroyed) return null;
  if (handoff.key === key) return finder;
  finder.destroy();
  return null;
}
