/**
 * Hybrid Logical Clock (HLC) implementation.
 *
 * WHY HLC instead of wall-clock timestamps:
 * - Wall clocks drift across devices — two clients can assign the same millisecond
 *   to events that happened in different causal orders.
 * - HLC guarantees: if event A causally happened before event B, hlc(A) < hlc(B).
 * - The logical counter handles multiple events in the same millisecond.
 * - nodeId as tiebreaker makes comparison fully deterministic — same event set
 *   always produces the same total order on every device.
 *
 * Reference: Kulkarni et al., "Logical Physical Clocks and Consistent Snapshots
 * in Globally Distributed Databases" (HLC paper, 2014).
 */

export interface HLC {
  /** Wall-clock time in milliseconds since epoch */
  wallTime: number;
  /** Monotonic counter for events within the same millisecond */
  logical: number;
  /** Stable client identifier — used as tiebreaker to ensure total order */
  nodeId: string;
}

/**
 * Serialize HLC to a lexicographically sortable string.
 * Format: "{wallTime_15digits}-{logical_5digits}-{nodeId}"
 *
 * Lexicographic sort of these strings equals causal order — this is what
 * we store in the DB and use for LWW comparisons.
 */
export function hlcToString(hlc: HLC): string {
  return (
    `${hlc.wallTime.toString().padStart(15, '0')}-` +
    `${hlc.logical.toString().padStart(5, '0')}-` +
    `${hlc.nodeId}`
  );
}

/**
 * Deserialize HLC string back to struct.
 * Splits on first two dashes only — nodeId may contain dashes.
 */
export function hlcFromString(s: string): HLC {
  const firstDash = s.indexOf('-');
  const secondDash = s.indexOf('-', firstDash + 1);
  return {
    wallTime: parseInt(s.slice(0, firstDash), 10),
    logical: parseInt(s.slice(firstDash + 1, secondDash), 10),
    nodeId: s.slice(secondDash + 1),
  };
}

/**
 * Compare two HLCs. Returns:
 *  negative if a < b (a happened before b)
 *  zero     if a === b (same event — should only happen for same nodeId)
 *  positive if a > b (a happened after b)
 *
 * Ordering: wallTime → logical → nodeId (lexicographic)
 * This is a total order — given the same event set, every device
 * produces the same ordering and therefore the same final state.
 */
export function compareHLC(a: HLC, b: HLC): number {
  if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
  if (a.logical !== b.logical) return a.logical - b.logical;
  return a.nodeId.localeCompare(b.nodeId);
}

/** Convenience: compare serialized strings without deserializing */
export function compareHLCStrings(a: string, b: string): number {
  // Lexicographic comparison works directly because of our padding scheme
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Generate a new HLC timestamp for a local send event.
 *
 * Rules (from HLC paper):
 * 1. Take max(localWallTime, now)  — never go backwards
 * 2. If max == last known time, increment logical counter
 * 3. Otherwise, reset logical to 0
 *
 * @param nodeId   - stable client ID (e.g. "A", "B")
 * @param lastHLC  - the last HLC this node generated (undefined on first call)
 */
export function hlcNow(nodeId: string, lastHLC?: HLC): HLC {
  const now = Date.now();
  if (!lastHLC) {
    return { wallTime: now, logical: 0, nodeId };
  }

  const maxWall = Math.max(now, lastHLC.wallTime);
  if (maxWall === lastHLC.wallTime) {
    // Same millisecond as last event — bump logical counter
    return { wallTime: maxWall, logical: lastHLC.logical + 1, nodeId };
  }
  // Wall clock advanced — reset logical
  return { wallTime: maxWall, logical: 0, nodeId };
}

/**
 * Advance local HLC on receipt of a remote message with hlc `remote`.
 *
 * Rules (from HLC paper, receive step):
 * 1. new wallTime = max(local.wallTime, remote.wallTime, now)
 * 2. If all three are equal: new logical = max(local.logical, remote.logical) + 1
 * 3. If local or remote is max: new logical = that max's logical + 1
 * 4. If now is max: new logical = 0
 *
 * This ensures the local clock always advances past the received message.
 */
export function receiveHLC(local: HLC, remote: HLC): HLC {
  const now = Date.now();
  const maxWall = Math.max(local.wallTime, remote.wallTime, now);

  if (maxWall === local.wallTime && maxWall === remote.wallTime) {
    return {
      wallTime: maxWall,
      logical: Math.max(local.logical, remote.logical) + 1,
      nodeId: local.nodeId,
    };
  }
  if (maxWall === local.wallTime) {
    return { wallTime: maxWall, logical: local.logical + 1, nodeId: local.nodeId };
  }
  if (maxWall === remote.wallTime) {
    return { wallTime: maxWall, logical: remote.logical + 1, nodeId: local.nodeId };
  }
  // now is the largest — clock jumped forward
  return { wallTime: maxWall, logical: 0, nodeId: local.nodeId };
}
