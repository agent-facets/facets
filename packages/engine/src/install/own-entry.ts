/**
 * Own-property read of a name-keyed record.
 *
 * Facet names, and the asset names inside an override map, are ordinary
 * strings drawn from user-authored files. `constructor` and `__proto__` are
 * legal values, and a plain object inherits both — so an indexed read returns
 * `Object`'s constructor or `Object.prototype` where the type promises the
 * record's value type or `undefined`. Every downstream branch that treats
 * "absent" as a decision point then takes the wrong one, and the value it
 * carries forward is not even the right shape.
 *
 * Centralized rather than spelled `Object.hasOwn(...) ? record[k] : undefined`
 * at each site: the sites that need it are exactly the ones keyed by
 * user-controlled names, and one helper makes that set greppable.
 */
export function ownEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/**
 * A writable copy of a name-keyed record whose keys cannot collide with
 * `Object.prototype`.
 *
 * The write-side counterpart of {@link ownEntry}, and the same hazard from the
 * other end: `record[key] = value` for a key named `__proto__` invokes the
 * inherited setter, so no own key is created and the record's prototype is
 * replaced by the value instead. The entry then reads back as absent — the
 * override silently disappears, and every later read on that record is
 * answered by whatever object was installed as its prototype.
 *
 * `Object.assign` onto a null-prototype target defines data properties
 * directly, so both the copy and every subsequent assignment are safe.
 */
export function ownRecord<T>(source?: Readonly<Record<string, T>>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, source)
}
