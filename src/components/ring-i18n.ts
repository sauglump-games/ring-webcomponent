/**
 * ring-i18n — internationalization service element for the Nürburgring
 * components. Ships with English and German bundles (section names and UI
 * labels), detects the browser language on connect (overridable via the
 * `lang` attribute), and translates dot-separated keys with `{param}`
 * substitution.
 *
 * On every language change it re-translates all elements carrying a
 * `data-i18n="<key>"` attribute in the document, notifies registered
 * observers, and reflects the language in the `lang` attribute.
 *
 * It renders nothing — place it once per page:
 * ```html
 * <ring-i18n lang="de"></ring-i18n>
 * <h1 data-i18n="ui.trackMap"></h1>
 * ```
 *
 * @fires language-changed - The current language changed
 */

import { BUILT_IN_TRANSLATIONS, type TranslationBundle } from '../lib/translations.js';
import { defineOnce, emit } from './util.js';

/** Callback invoked with the new language code after a change. */
export type LanguageObserver = (language: string) => void;

const PLACEHOLDER = /\{(\w+)\}/g;
const FALLBACK_LANGUAGE = 'en';

export class RingI18n extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['lang'];
    }

    private readonly translations = new Map<string, TranslationBundle>(Object.entries(BUILT_IN_TRANSLATIONS));
    private readonly observers = new Set<LanguageObserver>();
    private currentLanguage = FALLBACK_LANGUAGE;

    connectedCallback(): void {
        // Hidden service element — it never renders anything.
        this.style.display = 'none';

        const initial =
            this.getAttribute('lang') ??
            (typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : FALLBACK_LANGUAGE);
        this.setLanguage(this.translations.has(initial) ? initial : FALLBACK_LANGUAGE);
        this.applyTranslations();
    }

    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue || newValue === null) return;
        this.setLanguage(newValue);
    }

    /** The current language code. */
    getCurrentLanguage(): string {
        return this.currentLanguage;
    }

    /** Language codes with a registered bundle. */
    getLanguages(): string[] {
        return Array.from(this.translations.keys());
    }

    /**
     * Switch the current language. Unknown languages are ignored. Reflects
     * the `lang` attribute, re-translates `[data-i18n]` elements, notifies
     * observers, and emits `language-changed`.
     */
    setLanguage(language: string): void {
        if (language === this.currentLanguage || !this.translations.has(language)) {
            // Keep the attribute honest when an unknown language was set on it.
            if (this.getAttribute('lang') !== this.currentLanguage) {
                this.setAttribute('lang', this.currentLanguage);
            }
            return;
        }

        this.currentLanguage = language;
        if (this.getAttribute('lang') !== language) {
            this.setAttribute('lang', language);
        }

        this.applyTranslations();
        for (const observer of this.observers) {
            observer(language);
        }
        emit(this, 'language-changed', { language });
    }

    /**
     * Translate a dot-separated key (e.g. `'sections.Fuchsröhre'` or
     * `'ui.totalDistance'`) with `{param}` substitution. Falls back to
     * English, then to the key itself. (Named `t` because `translate` is an
     * inherited HTMLElement boolean property.)
     */
    t(key: string, params: Record<string, string | number> = {}): string {
        const value = this.lookup(key, this.currentLanguage) ?? this.lookup(key, FALLBACK_LANGUAGE);
        if (value === null) return key;
        return value.replace(PLACEHOLDER, (match, param: string) =>
            params[param] !== undefined ? String(params[param]) : match
        );
    }

    /** Alias for {@link t}. */
    translateKey(key: string, params: Record<string, string | number> = {}): string {
        return this.t(key, params);
    }

    /**
     * Register (or extend) the bundle for a language. Existing keys for the
     * language are kept unless overridden.
     */
    addTranslations(language: string, bundle: Partial<TranslationBundle>): void {
        const existing = this.translations.get(language) ?? { sections: {}, ui: {} };
        this.translations.set(language, {
            sections: { ...existing.sections, ...bundle.sections },
            ui: { ...existing.ui, ...bundle.ui },
        });
    }

    /** Register an observer called with the language code on every change. */
    registerObserver(callback: LanguageObserver): void {
        this.observers.add(callback);
    }

    /** Remove a previously registered observer. */
    unregisterObserver(callback: LanguageObserver): void {
        this.observers.delete(callback);
    }

    /**
     * Translate every element with a `data-i18n="<key>"` attribute under
     * `root` (the whole document by default) by setting its text content.
     */
    applyTranslations(root: ParentNode = this.ownerDocument): void {
        for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
            const key = el.getAttribute('data-i18n');
            if (key) el.textContent = this.t(key);
        }
    }

    private lookup(key: string, language: string): string | null {
        const bundle = this.translations.get(language);
        if (!bundle) return null;

        let value: unknown = bundle;
        for (const part of key.split('.')) {
            if (value !== null && typeof value === 'object' && part in (value as Record<string, unknown>)) {
                value = (value as Record<string, unknown>)[part];
            } else {
                return null;
            }
        }
        return typeof value === 'string' ? value : null;
    }
}

defineOnce('ring-i18n', RingI18n);
