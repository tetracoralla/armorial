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
  paste: ["clipboard", "粘贴", "黏贴", "paste"],
  collapse: ["click-to-fold", "collapse", "fold", "折叠", "收起"],
  visibility: ["preview-open", "visibility", "visible", "可见", "可见性"],
  hide: ["preview-close", "hide", "hidden", "隐藏", "不可见"],
  设置: ["setting", "config", "gear", "配置", "齿轮"],
  配置: ["config", "setting", "设置", "齿轮"],
  搜索: ["search", "find", "magnifier", "查找", "放大镜"],
  用户: ["user", "people", "account", "账户"],
  通知: ["remind", "bell", "notification", "提醒"],
  删除: ["delete", "trash", "remove", "垃圾桶"],
  添加: ["add", "plus", "新增"],
  编辑: ["edit", "write", "pencil", "铅笔"],
  粘贴: ["clipboard", "paste", "黏贴"],
  折叠: ["click-to-fold", "collapse", "收起"],
  收起: ["click-to-fold", "折叠", "collapse"],
  可见: ["preview-open", "visibility", "可见性"],
  不可见: ["preview-close", "hide", "隐藏"],
  隐藏: ["preview-close", "hide", "不可见"],
};

type AliasGroup = {
  index: number;
  trigger: string;
  triggerCompact: string;
  targetSlug: string;
  target: string;
  members: readonly string[];
  hanMemberCompacts: readonly string[];
};

export type AliasExpansion = {
  targets: readonly string[];
  aliases: readonly string[];
  independentDirectTargetCount: number;
};

type DirectAliasMatch = {
  group: AliasGroup;
  start: number;
  end: number;
  isTrigger: boolean;
};

const ALIAS_GROUPS: readonly AliasGroup[] = Object.entries(RAW_ALIASES).map(([key, values], index) => {
  const members = [...new Set([key, ...values].map(normalizeText).filter(Boolean))];
  return {
    index,
    trigger: normalizeText(key),
    triggerCompact: compactText(key),
    targetSlug: values[0] ?? key,
    target: normalizeText(values[0] ?? key),
    members,
    hanMemberCompacts: [...new Set(members
      .filter((member) => /\p{Script=Han}/u.test(member))
      .map((member) => compactText(member))
      .filter((compact) => compact.length >= 2))],
  };
});

export function aliasTargetSlugs(): readonly string[] {
  return [...new Set(ALIAS_GROUPS.map((group) => group.targetSlug))];
}

const GROUPS_BY_MEMBER = new Map<string, { compact: string; groups: readonly AliasGroup[] }>();
for (const group of ALIAS_GROUPS) {
  for (const member of group.members) {
    const existing = GROUPS_BY_MEMBER.get(member);
    if (existing === undefined) {
      GROUPS_BY_MEMBER.set(member, { compact: compactText(member), groups: [group] });
    } else {
      existing.groups = [...existing.groups, group];
    }
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

function containsChineseMember(queryCompact: string, member: string, memberCompact: string): boolean {
  return /\p{Script=Han}/u.test(member)
    && memberCompact.length >= 2
    && queryCompact.includes(memberCompact);
}

export function isGenericTaskTerm(value: string): boolean {
  return GENERIC_TASK_TERMS.has(normalizeText(value));
}

function directAliasMatches(
  queryCompact: string,
  normalizedTerms: ReadonlySet<string>,
): DirectAliasMatch[] {
  const matches: DirectAliasMatch[] = [];
  const recordedSpans = new Set<string>();
  const recordSpans = (group: AliasGroup, needle: string, isTrigger: boolean): void => {
    let start = queryCompact.indexOf(needle);
    while (start >= 0) {
      const spanKey = `${group.index}:${start}:${needle.length}`;
      if (!recordedSpans.has(spanKey)) {
        recordedSpans.add(spanKey);
        matches.push({ group, start, end: start + needle.length, isTrigger });
      }
      start = queryCompact.indexOf(needle, start + 1);
    }
  };
  for (const group of ALIAS_GROUPS) {
    // A semantic is directly named when the query carries the group trigger as
    // a whole term (English or Chinese key) or directly contains its Chinese
    // trigger. Trigger-named semantics steer target ordering and ranking.
    if (normalizedTerms.has(group.trigger)) recordSpans(group, group.triggerCompact, true);
    // Chinese semantics often enter as members of English-triggered groups
    // (e.g. 上传/下载/取消); containing such a member still counts as directly
    // naming that semantic, so the compound-intent guard stays equally
    // effective in Chinese instead of silently deciding multi-semantic intents.
    for (const memberCompact of group.hanMemberCompacts) {
      recordSpans(group, memberCompact, memberCompact === group.triggerCompact);
    }
  }
  return matches;
}

function independentDirectAliasMatches(matches: readonly DirectAliasMatch[]): DirectAliasMatch[] {
  return matches.filter((match) => !matches.some((other) =>
    other !== match
    && other.start <= match.start
    && other.end >= match.end
    && other.end - other.start > match.end - match.start
  ));
}

export function expandAliases(query: string, terms: readonly string[]): AliasExpansion {
  // The query compact and normalized term set are computed once; alias groups
  // and members are static and precompact at module initialization.
  const queryCompact = compactText(query);
  const normalizedTerms = new Set(terms.map(normalizeText));
  const directMatches = independentDirectAliasMatches(directAliasMatches(queryCompact, normalizedTerms));

  // One word can fan out across several groups (e.g. 删除 names the 删除 group
  // but is also a member of remove/delete), so each independent query span
  // contributes exactly one representative target: the trigger-named group
  // when the span names a trigger, otherwise the first member group in table
  // order. Alias fan-out inside one word stays a single semantic; two spans
  // with distinct targets are a compound intent.
  const spanRepresentatives = new Map<string, DirectAliasMatch>();
  for (const match of directMatches) {
    const key = `${match.start}:${match.end}`;
    const current = spanRepresentatives.get(key);
    if (current === undefined
      || (match.isTrigger && !current.isTrigger)
      || (match.isTrigger === current.isTrigger && match.group.index < current.group.index)) {
      spanRepresentatives.set(key, match);
    }
  }
  const representativeGroups: AliasGroup[] = [];
  const representativeTargets = new Set<string>();
  for (const representative of [...spanRepresentatives.values()].sort((left, right) => left.start - right.start)) {
    if (representativeTargets.has(representative.group.target)) continue;
    representativeTargets.add(representative.group.target);
    representativeGroups.push(representative.group);
  }

  const matchedGroups = new Set<AliasGroup>();
  for (const term of normalizedTerms) {
    for (const group of GROUPS_BY_MEMBER.get(term)?.groups ?? []) {
      matchedGroups.add(group);
    }
  }
  for (const [member, entry] of GROUPS_BY_MEMBER) {
    if (!containsChineseMember(queryCompact, member, entry.compact)) continue;
    for (const group of entry.groups) matchedGroups.add(group);
  }

  // Direct representatives must also steer ranking. Merely flagging a compound
  // intent while omitting one of its meanings from the returned candidates
  // leaves the Agent unable to make the required choice.
  const selectedGroups = representativeGroups.length > 0
    ? representativeGroups
    : [...matchedGroups];
  const targets = new Set<string>();
  const aliases = new Set<string>();
  for (const group of selectedGroups) {
    targets.add(group.target);
    for (const alias of group.members) {
      if (alias !== group.target) aliases.add(alias);
    }
  }
  return {
    targets: [...targets],
    aliases: [...aliases],
    independentDirectTargetCount: representativeTargets.size,
  };
}
