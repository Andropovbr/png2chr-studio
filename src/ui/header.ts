import { getLocale, setLocale, t, type Locale } from '../i18n';

export function createHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'app-header';

  const branding = document.createElement('div');
  const heading = document.createElement('h1');
  heading.textContent = t('appTitle');
  const description = document.createElement('p');
  description.textContent = t('appDescription');
  branding.append(heading, description);

  const languageGroup = document.createElement('div');
  languageGroup.className = 'language-control';
  const label = document.createElement('label');
  label.htmlFor = 'language-select';
  label.textContent = t('languageLabel');
  const select = document.createElement('select');
  select.id = 'language-select';

  const localeOptions: readonly [Locale, string][] = [
    ['pt-BR', t('localePtBr')],
    ['en', t('localeEn')],
  ];
  localeOptions.forEach(([locale, text]) => {
    const option = document.createElement('option');
    option.value = locale;
    option.textContent = text;
    select.append(option);
  });
  select.value = getLocale();
  select.addEventListener('change', () => {
    setLocale(select.value === 'pt-BR' ? 'pt-BR' : 'en');
  });

  languageGroup.append(label, select);
  header.append(branding, languageGroup);
  return header;
}
