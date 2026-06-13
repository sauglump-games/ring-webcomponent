import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setupDom, type DomEnv } from './dom.js';
import type { RingI18n } from '../src/components/ring-i18n.js';

// Import only after DOM globals are installed (customElements.define / extends HTMLElement).
let env: DomEnv;
let document: Document;
before(async () => {
    env = setupDom();
    document = env.document;
    await import('../src/components/ring-i18n.js');
});
after(() => env.cleanup());
beforeEach(() => {
    document.body.innerHTML = '';
});

function make(attrs: Record<string, string> = {}): RingI18n {
    const el = document.createElement('ring-i18n') as RingI18n;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
}

describe('ring-i18n', () => {
    it('is registered as a custom element and renders nothing', () => {
        assert.ok(env.window.customElements.get('ring-i18n'));
        const el = make();
        assert.strictEqual(el.shadowRoot, null);
        assert.strictEqual(el.style.display, 'none');
    });

    it('defaults to English (jsdom navigator is en-US) and reflects lang', () => {
        const el = make();
        assert.strictEqual(el.getCurrentLanguage(), 'en');
        assert.strictEqual(el.getAttribute('lang'), 'en');
    });

    it('honors an initial lang attribute', () => {
        const el = make({ lang: 'de' });
        assert.strictEqual(el.getCurrentLanguage(), 'de');
        assert.strictEqual(el.t('ui.elevation'), 'Höhe');
    });

    it('lists the built-in languages', () => {
        assert.deepStrictEqual(make().getLanguages(), ['en', 'de']);
    });

    it('translates nested keys per language', () => {
        const el = make();
        assert.strictEqual(el.t('sections.Fuchsröhre'), 'Fox Tube');
        assert.strictEqual(el.t('ui.distance'), 'Distance');
        el.setLanguage('de');
        assert.strictEqual(el.t('sections.Fuchsröhre'), 'Fuchsröhre');
        assert.strictEqual(el.t('ui.distance'), 'Entfernung');
    });

    it('returns the key for unknown keys and non-leaf lookups', () => {
        const el = make();
        assert.strictEqual(el.t('ui.doesNotExist'), 'ui.doesNotExist');
        assert.strictEqual(el.t('sections'), 'sections');
    });

    it('substitutes {param} placeholders and leaves unknown ones intact', () => {
        const el = make();
        assert.strictEqual(el.t('ui.totalDistance', { distance: '20.8 km' }), 'Total Distance: 20.8 km');
        assert.strictEqual(el.t('ui.elevationRange', { min: 320 }), 'Elevation Range: 320 - {max}');
    });

    it('setLanguage emits language-changed and notifies observers once', () => {
        const el = make();
        const events: string[] = [];
        const observed: string[] = [];
        el.addEventListener('language-changed', (e) => {
            events.push((e as CustomEvent).detail.language);
        });
        el.registerObserver((lang) => observed.push(lang));

        el.setLanguage('de');
        el.setLanguage('de'); // no-op
        assert.deepStrictEqual(events, ['de']);
        assert.deepStrictEqual(observed, ['de']);
        assert.strictEqual(el.getAttribute('lang'), 'de');
    });

    it('unregistered observers are no longer notified', () => {
        const el = make();
        const observed: string[] = [];
        const observer = (lang: string): void => {
            observed.push(lang);
        };
        el.registerObserver(observer);
        el.setLanguage('de');
        el.unregisterObserver(observer);
        el.setLanguage('en');
        assert.deepStrictEqual(observed, ['de']);
    });

    it('ignores unknown languages and keeps the lang attribute honest', () => {
        const el = make();
        el.setLanguage('fr');
        assert.strictEqual(el.getCurrentLanguage(), 'en');

        el.setAttribute('lang', 'fr');
        assert.strictEqual(el.getCurrentLanguage(), 'en');
        assert.strictEqual(el.getAttribute('lang'), 'en');
    });

    it('switches language via the lang attribute', () => {
        const el = make();
        el.setAttribute('lang', 'de');
        assert.strictEqual(el.getCurrentLanguage(), 'de');
        assert.strictEqual(el.t('ui.language'), 'Sprache');
    });

    it('supports custom languages via addTranslations with English fallback', () => {
        const el = make();
        el.addTranslations('fr', { ui: { elevation: 'Altitude' } });
        el.setLanguage('fr');
        assert.strictEqual(el.getCurrentLanguage(), 'fr');
        assert.strictEqual(el.t('ui.elevation'), 'Altitude');
        // Missing key in fr falls back to the English bundle.
        assert.strictEqual(el.t('ui.distance'), 'Distance');
        // Still unknown anywhere: the key itself.
        assert.strictEqual(el.t('ui.nope'), 'ui.nope');
    });

    it('extends an existing bundle without dropping its other keys', () => {
        const el = make({ lang: 'de' });
        el.addTranslations('de', { ui: { distance: 'Strecke' } });
        assert.strictEqual(el.t('ui.distance'), 'Strecke');
        assert.strictEqual(el.t('ui.elevation'), 'Höhe');
    });

    it('translates [data-i18n] elements on connect and on language change', () => {
        const heading = document.createElement('h1');
        heading.setAttribute('data-i18n', 'ui.trackMap');
        document.body.appendChild(heading);

        const el = make();
        assert.strictEqual(heading.textContent, 'Track Map');

        el.setLanguage('de');
        assert.strictEqual(heading.textContent, 'Streckenkarte');
    });
});

// --- regression tests for bugs.md fixes ---

describe('ring-i18n robustness (bugs.md fixes)', () => {
    it('resolves a region-tagged language to its base bundle (#26)', () => {
        const el = make();
        el.setLanguage('de-DE');
        assert.strictEqual(el.getCurrentLanguage(), 'de');
        assert.strictEqual(el.t('ui.elevation'), 'Höhe');
    });

    it('resolves a cased language tag (#26)', () => {
        const el = make();
        el.setAttribute('lang', 'DE');
        assert.strictEqual(el.getCurrentLanguage(), 'de');
    });

    it('honors a region-tagged lang attribute on connect (#26)', () => {
        const el = make({ lang: 'de-CH' });
        assert.strictEqual(el.getCurrentLanguage(), 'de');
    });

    it('isolates a throwing observer: language still switches and the event still fires (#25)', () => {
        const el = make();
        const events: string[] = [];
        let secondCalled = false;
        el.registerObserver(() => {
            throw new Error('boom');
        });
        el.registerObserver(() => (secondCalled = true));
        el.addEventListener('language-changed', (e) => events.push((e as CustomEvent).detail.language));

        assert.doesNotThrow(() => el.setLanguage('de'));
        assert.strictEqual(el.getCurrentLanguage(), 'de');
        assert.strictEqual(secondCalled, true, 'later observers still run');
        assert.deepStrictEqual(events, ['de'], 'language-changed still emitted');
    });

    it('re-reflects the language when the lang attribute is removed (#27)', () => {
        const el = make();
        el.setLanguage('de');
        el.removeAttribute('lang');
        assert.strictEqual(el.getCurrentLanguage(), 'de');
        assert.strictEqual(el.getAttribute('lang'), 'de');
    });

    it('keeps authored fallback text for an unknown data-i18n key (#28)', () => {
        const span = document.createElement('span');
        span.setAttribute('data-i18n', 'ui.someAppSpecificKey');
        span.textContent = 'Sensible fallback';
        document.body.appendChild(span);

        const el = make();
        assert.strictEqual(span.textContent, 'Sensible fallback');
        el.setLanguage('de'); // a language change must not clobber it either
        assert.strictEqual(span.textContent, 'Sensible fallback');
        span.remove();
    });
});
