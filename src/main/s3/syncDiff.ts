export interface SyncObject {
  /** Object key with the endpoint prefix stripped (the part compared across the two sides). */
  relKey: string;
  size: number;
}

export interface SyncOp {
  relKey: string;
  size: number;
  reason: 'missing' | 'size';
}

/** Additive one-way diff: returns source objects absent on the destination or differing in size. */
export function diffListings(source: SyncObject[], dest: SyncObject[]): SyncOp[] {
  const destSize = new Map<string, number>();
  for (const d of dest) destSize.set(d.relKey, d.size);

  const ops: SyncOp[] = [];
  for (const s of source) {
    if (!destSize.has(s.relKey)) {
      ops.push({ relKey: s.relKey, size: s.size, reason: 'missing' });
    } else if (destSize.get(s.relKey) !== s.size) {
      ops.push({ relKey: s.relKey, size: s.size, reason: 'size' });
    }
  }
  return ops;
}
