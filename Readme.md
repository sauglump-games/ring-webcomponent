# ring-webcomponents

Vanilla web components for the **Nürburgring Nordschleife** — built with
[banira](https://github.com/sebs/banira): no bundler, no framework, just web
standards and TypeScript.

The components render the track from GPX data (534 track points, 21 named
sections, ~20.8 km, ~300 m of elevation).

## Components

| Tag | Description |
|---|---|
| `<ring-track-map>` | Interactive SVG map of the Nordschleife with the 21 named sections as clickable, hoverable, highlightable segments. Supports zooming to a section. |
| `<ring-elevation-profile>` | SVG elevation area chart with optional grid, metric/imperial units, and a hover tooltip showing distance, elevation, and section. |
| `<ring-i18n>` | Internationalization service element with built-in English and German bundles (section names + UI labels), browser-language detection, `{param}` substitution, and automatic `data-i18n` translation. |

## Usage

```html
<script type="module" src="./dist/index.js"></script>

<ring-track-map gpx-url="./nordschleife.gpx" show-labels></ring-track-map>
<ring-elevation-profile gpx-url="./nordschleife.gpx" show-grid units="metric"></ring-elevation-profile>

<script>
  const map = document.querySelector('ring-track-map');
  map.addEventListener('section-click', (e) => {
    console.log(e.detail.section.name, e.detail.section.description);
  });
  map.highlightSections(['Fuchsröhre', 'Brünnchen']);
  map.focusSection('Klostertalkurve'); // zoom to the Caracciola-Karussell section
</script>
```

GPX can also be supplied as a string instead of a URL:
`element.loadFromString(gpxText)`.

### `<ring-track-map>`

- **Attributes**: `gpx-url`, `highlight-sections` (comma-separated names), `show-labels`
- **Events**: `map-ready`, `section-click`, `section-hover`, `section-focus`, `view-reset`
- **Methods**: `loadFromString()`, `highlightSection()`, `highlightSections()`, `setSectionColor()`, `setSectionColors()`, `clearSectionColors()`, `focusSection()`, `resetView()`
- **Theming**: `--track-color`, `--track-width`, `--section-highlight`, `--section-hover`, `--background-color`, `--text-color`, `--label-background`

### `<ring-elevation-profile>`

- **Attributes**: `gpx-url`, `units` (`metric` | `imperial`), `show-grid`
- **Events**: `profile-ready`, `profile-hover`, `profile-click`
- **Methods**: `loadFromString()`
- **Theming**: `--background-color`, `--text-color`, `--grid-color`, `--elevation-fill`, `--elevation-stroke`, `--tooltip-background`, `--tooltip-text`

### `<ring-i18n>`

```html
<ring-i18n lang="de"></ring-i18n>
<h1 data-i18n="ui.trackMap"></h1>
```

- **Attributes**: `lang` (`en` | `de`, reflected; defaults to the browser language)
- **Events**: `language-changed`
- **Methods**: `setLanguage()`, `getCurrentLanguage()`, `getLanguages()`, `t(key, params)` (alias `translateKey()`), `addTranslations()`, `applyTranslations()`, `registerObserver()`, `unregisterObserver()`
- Keys are dot-separated (`sections.Fuchsröhre`, `ui.totalDistance`) with `{param}` substitution; missing keys fall back to English, then to the key itself. Elements with `data-i18n="<key>"` are re-translated on every language change.

The full API (generated from the sources) lives in
[custom-elements.json](./custom-elements.json) and the pages under `docs/`
after `npm run docs`.

## Development

```bash
npm install
npm test          # node --test via tsx, jsdom DOM harness
npm run lint      # strict tsc over src/ and test/
npm run build     # compile to dist/ + regenerate custom-elements.json
npm run docs      # offline HTML doc pages into docs/
npm run demo      # serve the repo; open http://localhost:8080/demo/
```

### Layout

```
src/
  components/   ring-track-map.ts, ring-elevation-profile.ts, ring-i18n.ts, util.ts
  lib/          gpx-parser.ts, math-utils.ts, svg-utils.ts, translations.ts
test/           node:test suites + jsdom harness (dom.ts) + GPX fixtures
demo/           demo page + nordschleife.gpx (track data with 21 sections)
prototypes/     the original vanilla-JS prototype this port is based on
```

## License

ISC — © Sebastian Schürmann
