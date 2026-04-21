import type { Simplify } from 'type-fest'

// Pulumi's Output/Promise wrappers nest deeply; this collapses them to their
// resolved shape for use in type positions (e.g. resource config objects).
// biome-ignore format: keep the conditional chain readable
type Cleaned<T> =
  T extends $util.OutputInstance<infer U>
    ? U
    : T extends Promise<infer U>
      ? U
      : T extends Array<infer U>
        ? Cleaned<U>[]
        : T

export const unpackPulumiTypes = <T>(u: T) => u as Simplify<Cleaned<T>>
export const $ = unpackPulumiTypes
