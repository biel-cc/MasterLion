import {
  get as getAtPath,
  has as hasAtPath,
  isPlainObject,
  set as setAtPath,
  toPath,
  unset as unsetAtPath,
} from 'es-toolkit/compat';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';
import type { PartialDeep } from 'type-fest';

import type { AgentItem, LobeAgentConfig } from '@/types/agent';

import type { AgentSliceState } from './initialState';

export type AgentMap = AgentSliceState['agentMap'];

/**
 * Paths this update actually writes through the deep merge. Arrays and scalars
 * are leaves because `merge` replaces them wholesale; `undefined` writes
 * nothing and an empty object merges to a no-op, so neither owns a path.
 */
// `isPlainObject` from es-toolkit/compat returns a plain boolean, so narrow the
// unknown ourselves to keep `Object.entries` typed.
const isPlainRecord = (value: unknown): value is Record<string, unknown> => isPlainObject(value);

const collectWrittenPaths = (value: unknown, prefix: string[], out: string[][]): void => {
  if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectWrittenPaths(child, [...prefix, key], out);
    }
    return;
  }

  if (value === undefined || prefix.length === 0) return;

  out.push(prefix);
};

const isPathPrefix = (prefix: string[], path: string[]): boolean =>
  prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);

const arePathsOverlapping = (a: string[], b: string[]): boolean =>
  isPathPrefix(a, b) || isPathPrefix(b, a);

const pathKey = (path: string[]): string => JSON.stringify(path);

/**
 * The paths an update owns: every replaced subtree (the whole subtree is one
 * unit, so leaves under it are dropped) plus the deep-merged leaves.
 */
const resolveWrittenPaths = (
  data: PartialDeep<LobeAgentConfig>,
  replacePaths?: string[],
): string[][] => {
  // Mirrors internal_dispatchAgentMap: a replace path with no value in the
  // payload is skipped there, so it never wrote anything to undo.
  const replaced = (replacePaths ?? [])
    .filter((path) => getAtPath(data, path) !== undefined)
    .map((path) => toPath(path));

  const merged: string[][] = [];
  collectWrittenPaths(data, [], merged);

  return [
    ...replaced,
    ...merged.filter((path) => !replaced.some((prefix) => isPathPrefix(prefix, path))),
  ];
};

/** What one path held at a point in time, and whether it existed at all. */
interface PathState {
  /** Whether the path exists, so a later deletion is not mistaken for a value. */
  present: boolean;
  value: unknown;
}

/**
 * How far along a claimed write is.
 *
 * `open` is a write nobody can ever undo: a plain dispatch — a fetch, a server
 * response, a meta save — or an optimistic one in the instant before its caller
 * snapshots it. `settled` is an optimistic write the server confirmed. Both are
 * permanent, so they end the reachable history below them. `pending` may still
 * fail; `failed` already has, and is waiting to be undone (a tombstone).
 */
type WriteState = 'failed' | 'open' | 'pending' | 'settled';

const isPermanent = (entry: WriteEntry): boolean =>
  entry.state === 'open' || entry.state === 'settled';

/** One dispatch's write on one path. */
interface WriteEntry {
  /** Whether the agent entry itself existed before this write created it. */
  agentPresent: boolean;
  /** What the path held before this write landed — where undoing it returns to. */
  base: PathState;
  /** How deep the path already existed, so undoing only removes husks this write created. */
  existingDepth: number;
  path: string[];
  state: WriteState;
  ticket: number;
  /** What the write actually left at the path; filled in by `snapshotWrite`. */
  written?: PathState;
}

/** One agent's ledger: path -> every write on it that can still matter, oldest first. */
type PathHistories = Map<string, WriteEntry[]>;

/**
 * One request's optimistic write. Opaque to callers: hand it back to
 * {@link AgentWriteLedger.settleWrite}, {@link AgentWriteLedger.abandonWrite}
 * or {@link AgentWriteLedger.rollbackWrite}.
 */
export interface PendingOptimisticWrite {
  agentId: string;
  ticket: number;
}

const capturePathState = (
  agent: PartialDeep<AgentItem> | undefined,
  path: string[],
): PathState => ({
  present: agent !== undefined && hasAtPath(agent, path),
  value: agent === undefined ? undefined : getAtPath(agent, path),
});

/** The depth of the deepest ancestor of `path` that already existed. */
const existingAncestorDepth = (
  agent: PartialDeep<AgentItem> | undefined,
  path: string[],
): number => {
  let depth = 0;

  for (let candidate = 1; candidate < path.length; candidate += 1) {
    if (agent === undefined || !hasAtPath(agent, path.slice(0, candidate))) break;
    depth = candidate;
  }

  return depth;
};

const entriesOf = (histories: PathHistories, ticket: number): WriteEntry[] => {
  const found: WriteEntry[] = [];

  for (const entries of histories.values()) {
    for (const entry of entries) if (entry.ticket === ticket) found.push(entry);
  }

  return found;
};

/**
 * Drop the entries no rollback can reach again: undoing only pops failed writes
 * off the top of a path, so everything under the newest permanent write on it is
 * unreachable. This is what keeps a path's history to the writes still in flight
 * on it plus one barrier, instead of one entry per dispatch for the life of the tab.
 */
const pruneUnreachable = (entries: WriteEntry[]): void => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!isPermanent(entries[index])) continue;

    entries.splice(0, index);
    return;
  }
};

const removeEntry = (histories: PathHistories, entry: WriteEntry): void => {
  const key = pathKey(entry.path);
  const entries = histories.get(key);
  if (!entries) return;

  const index = entries.indexOf(entry);
  if (index !== -1) entries.splice(index, 1);
  if (entries.length === 0) histories.delete(key);
};

/**
 * Drop writes that can never own visible state again because a newer permanent
 * write overlaps them. A pending optimistic write is deliberately not a
 * barrier: if it fails, its predecessor must still be able to unwind.
 */
const pruneBehindPermanentWrites = (histories: PathHistories): void => {
  const allEntries = [...histories.values()].flat();

  for (const entry of allEntries) {
    const isUnreachable = allEntries.some(
      (other) =>
        other.ticket > entry.ticket &&
        isPermanent(other) &&
        arePathsOverlapping(other.path, entry.path),
    );
    if (isUnreachable) removeEntry(histories, entry);
  }
};

/**
 * Whether some newer write that has not failed still stands on an overlapping
 * path — the one thing that stops a failed write from being undone.
 *
 * Overlap counts in both directions: restoring a subtree would wipe a later leaf
 * write inside it, and restoring a leaf would reach into a later subtree replace
 * around it. A *failed* newer write does not block, which is what lets a chain of
 * failures unwind: it is undone first (this sweep runs newest first), and its own
 * predecessor is then free to undo itself back to the value that predates them all.
 */
const isBlocked = (histories: PathHistories, entry: WriteEntry): boolean => {
  for (const entries of histories.values()) {
    for (const other of entries) {
      if (other.ticket <= entry.ticket || other.state === 'failed') continue;
      if (arePathsOverlapping(other.path, entry.path)) return true;
    }
  }

  return false;
};

/** The newest failed write nothing newer stands on, or nothing if none can move. */
const nextUndoable = (histories: PathHistories): WriteEntry | undefined => {
  let best: WriteEntry | undefined;

  for (const entries of histories.values()) {
    for (const entry of entries) {
      if (entry.state !== 'failed') continue;
      if (best !== undefined && entry.ticket < best.ticket) continue;
      if (isBlocked(histories, entry)) continue;

      best = entry;
    }
  }

  return best;
};

/**
 * Secondary guard, on top of the history: the value must also still be the one we
 * wrote. The ledger only sees writes that go through `internal_dispatchAgentMap`,
 * so this catches a path changed by something that sets `agentMap` directly. It is
 * a backstop, not the ownership test — a same-value write is caught by the ticket,
 * which this check cannot see.
 */
const stillHoldsWrittenValue = (current: PartialDeep<AgentItem>, entry: WriteEntry): boolean => {
  const { written } = entry;
  if (!written) return false;

  if (hasAtPath(current, entry.path) !== written.present) return false;
  if (!written.present) return true;

  return isEqual(getAtPath(current, entry.path), written.value);
};

/** Put back what the write found at its path, husks and all. */
const restoreEntry = (current: PartialDeep<AgentItem>, entry: WriteEntry): void => {
  // `present`, not a value check: it is what separates "was `undefined`" from
  // "was absent", so a key this write created is deleted rather than left behind
  // as an explicit `undefined`.
  if (entry.base.present) {
    setAtPath(current, entry.path, entry.base.value);
    return;
  }

  unsetAtPath(current, entry.path);

  // Drop the empty object husks this write created on the way to the leaf,
  // stopping at the deepest ancestor that predates it.
  for (let depth = entry.path.length - 1; depth > entry.existingDepth; depth -= 1) {
    const ancestorPath = entry.path.slice(0, depth);

    // Checked structurally rather than via `isPlainObject` because this reads
    // through an immer draft proxy.
    const ancestor: unknown = getAtPath(current, ancestorPath);
    if (typeof ancestor !== 'object' || ancestor === null) break;
    if (Array.isArray(ancestor) || Object.keys(ancestor).length > 0) break;

    unsetAtPath(current, ancestorPath);
  }
};

/**
 * Per-path write history for `agentMap`, so a failed optimistic update can undo
 * exactly what it wrote — and nothing a later write took over — while still
 * handing its own predecessor back the ownership it took.
 *
 * The invariant: for every path, the writes that landed on it are kept in ticket
 * order with the state each one found there. A write may be undone only when no
 * newer write on an overlapping path is still standing, and undoing it restores
 * the state *that write* found — which is the previous write's value, so the
 * previous write can then undo itself in turn. A chain of failures therefore
 * unwinds to the value that predates all of them, in either failure order, while
 * a single surviving write anywhere above holds the whole chain in place.
 *
 * Deliberately kept out of `agentMap`, which is persisted and handed to the
 * browser as agent config — a version stamp stored there would show up in the
 * user's saved config and travel to the server. Ownership lifetime is instead
 * tied to the agent entry: an agent that leaves the map — deleted here or by any
 * other slice — takes its history with it.
 *
 * Ownership is identified by a monotonic ticket, never by value: two writes that
 * happen to set the same value are different writes, so the older one must not be
 * able to claim the newer one's state, and a path cycled A → B → A is not back in
 * the hands of whoever wrote the first A.
 */
export class AgentWriteLedger {
  /** agent id -> its write history. */
  readonly #ledgers = new Map<string, PathHistories>();
  #lastTicket = 0;

  /**
   * Claim every path a dispatch is about to write.
   *
   * Call before the write lands, and before any no-op check: re-writing the value
   * a pending request already put there is still a write, and it has to take the
   * path over, or that request could later roll the value back out from under it.
   *
   * @param agentMap the map as it is now — before this dispatch — so each path's
   *   pre-write state is recorded, and so an entry that is gone takes the history
   *   of every request still in flight against it with it.
   * @returns the ticket this dispatch claimed, to be handed to `snapshotWrite`.
   */
  claimWrite = (
    agentMap: AgentMap,
    id: string,
    data: PartialDeep<LobeAgentConfig>,
    replacePaths?: string[],
  ): number => {
    this.#releaseMissingAgents(agentMap);

    this.#lastTicket += 1;
    const ticket = this.#lastTicket;

    const paths = resolveWrittenPaths(data, replacePaths);
    // A dispatch that writes nothing owns nothing, and must not open a history.
    if (paths.length === 0) return ticket;

    let histories = this.#ledgers.get(id);
    if (!histories) {
      histories = new Map();
      this.#ledgers.set(id, histories);
    } else {
      // A prior `open` entry is known to be a plain dispatch now: optimistic
      // callers snapshot synchronously before another dispatch can begin.
      pruneBehindPermanentWrites(histories);
    }

    const agent = agentMap[id];

    for (const path of paths) {
      const key = pathKey(path);
      let entries = histories.get(key);
      if (!entries) {
        entries = [];
        histories.set(key, entries);
      }

      pruneUnreachable(entries);
      entries.push({
        agentPresent: agent !== undefined,
        base: capturePathState(agent, path),
        existingDepth: existingAncestorDepth(agent, path),
        path,
        // Nothing can undo it until its caller snapshots it, on the next line of
        // the optimistic update; a plain dispatch never does, and stays permanent.
        state: 'open',
        ticket,
      });
    }

    return ticket;
  };

  /**
   * Record what the dispatch just landed, and mark it undoable.
   *
   * @param agentMap the map as it is *after* the optimistic dispatch.
   */
  snapshotWrite = (agentMap: AgentMap, id: string, ticket: number): PendingOptimisticWrite => {
    const histories = this.#ledgers.get(id);
    const agent = agentMap[id];

    for (const entry of histories ? entriesOf(histories, ticket) : []) {
      entry.state = 'pending';
      entry.written = capturePathState(agent, entry.path);
    }

    return { agentId: id, ticket };
  };

  /**
   * The server confirmed the write: it is permanent now, and an older request
   * failing later must not undo it.
   */
  settleWrite = ({ agentId, ticket }: PendingOptimisticWrite): void => {
    const histories = this.#ledgers.get(agentId);
    if (!histories) return;

    for (const entry of entriesOf(histories, ticket)) {
      entry.state = 'settled';
      pruneUnreachable(histories.get(pathKey(entry.path)) ?? []);
    }
    pruneBehindPermanentWrites(histories);
  };

  /**
   * Give an aborted request's ownership up without immediately changing the
   * visible value. The normal caller aborts only because a replacement request
   * is starting; if that replacement also fails, the tombstone lets the
   * rollback continue past the aborted value instead of stopping on it.
   */
  abandonWrite = ({ agentId, ticket }: PendingOptimisticWrite): void => {
    const histories = this.#ledgers.get(agentId);
    if (!histories) return;

    for (const entry of entriesOf(histories, ticket)) entry.state = 'failed';
  };

  /**
   * Undo the paths this update wrote, plus any earlier failure they were holding
   * down. Restoring the whole pre-update agent would discard a concurrent
   * successful write — e.g. a meta update that landed while this config save was
   * in flight — and undoing a path a later write took over would overwrite the
   * winner with a value older than either, a silent data loss the user never sees.
   */
  rollbackWrite = (agentMap: AgentMap, { agentId, ticket }: PendingOptimisticWrite): AgentMap => {
    const histories = this.#ledgers.get(agentId);
    if (!histories) return agentMap;

    for (const entry of entriesOf(histories, ticket)) entry.state = 'failed';

    const next = this.#undoFailedWrites(agentMap, agentId, histories);

    // The rollback may have removed the agent it created.
    this.#releaseMissingAgents(next);

    return next;
  };

  /**
   * Undo every failed write nothing newer stands on, newest first — so a subtree
   * is restored only after the leaf writes inside it are, and each write hands its
   * predecessor back the state that predecessor left.
   */
  #undoFailedWrites = (agentMap: AgentMap, id: string, histories: PathHistories): AgentMap => {
    // A newer write already dropped the entry; it owns the state now.
    if (!agentMap[id]) return agentMap;

    return produce(agentMap, (draft) => {
      const current = draft[id];
      if (!current) return;

      let undidCreation = false;

      for (let entry = nextUndoable(histories); entry; entry = nextUndoable(histories)) {
        // Drop the record first: undone or skipped, this write is over either way,
        // and it must not keep a path — an env key the user has since deleted, say —
        // on the ledger for the rest of the session.
        removeEntry(histories, entry);

        if (!stillHoldsWrittenValue(current, entry)) continue;

        restoreEntry(current, entry);
        undidCreation ||= !entry.agentPresent;
      }

      // The entry only existed because of the writes just undone, and nothing else
      // has written to it since.
      if (undidCreation && Object.keys(current).length === 0) delete draft[id];
    });
  };

  /** An agent's history only means anything while the agent is in the map. */
  #releaseMissingAgents = (agentMap: AgentMap): void => {
    for (const id of this.#ledgers.keys()) {
      if (!(id in agentMap)) this.#ledgers.delete(id);
    }
  };
}
