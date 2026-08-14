import { compactText, normalizeText } from "./normalize.js";

const RAW_ALIASES: Readonly<Record<string, readonly string[]>> = {
  settings: ["setting", "config", "gear", "配置", "设置"],
  preferences: ["setting", "preference", "config", "设置", "偏好"],
  configure: ["config", "setting", "配置", "设置"],
  gear: ["setting", "config", "齿轮"],
  search: ["search", "find", "magnifier", "搜索", "查找", "放大镜"],
  find: ["search", "搜索", "查找"],
  close: ["close", "delete", "关闭", "取消"],
  remove: ["minus", "delete", "移除", "删除"],
  delete: ["delete", "trash", "删除", "垃圾桶"],
  add: ["add", "plus", "新增", "添加"],
  edit: ["edit", "write", "pencil", "编辑", "铅笔"],
  account: ["user", "people", "用户", "账户"],
  profile: ["user", "people", "用户", "个人"],
  notification: ["remind", "bell", "通知", "提醒"],
  filter: ["filter", "筛选", "过滤"],
  overflow: ["more", "ellipsis", "更多", "省略号"],
  menu: ["hamburger", "menu", "菜单"],
  upload: ["upload", "上传"],
  download: ["download", "下载"],
  home: ["home", "house", "首页", "主页"],
  calendar: ["calendar", "date", "日历", "日期"],
  help: ["help", "question", "帮助", "问题"],
  warning: ["attention", "caution", "warning", "警告", "注意"],
  success: ["check", "success", "done", "成功", "完成"],
  设置: ["setting", "config", "gear", "配置", "齿轮"],
  配置: ["config", "setting", "设置", "齿轮"],
  搜索: ["search", "find", "magnifier", "查找", "放大镜"],
  用户: ["user", "people", "account", "账户"],
  通知: ["remind", "bell", "notification", "提醒"],
  删除: ["delete", "trash", "remove", "垃圾桶"],
  添加: ["add", "plus", "新增"],
  编辑: ["edit", "write", "pencil", "铅笔"],
};

type AliasGroup = {
  trigger: string;
  targetSlug: string;
  target: string;
  members: readonly string[];
};

export type AliasExpansion = {
  targets: readonly string[];
  aliases: readonly string[];
};

const ALIAS_GROUPS: readonly AliasGroup[] = Object.entries(RAW_ALIASES).map(([key, values]) => ({
  trigger: normalizeText(key),
  targetSlug: values[0] ?? key,
  target: normalizeText(values[0] ?? key),
  members: [...new Set([key, ...values].map(normalizeText).filter(Boolean))],
}));

export function aliasTargetSlugs(): readonly string[] {
  return [...new Set(ALIAS_GROUPS.map((group) => group.targetSlug))];
}

const GROUPS_BY_MEMBER = new Map<string, readonly AliasGroup[]>();
for (const group of ALIAS_GROUPS) {
  for (const member of group.members) {
    const existing = GROUPS_BY_MEMBER.get(member) ?? [];
    GROUPS_BY_MEMBER.set(member, [...existing, group]);
  }
}

const GENERIC_TASK_TERMS = new Set([
  "icon",
  "icons",
  "svg",
  "glyph",
  "symbol",
  "图标",
  "图形",
  "符号",
]);

function containsChineseMember(query: string, member: string): boolean {
  return /\p{Script=Han}/u.test(member)
    && compactText(member).length >= 2
    && compactText(query).includes(compactText(member));
}

export function isGenericTaskTerm(value: string): boolean {
  return GENERIC_TASK_TERMS.has(normalizeText(value));
}

export function expandAliases(query: string, terms: readonly string[]): AliasExpansion {
  const directGroups = new Set<AliasGroup>();
  for (const group of ALIAS_GROUPS) {
    if (terms.some((term) => normalizeText(term) === group.trigger)
      || containsChineseMember(query, group.trigger)) {
      directGroups.add(group);
    }
  }

  const matchedGroups = new Set<AliasGroup>();
  for (const term of terms) {
    for (const group of GROUPS_BY_MEMBER.get(normalizeText(term)) ?? []) {
      matchedGroups.add(group);
    }
  }
  for (const [member, groups] of GROUPS_BY_MEMBER) {
    if (!containsChineseMember(query, member)) continue;
    for (const group of groups) matchedGroups.add(group);
  }

  const selectedGroups = [...(directGroups.size > 0 ? directGroups : matchedGroups)];
  if (directGroups.size > 1) {
    const compactQuery = compactText(query);
    selectedGroups.sort((left, right) => {
      const leftIndex = compactQuery.indexOf(compactText(left.trigger));
      const rightIndex = compactQuery.indexOf(compactText(right.trigger));
      return leftIndex - rightIndex;
    });
  }
  const targets = new Set<string>();
  const aliases = new Set<string>();
  for (const group of selectedGroups) {
    targets.add(group.target);
    for (const alias of group.members) {
      if (alias !== group.target) aliases.add(alias);
    }
  }
  return { targets: [...targets], aliases: [...aliases] };
}
