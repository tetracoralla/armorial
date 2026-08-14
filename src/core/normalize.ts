export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function singularizeEnglishToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
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
      terms.add(singularizeEnglishToken(token));
    }
  }

  return [...terms].filter(Boolean);
}
