const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Short, URL-safe, collision-resistant enough for a single document
 * (36^10 ≈ 3.6e15). Ids appear in generated CSS selectors, so they must start
 * with a letter and contain nothing that needs escaping.
 */
export function uid(prefix = ''): string {
  const size = 10;
  let out = '';

  // The bare global rather than `globalThis.crypto`: a Worker declares
  // `crypto` as a global but not as a property of `globalThis`, and this
  // module is bundled into the Worker as well as the browser. The `typeof`
  // guard keeps the fallback reachable where there is no Web Crypto at all.
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(size);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < size; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  } else {
    for (let i = 0; i < size; i++) {
      out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }

  // Guarantee a leading letter so the id is always a valid CSS ident.
  const first = out[0]!;
  if (first >= '0' && first <= '9') out = 'n' + out.slice(1);
  return prefix ? `${prefix}${out}` : out;
}

/** Turn a display name into a URL slug. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
