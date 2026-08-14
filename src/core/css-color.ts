export const CSS_NAMED_COLOR_VALUES = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow",
  "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue",
  "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple",
  "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell",
  "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white",
  "whitesmoke", "yellow", "yellowgreen",
] as const;

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const CSS_VARIABLE_PATTERN = /^var\(--[a-zA-Z0-9_-]+\)$/;

const CSS_NAMED_COLORS = new Set<string>(CSS_NAMED_COLOR_VALUES);
const COLOR_KEYWORD_VALUES = ["currentColor", "none", "transparent", ...CSS_NAMED_COLOR_VALUES] as const;

function asciiCaseInsensitivePattern(value: string): string {
  return [...value].map((character) => {
    const lower = character.toLocaleLowerCase("en-US");
    const upper = character.toLocaleUpperCase("en-US");
    return lower === upper ? character : `[${lower}${upper}]`;
  }).join("");
}

export const CSS_COLOR_KEYWORD_PATTERN = new RegExp(
  `^(?:${COLOR_KEYWORD_VALUES.map(asciiCaseInsensitivePattern).join("|")})$`,
);

export function canonicalizeSvgColor(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (HEX_COLOR_PATTERN.test(value)) return value.toLocaleLowerCase("en-US");
  if (CSS_VARIABLE_PATTERN.test(value)) return value;

  const lower = value.toLocaleLowerCase("en-US");
  if (lower === "currentcolor") return "currentColor";
  if (lower === "none" || lower === "transparent" || CSS_NAMED_COLORS.has(lower)) return lower;
  return value;
}
