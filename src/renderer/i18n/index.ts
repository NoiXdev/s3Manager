import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import pl from './locales/pl.json';
import nl from './locales/nl.json';
import ro from './locales/ro.json';

export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'pl', 'nl', 'ro'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
      pl: { translation: pl },
      nl: { translation: nl },
      ro: { translation: ro },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
