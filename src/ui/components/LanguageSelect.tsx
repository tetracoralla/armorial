import { useMessages } from "../messages.js";
import type { LocalePreference } from "../i18n.js";

export function LanguageSelect() {
  const { preference, setPreference, t } = useMessages();
  return (
    <div className="language-row">
      <label htmlFor="armorial-language">
        <span>{t("language")}</span>
      </label>
      <select
        id="armorial-language"
        value={preference}
        onChange={(event) => setPreference(event.target.value as LocalePreference)}
      >
        <option value="system">{t("languageSystem")}</option>
        <option value="en">English</option>
        <option value="zh-CN">简体中文</option>
      </select>
    </div>
  );
}
