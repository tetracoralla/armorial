// Bilingual UI messages, mirroring the tools-dev perspective-tool pattern:
// the English dictionary is the single source of truth for the key set, the
// Simplified Chinese dictionary is typed `Record<MessageKey, string>` so a
// missing or extra key fails `npm run typecheck`, and locale resolution is a
// pure function. No runtime dependency, no translation at runtime.

export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = "system" | SupportedLocale;

export const LOCALE_STORAGE_KEY = "armorial.preferences.v1";

const english = {
  // Toolbar
  searchIcons: "Search icons",
  iconsCount: "{count} icons",
  loading: "Loading…",
  dragMode: "Drag mode",
  settings: "Settings",
  fullScreen: "Full screen",
  // Categories
  iconCategories: "Icon categories",
  all: "All",
  // Grid
  iconResults: "Icon results",
  noMatchingIcons: "No matching icons",
  loadMore: "Load more",
  // Inspector (shared)
  selectToPreview: "Select an icon to preview it",
  selectAnIconFirst: "Select an icon first.",
  copySvg: "Copy SVG",
  copying: "Copying…",
  download: "Download",
  downloading: "Downloading…",
  copyForAgent: "Copy for Agent",
  agentHeading: "Agent",
  attachToConversation: "Attach to conversation",
  attaching: "Attaching…",
  selectAndContinue: "Select & continue",
  sending: "Sending…",
  humanExportActions: "Human export actions",
  agentActions: "Agent actions",
  svgCopied: "SVG copied",
  downloadStarted: "Download started",
  agentSelectionCopied: "Agent selection copied",
  selectionAttached: "Selection attached",
  selectionSent: "Selection sent",
  // Inspector (Figma)
  selectToInsert: "Select an icon to insert it",
  insertComponent: "Insert component",
  insertIcon: "Insert icon",
  inserting: "Inserting…",
  componentInserted: "Component inserted",
  iconInserted: "Icon inserted",
  dragHint: "Drag any icon to place it precisely on the canvas.",
  placedIn: "Placed {name} in {parent}",
  figmaOutput: "Figma output",
  figmaInsertActions: "Figma insert actions",
  layerStructure: "Layer structure",
  preserveLayers: "Preserve layers",
  flattenToVector: "Flatten to vector",
  booleanUnion: "Boolean union",
  layerName: "Layer name",
  iconNameOption: "Icon name",
  outlineStrokes: "Outline strokes",
  createComponent: "Create component",
  // Appearance
  appearance: "Appearance",
  rendering: "Rendering…",
  modified: "Modified",
  reset: "Reset",
  formSection: "Form",
  theme: "Theme",
  themeOutline: "Outline",
  themeFilled: "Filled",
  themeTwoTone: "Two-tone",
  themeMultiColor: "Multi-color",
  size: "Size",
  sizeValue: "Size value",
  stroke: "Stroke",
  strokeValue: "Stroke value",
  linecap: "Linecap",
  linejoin: "Linejoin",
  capButt: "Butt",
  capRound: "Round",
  capSquare: "Square",
  joinMiter: "Miter",
  joinRound: "Round",
  joinBevel: "Bevel",
  colorSection: "Color",
  primary: "Primary",
  secondary: "Secondary",
  innerStroke: "Inner stroke",
  innerFill: "Inner fill",
  policyContext: "Policy context",
  defaultContext: "Default",
  editColor: "Edit {slot} color",
  colorEditor: "{slot} color editor",
  hue: "{slot} hue",
  saturation: "{slot} saturation",
  lightness: "{slot} lightness",
  colorPresets: "Color presets",
  usePreset: "Use {preset}",
  close: "Close",
  hueLabel: "Hue",
  saturationLabel: "Saturation",
  lightnessLabel: "Lightness",
  // Language
  language: "Language",
  languageSystem: "Automatic",
  // Startup
  figmaStartupFailed: "The Figma plugin could not start.",
  pickerStartupFailed: "The icon picker could not start.",
} as const;

export type MessageKey = keyof typeof english;

// Runtime mirror of the dictionary key set for checks that run without the
// TypeScript compiler in between (the compiler already holds the zh-CN
// dictionary to `Record<MessageKey, string>`).
export const MESSAGE_KEYS = Object.keys(english) as readonly MessageKey[];

const simplifiedChinese: Record<MessageKey, string> = {
  // Toolbar
  searchIcons: "搜索图标",
  iconsCount: "{count} 个图标",
  loading: "加载中…",
  dragMode: "拖拽模式",
  settings: "设置",
  fullScreen: "全屏",
  // Categories
  iconCategories: "图标分类",
  all: "全部",
  // Grid
  iconResults: "图标结果",
  noMatchingIcons: "没有匹配的图标",
  loadMore: "加载更多",
  // Inspector (shared)
  selectToPreview: "选择一个图标进行预览",
  selectAnIconFirst: "请先选择一个图标。",
  copySvg: "复制 SVG",
  copying: "复制中…",
  download: "下载",
  downloading: "下载中…",
  copyForAgent: "复制给 Agent",
  agentHeading: "Agent",
  attachToConversation: "附加到对话",
  attaching: "附加中…",
  selectAndContinue: "选择并继续",
  sending: "发送中…",
  humanExportActions: "人工导出操作",
  agentActions: "Agent 操作",
  svgCopied: "已复制 SVG",
  downloadStarted: "已开始下载",
  agentSelectionCopied: "已复制 Agent 选择",
  selectionAttached: "已附加选择",
  selectionSent: "已发送选择",
  // Inspector (Figma)
  selectToInsert: "选择一个图标进行插入",
  insertComponent: "插入组件",
  insertIcon: "插入图标",
  inserting: "插入中…",
  componentInserted: "已插入组件",
  iconInserted: "已插入图标",
  dragHint: "拖拽任意图标，精确放置到画布上。",
  placedIn: "已将 {name} 放入 {parent}",
  figmaOutput: "Figma 输出",
  figmaInsertActions: "Figma 插入操作",
  layerStructure: "图层结构",
  preserveLayers: "保留图层",
  flattenToVector: "拼合为矢量",
  booleanUnion: "布尔合并",
  layerName: "图层命名",
  iconNameOption: "图标名",
  outlineStrokes: "描边轮廓化",
  createComponent: "创建组件",
  // Appearance
  appearance: "外观",
  rendering: "渲染中…",
  modified: "已修改",
  reset: "重置",
  formSection: "形态",
  theme: "主题",
  themeOutline: "线性",
  themeFilled: "填充",
  themeTwoTone: "双色",
  themeMultiColor: "多彩",
  size: "大小",
  sizeValue: "大小数值",
  stroke: "描边",
  strokeValue: "描边数值",
  linecap: "端点类型",
  linejoin: "拐点类型",
  capButt: "平头",
  capRound: "圆头",
  capSquare: "方头",
  joinMiter: "斜接",
  joinRound: "圆角",
  joinBevel: "斜切",
  colorSection: "颜色",
  primary: "主色",
  secondary: "辅色",
  innerStroke: "内描边",
  innerFill: "内填充",
  policyContext: "策略上下文",
  defaultContext: "默认",
  editColor: "编辑{slot}颜色",
  colorEditor: "{slot}颜色编辑器",
  hue: "{slot}色相",
  saturation: "{slot}饱和度",
  lightness: "{slot}亮度",
  colorPresets: "颜色预设",
  usePreset: "使用 {preset}",
  close: "关闭",
  hueLabel: "色相",
  saturationLabel: "饱和度",
  lightnessLabel: "亮度",
  // Language
  language: "语言",
  languageSystem: "跟随系统",
  // Startup
  figmaStartupFailed: "Figma 插件无法启动。",
  pickerStartupFailed: "图标选择器无法启动。",
};

const dictionaries: Record<SupportedLocale, Record<MessageKey, string>> = {
  en: english,
  "zh-CN": simplifiedChinese,
};

export type MessageValues = Readonly<Record<string, string | number>>;

export function translate(
  locale: SupportedLocale,
  key: MessageKey,
  values?: MessageValues,
): string {
  const template = dictionaries[locale][key];
  if (values === undefined) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, name: string) => {
    const replacement = values[name];
    return replacement === undefined ? placeholder : String(replacement);
  });
}

export function resolveLocale(
  preference: LocalePreference,
  systemLocales: readonly string[],
): SupportedLocale {
  if (preference !== "system") return preference;
  for (const candidate of systemLocales) {
    const normalized = candidate.trim().toLowerCase().replaceAll("_", "-");
    if (
      normalized === "zh" ||
      normalized === "zh-cn" ||
      normalized === "zh-sg" ||
      normalized.startsWith("zh-hans")
    ) {
      return "zh-CN";
    }
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
  }
  return "en";
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function parseStoredLocalePreference(value: unknown): LocalePreference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "system";
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1) return "system";
  return isLocalePreference(record["locale"]) ? record["locale"] : "system";
}
