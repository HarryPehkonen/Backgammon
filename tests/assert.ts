/**
 * Minimal assertion helpers.
 *
 * The engine has zero dependencies and the build runs offline, so we cannot
 * import `jsr:@std/assert`. These few functions are all the tests need.
 */

/** Throws unless `condition` is truthy. */
export function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

/** Throws unless `condition` is falsy. */
export function assertFalse(condition: unknown, message = "expected a falsy value"): void {
  assert(!condition, message);
}

/** Structural equality for primitives, arrays, typed arrays and plain objects. */
export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${message ? message + "\n" : ""}expected: ${show(expected)}\nactual:   ${show(actual)}`,
    );
  }
}

/** Fails when the two values are structurally equal. */
export function assertNotEquals<T>(actual: T, expected: T, message?: string): void {
  if (deepEqual(actual, expected)) {
    throw new Error(
      `${message ? message + "\n" : ""}expected values to differ, both were ${show(actual)}`,
    );
  }
}

/** Numeric comparison with a tolerance, for evaluator scores. */
export function assertAlmostEquals(
  actual: number,
  expected: number,
  tolerance = 1e-9,
  message?: string,
): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(
      `${message ? message + "\n" : ""}expected ${actual} to be within ${tolerance} of ${expected}`,
    );
  }
}

/** Fails unless `fn` throws. */
export function assertThrows(fn: () => unknown, message = "expected function to throw"): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    const av = a as unknown as ArrayLike<number>;
    const bv = b as unknown as ArrayLike<number>;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
    return true;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    Object.hasOwn(b as object, key) &&
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

function show(value: unknown): string {
  if (ArrayBuffer.isView(value)) {
    return `[${Array.from(value as unknown as ArrayLike<number>).join(", ")}]`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
