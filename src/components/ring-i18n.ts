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

        const requested =
            this.getAttribute('lang') ?? (typeof navigator !== 'undefined' ? navigator.language : FALLBACK_LANGUAGE);
        this.setLanguage(this.resolve(requested) ?? FALLBACK_LANGUAGE);
        this.applyTranslations();
    }

    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue) return;
        // Removing `lang` would otherwise leave currentLanguage with no reflected
        // attribute, breaking the "reflected" contract — snap it back (#27).
        if (newValue === null) {
            this.reflect();
            return;
        }
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
     * Switch the current language. Accepts BCP-47 / cased tags
     * (`'de-DE'`, `'DE'` → `de`); unresolvable languages are ignored. Reflects
     * the canonical code in the `lang` attribute, re-translates `[data-i18n]`
     * elements, notifies observers, and emits `language-changed`.
     */
    setLanguage(language: string): void {
        const resolved = this.resolve(language);
        if (resolved === null || resolved === this.currentLanguage) {
            // Unknown, or already current: just keep the attribute canonical.
            this.reflect();
            return;
        }

        this.currentLanguage = resolved;
        this.reflect();
        this.applyTranslations();
        this.notify(resolved);
        emit(this, 'language-changed', { language: resolved });
    }

    /**
     * Resolve a requested language tag to a registered bundle key: exact
     * (case-insensitive) match first, then the base subtag (`de-DE` → `de`).
     * Returns null when nothing matches.
     */
    private resolve(language: string): string | null {
        const lower = language.trim().toLowerCase();
        if (this.translations.has(lower)) return lower;
        const base = lower.split('-')[0];
        if (this.translations.has(base)) return base;
        return null;
    }

    /** Ensure the `lang` attribute mirrors the canonical current language. */
    private reflect(): void {
        if (this.getAttribute('lang') !== this.currentLanguage) {
            this.setAttribute('lang', this.currentLanguage);
        }
    }

    /** Notify observers, isolating a throwing one so it can't abort the rest (#25). */
    private notify(language: string): void {
        for (const observer of this.observers) {
            try {
                observer(language);
            } catch {
                /* a faulty observer must not break language switching */
            }
        }
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
        // Store under a normalized (lowercase) key so resolve() can match it.
        const key = language.trim().toLowerCase();
        const existing = this.translations.get(key) ?? { sections: {}, ui: {} };
        this.translations.set(key, {
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
            if (!key) continue;
            // Only overwrite when the key actually resolves, so an unknown key
            // doesn't destroy an element's authored fallback text (#28).
            const value = this.lookup(key, this.currentLanguage) ?? this.lookup(key, FALLBACK_LANGUAGE);
            if (value !== null) el.textContent = value;
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
