export function normalizeText(value: string): string {
  // Pure-ASCII input skips NFKC, Unicode property classes, and locale-aware
  // lowercasing, which dominate search-index construction cost. The ASCII
  // result is byte-identical to normalizeUnicode by construction and is held
  // to that by a differential test over the full icon corpus.
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return normalizeUnicode(value);
  }
  return normalizeAscii(value);
}

function normalizeUnicode(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeAscii(value: string): string {
  let result = "";
  let pendingSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 97 && code <= 122 || code >= 48 && code <= 57) {
      if (pendingSpace) {
        result += " ";
        pendingSpace = false;
      }
      result += value[index];
    } else if (code >= 65 && code <= 90) {
      const previous = index > 0 ? value.charCodeAt(index - 1) : 0;
      const splitsCamelCase = (previous >= 97 && previous <= 122) || (previous >= 48 && previous <= 57);
      if (splitsCamelCase) result += " ";
      else if (pendingSpace) {
        result += " ";
      }
      pendingSpace = false;
      result += String.fromCharCode(code + 32);
    } else {
      pendingSpace = result.length > 0;
    }
  }
  return result;
}

export function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function singularCandidates(token: string): readonly string[] {
  if (token.length > 4 && token.endsWith("ies")) {
    return [`${token.slice(0, -3)}y`, token.slice(0, -1)];
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return [token.slice(0, -1)];
  }
  return [];
}

export function queryTerms(value: string): string[] {
  const normalized = normalizeText(value);
  const terms = new Set<string>();
  if (normalized) {
    terms.add(normalized);
    terms.add(normalized.replace(/\s+/g, ""));
  }

  for (const token of normalized.split(" ")) {
    if (!token) continue;
    terms.add(token);
    if (/^[a-z]+$/.test(token)) {
      for (const singular of singularCandidates(token)) terms.add(singular);
    }
  }

  return [...terms].filter(Boolean);
}
