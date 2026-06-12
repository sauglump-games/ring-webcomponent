/**
 * Built-in translation resources for the Nürburgring components: the 21
 * Nordschleife section names and the UI labels, in English and German.
 * Custom languages can be added at runtime via `RingI18n.addTranslations`.
 */

/** A bundle of translations: section names and UI labels. */
export interface TranslationBundle {
    sections: Record<string, string>;
    ui: Record<string, string>;
}

export const EN: TranslationBundle = {
    sections: {
        Driveway: 'Driveway',
        Hohenrain: 'Hohenrain',
        Hatzenbach: 'Hatzenbach',
        Hocheichen: 'Hocheichen',
        Flugplatz: 'Flugplatz',
        Schwedenkreuz: 'Swedish Cross',
        Fuchsröhre: 'Fox Tube',
        Metzgesfeld: 'Metzgesfeld',
        Kallenhard: 'Kallenhard',
        Wehrseifen: 'Wehrseifen',
        ExTal: 'Ex Valley',
        Kesselchen: 'Little Kettle',
        Mutkurve: 'Courage Curve',
        Klostertalkurve: 'Monastery Valley Curve',
        'Posten 147': 'Post 147',
        Hedwigshöhe: "Hedwig's Height",
        Brünnchen: 'Little Spring',
        'kleiner Sprunghügel': 'Small Jumping Hill',
        Schwalbenschwanz: "Swallow's Tail",
        Galgenkopf: 'Gallows Head',
        'Döttinger Höhe': 'Döttinger Height',
    },
    ui: {
        elevation: 'Elevation',
        distance: 'Distance',
        gradient: 'Gradient',
        section: 'Section',
        meters: 'Meters',
        kilometers: 'Kilometers',
        percentage: 'Percent',
        loading: 'Loading...',
        error: 'Error',
        trackMap: 'Track Map',
        elevationProfile: 'Elevation Profile',
        language: 'Language',
        english: 'English',
        german: 'German',
        showLabels: 'Show Labels',
        showGrid: 'Show Grid',
        units: 'Units',
        metric: 'Metric',
        imperial: 'Imperial',
        totalDistance: 'Total Distance: {distance}',
        elevationRange: 'Elevation Range: {min} - {max}',
        clickSection: 'Click on a section to view details',
    },
};

export const DE: TranslationBundle = {
    sections: {
        Driveway: 'Einfahrt',
        Hohenrain: 'Hohenrain',
        Hatzenbach: 'Hatzenbach',
        Hocheichen: 'Hocheichen',
        Flugplatz: 'Flugplatz',
        Schwedenkreuz: 'Schwedenkreuz',
        Fuchsröhre: 'Fuchsröhre',
        Metzgesfeld: 'Metzgesfeld',
        Kallenhard: 'Kallenhard',
        Wehrseifen: 'Wehrseifen',
        ExTal: 'ExTal',
        Kesselchen: 'Kesselchen',
        Mutkurve: 'Mutkurve',
        Klostertalkurve: 'Klostertalkurve',
        'Posten 147': 'Posten 147',
        Hedwigshöhe: 'Hedwigshöhe',
        Brünnchen: 'Brünnchen',
        'kleiner Sprunghügel': 'kleiner Sprunghügel',
        Schwalbenschwanz: 'Schwalbenschwanz',
        Galgenkopf: 'Galgenkopf',
        'Döttinger Höhe': 'Döttinger Höhe',
    },
    ui: {
        elevation: 'Höhe',
        distance: 'Entfernung',
        gradient: 'Steigung',
        section: 'Abschnitt',
        meters: 'Meter',
        kilometers: 'Kilometer',
        percentage: 'Prozent',
        loading: 'Lädt...',
        error: 'Fehler',
        trackMap: 'Streckenkarte',
        elevationProfile: 'Höhenprofil',
        language: 'Sprache',
        english: 'Englisch',
        german: 'Deutsch',
        showLabels: 'Beschriftungen anzeigen',
        showGrid: 'Raster anzeigen',
        units: 'Einheiten',
        metric: 'Metrisch',
        imperial: 'Imperial',
        totalDistance: 'Gesamtdistanz: {distance}',
        elevationRange: 'Höhenbereich: {min} - {max}',
        clickSection: 'Klicken Sie auf einen Abschnitt, um Details anzuzeigen',
    },
};

/** The translation bundles shipped with the library. */
export const BUILT_IN_TRANSLATIONS: Record<string, TranslationBundle> = {
    en: EN,
    de: DE,
};
