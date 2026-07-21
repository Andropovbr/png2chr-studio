import { translations, type TranslationKey } from './translations';
import type { Locale, TranslationVariables } from './types';

export function detectLocale(language: string): Locale {
  return language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

let activeLocale: Locale = detectLocale(
  typeof navigator === 'undefined' ? 'en' : navigator.language,
);

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return activeLocale;
}

export function setLocale(locale: Locale): void {
  if (locale === activeLocale) {
    return;
  }

  activeLocale = locale;
  listeners.forEach((listener) => {
    listener();
  });
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(
  key: TranslationKey,
  variables: TranslationVariables = {},
): string {
  const template: string = translations[activeLocale][key];
  return template.replace(/\{(\w+)\}/g, (placeholder, variable: string) => {
    const value = variables[variable];
    return value === undefined ? placeholder : String(value);
  });
}

export type { TranslationKey } from './translations';
export type { Locale, TranslationVariables } from './types';
