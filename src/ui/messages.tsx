import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LOCALE_STORAGE_KEY,
  parseStoredLocalePreference,
  resolveLocale,
  translate,
  type LocalePreference,
  type MessageKey,
  type MessageValues,
  type SupportedLocale,
} from "./i18n.js";

export type Translator = (key: MessageKey, values?: MessageValues) => string;

export type MessagesApi = {
  locale: SupportedLocale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  t: Translator;
};

// Default context so components rendered without a provider (static-markup
// tests) still show the English surface deterministically.
const defaultApi: MessagesApi = {
  locale: "en",
  preference: "system",
  setPreference: () => undefined,
  t: (key, values) => translate("en", key, values),
};

const MessagesContext = createContext<MessagesApi>(defaultApi);

export type PreferenceStorage = {
  read(): LocalePreference;
  write(preference: LocalePreference): void;
};

export function localStoragePreferenceStorage(): PreferenceStorage {
  return {
    read() {
      try {
        const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        return parseStoredLocalePreference(raw === null ? undefined : JSON.parse(raw));
      } catch {
        // Sandboxed iframes (for example an Agent-hosted MCP App) may block
        // localStorage entirely; the session then runs on the system locale.
        return "system";
      }
    },
    write(preference) {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify({ version: 1, locale: preference }));
      } catch {
        // Same sandbox story as read(): keep the session usable in memory.
      }
    },
  };
}

type ProviderProps = {
  storage: PreferenceStorage;
  // A host-provided preference (Figma's persisted locale) hydrates the UI once
  // it arrives, unless the user has already chosen a language this session.
  externalPreference?: LocalePreference | null;
  children: ReactNode;
};

export function MessagesProvider({ storage, externalPreference = null, children }: ProviderProps) {
  const [preference, setPreferenceState] = useState<LocalePreference>(() => storage.read());
  const userChose = useRef(false);
  const hydratedExternally = useRef(false);

  // Render-phase hydration (React's documented adjust-state-during-render
  // pattern): adopt the host preference exactly once, and never after the
  // user has made a session choice.
  if (externalPreference !== null && !hydratedExternally.current) {
    hydratedExternally.current = true;
    if (!userChose.current && externalPreference !== preference) {
      setPreferenceState(externalPreference);
    }
  }

  const setPreference = useCallback((next: LocalePreference) => {
    userChose.current = true;
    setPreferenceState(next);
    storage.write(next);
  }, [storage]);

  const api = useMemo<MessagesApi>(() => ({
    locale: resolveLocale(preference, navigator.languages),
    preference,
    setPreference,
    t: (key, values) => translate(resolveLocale(preference, navigator.languages), key, values),
  }), [preference, setPreference]);

  useEffect(() => {
    document.documentElement.lang = api.locale;
  }, [api.locale]);

  return <MessagesContext.Provider value={api}>{children}</MessagesContext.Provider>;
}

export function useMessages(): MessagesApi {
  return useContext(MessagesContext);
}
