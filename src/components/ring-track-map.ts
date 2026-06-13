/**
 * ring-track-map — interactive SVG map of the Nürburgring Nordschleife.
 * Renders the track from GPX data (via the `gpx-url` attribute or
 * {@link RingTrackMap.loadFromString}) with the 21 named sections as
 * clickable, hoverable segments. Sections can be highlighted, colored,
 * and zoomed to.
 *
 * @fires map-ready - Track data is parsed and the SVG is rendered
 * @fires section-click - A section segment was clicked
 * @fires section-hover - The pointer entered a section segment
 * @fires section-leave - The pointer left a section segment
 * @fires section-focus - The view zoomed to a section via focusSection()
 * @fires view-reset - The view returned to the full track via resetView()
 *
 * @cssprop --track-color - Stroke color of the track outline
 * @cssprop --track-width - Stroke width of the track outline
 * @cssprop --section-highlight - Stroke color of highlighted/selected sections
 * @cssprop --section-hover - Stroke color of a hovered section
 * @cssprop --background-color - Map background
 * @cssprop --text-color - Section label text color
 * @cssprop --label-background - Section label background
 */

import { GPXParser, type TrackData } from '../lib/gpx-parser.js';
import { gpsToSVG, generateTrackPath, createSections, createSVGElement, type SVGCoordinate, type TrackSection } from '../lib/svg-utils.js';
import { defineOnce, emit } from './util.js';

/** Section payload carried by section-click / section-hover / section-leave events. */
export interface SectionEventDetail {
    section: {
        name: string;
        distance: number;
        elevation: number;
        alternativeNames: string[];
        description: string;
    };
    coordinates: { lat: number; lon: number };
}

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 600;
const DEFAULT_VIEWBOX = `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;

/** Round to 2 decimals so computed viewBoxes don't leak float noise (#18). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

const TEMPLATE = `
<style>
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }
  .container {
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--background-color, #ffffff);
  }
  svg { width: 100%; height: 100%; }
  .track-path {
    fill: none;
    stroke: var(--track-color, #2c3e50);
    stroke-width: var(--track-width, 3px);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .section-path {
    fill: none;
    stroke: transparent;
    stroke-width: 8px;
    cursor: pointer;
    transition: stroke 0.2s ease;
  }
  .section-path:hover {
    stroke: var(--section-hover, #3498db);
    stroke-opacity: 0.5;
  }
  .section-path.highlighted {
    stroke: var(--section-highlight, #e74c3c);
    stroke-opacity: 0.7;
  }
  .section-path.selected {
    stroke: var(--section-highlight, #e74c3c);
    stroke-opacity: 0.9;
  }
  .section-label {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    fill: var(--text-color, #2c3e50);
    pointer-events: none;
    user-select: none;
  }
  .section-label-bg {
    fill: var(--label-background, rgba(255, 255, 255, 0.9));
    stroke: var(--text-color, #2c3e50);
    stroke-width: 0.5;
    opacity: 0.95;
  }
  .state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--text-color, #2c3e50);
  }
  .state.error { color: #e74c3c; }
  [hidden] { display: none !important; }
</style>
<div class="container">
  <div class="state loading">Loading track data…</div>
  <div class="state empty" hidden>No track data</div>
  <div class="state error" hidden></div>
</div>
`;

export class RingTrackMap extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['gpx-url', 'highlight-sections', 'show-labels'];
    }

    private readonly root: ShadowRoot;
    private rendered = false;
    private data: TrackData | null = null;
    private svgCoordinates: SVGCoordinate[] = [];
    private trackSections: TrackSection[] = [];
    /** Index into {@link trackSections}; identity survives re-render, not reload. */
    private selectedIndex: number | null = null;
    private readonly sectionColors = new Map<string, string>();
    /** Current viewBox, preserved across re-renders; null means the full track. */
    private currentViewBox: string | null = null;
    /** Monotonic id so a slow fetch can't overwrite a newer one (#13). */
    private loadToken = 0;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
    }

    /** Parsed track data (a shallow copy), or null before any GPX has loaded. */
    get trackData(): TrackData | null {
        if (!this.data) return null;
        return {
            trackPoints: this.data.trackPoints.slice(),
            waypoints: this.data.waypoints.slice(),
            totalDistance: this.data.totalDistance,
        };
    }

    /** The track sliced into named sections (a shallow copy; empty before load). */
    get sections(): TrackSection[] {
        return this.trackSections.slice();
    }

    connectedCallback(): void {
        if (!this.rendered) {
            this.root.innerHTML = TEMPLATE;
            this.rendered = true;
        }
        // Only fetch on (re)connect when nothing has been loaded yet, so moving
        // the element in the DOM doesn't refetch and clobber loaded data (#12).
        if (!this.data && this.getAttribute('gpx-url')) {
            void this.loadFromUrl();
        }
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue || !this.rendered) return;
        if (name === 'gpx-url') {
            void this.loadFromUrl();
        } else if (name === 'highlight-sections') {
            this.applyHighlights();
        } else if (this.data) {
            this.renderTrack();
        }
    }

    /** Fetch and render the GPX document referenced by `gpx-url`. */
    private async loadFromUrl(): Promise<void> {
        const gpxUrl = this.getAttribute('gpx-url');
        if (!gpxUrl) return;
        const token = ++this.loadToken;
        try {
            const response = await fetch(gpxUrl);
            if (!response.ok) {
                throw new Error(`Failed to load GPX file: ${response.statusText}`);
            }
            const text = await response.text();
            if (token !== this.loadToken) return; // superseded by a newer load
            this.loadFromString(text);
        } catch (error) {
            if (token !== this.loadToken) return;
            this.showError(error instanceof Error ? error.message : String(error));
        }
    }

    /** Parse a GPX string and render the track. Useful for tests and inlined data. */
    loadFromString(gpxText: string): void {
        this.loadToken++; // supersede any in-flight fetch
        let data: TrackData;
        try {
            data = GPXParser.parse(gpxText);
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
            return;
        }
        // New track: drop selection/zoom that belonged to the old one (#11, #9).
        this.data = data;
        this.selectedIndex = null;
        this.currentViewBox = null;
        this.renderTrack();
        emit(this, 'map-ready', {
            trackData: this.trackData,
            sections: this.sections,
            empty: data.trackPoints.length === 0,
        });
    }

    private renderTrack(): void {
        if (!this.data) return;

        const container = this.root.querySelector('.container');
        if (!container) return;

        if (this.data.trackPoints.length === 0) {
            container.querySelector('svg')?.remove();
            this.trackSections = [];
            this.svgCoordinates = [];
            this.setState('empty');
            return;
        }

        const doc = this.ownerDocument;
        const svg = createSVGElement(doc, 'svg', {
            // Preserve any active zoom across re-renders (e.g. toggling labels) (#9).
            viewBox: this.currentViewBox ?? DEFAULT_VIEWBOX,
            preserveAspectRatio: 'xMidYMid meet',
        });

        this.svgCoordinates = gpsToSVG(this.data.trackPoints, VIEW_WIDTH, VIEW_HEIGHT, 40);
        this.trackSections = createSections(this.data.waypoints, this.svgCoordinates, this.data.trackPoints);

        const mainPath = createSVGElement(doc, 'path', {
            class: 'track-path',
            d: generateTrackPath(this.svgCoordinates, true),
        });
        svg.appendChild(mainPath);

        this.trackSections.forEach((section, index) => {
            if (section.coordinates.length === 0) return;
            const sectionPath = createSVGElement(doc, 'path', {
                class: 'section-path',
                d: section.path,
                'data-section': section.name,
                'data-index': index,
            });
            sectionPath.addEventListener('click', () => this.handleSectionClick(index));
            sectionPath.addEventListener('mouseenter', () => this.handleSectionHover(index));
            sectionPath.addEventListener('mouseleave', () => this.handleSectionLeave(index));
            svg.appendChild(sectionPath);
        });

        if (this.labelsEnabled()) {
            this.addLabels(svg);
        }

        this.setState('none');
        container.querySelector('svg')?.remove();
        container.appendChild(svg);

        this.applyHighlights();
    }

    /** Boolean attribute with the literal string `"false"` treated as off (#15). */
    private labelsEnabled(): boolean {
        return this.hasAttribute('show-labels') && this.getAttribute('show-labels') !== 'false';
    }

    private addLabels(svg: SVGSVGElement): void {
        const doc = this.ownerDocument;
        for (const section of this.trackSections) {
            const coord = section.coordinates[Math.floor(section.coordinates.length / 2)];
            if (!coord) continue;

            const labelGroup = createSVGElement(doc, 'g', { class: 'section-label-group' });

            // No layout in jsdom and no text metrics pre-render: approximate.
            const textWidth = section.name.length * 6;
            const textHeight = 16;
            const padding = 4;

            const bg = createSVGElement(doc, 'rect', {
                class: 'section-label-bg',
                x: coord.x - textWidth / 2 - padding,
                y: coord.y - textHeight / 2 - padding,
                width: textWidth + padding * 2,
                height: textHeight + padding * 2,
                rx: 3,
            });

            const label = createSVGElement(doc, 'text', {
                class: 'section-label',
                x: coord.x,
                y: coord.y + 4,
                'text-anchor': 'middle',
            });
            label.textContent = section.name;

            labelGroup.appendChild(bg);
            labelGroup.appendChild(label);
            svg.appendChild(labelGroup);
        }
    }

    private sectionDetail(section: TrackSection): SectionEventDetail {
        return {
            section: {
                name: section.name,
                distance: section.startKm,
                elevation: section.ele,
                alternativeNames: section.alternativeNames,
                description: section.desc,
            },
            coordinates: { lat: section.lat, lon: section.lon },
        };
    }

    private handleSectionClick(index: number): void {
        this.selectedIndex = index;
        this.applyHighlights();
        emit(this, 'section-click', this.sectionDetail(this.trackSections[index]));
    }

    private handleSectionHover(index: number): void {
        emit(this, 'section-hover', this.sectionDetail(this.trackSections[index]));
    }

    private handleSectionLeave(index: number): void {
        emit(this, 'section-leave', this.sectionDetail(this.trackSections[index]));
    }

    /**
     * Resolve the `highlight-sections` attribute (comma-separated names) to
     * section indices. Matching by index avoids interpolating untrusted names
     * into a CSS selector (#10).
     */
    private highlightedIndices(): number[] {
        const attr = this.getAttribute('highlight-sections');
        if (!attr) return [];
        const indices: number[] = [];
        for (const name of attr.split(',').map((s) => s.trim())) {
            if (!name) continue;
            const idx = this.trackSections.findIndex((s) => s.name === name);
            if (idx !== -1) indices.push(idx);
        }
        return indices;
    }

    private pathAt(svg: SVGSVGElement, index: number): SVGPathElement | null {
        return svg.querySelector<SVGPathElement>(`.section-path[data-index="${index}"]`);
    }

    private applyHighlights(): void {
        const svg = this.root.querySelector('svg');
        if (!svg) return;

        for (const path of svg.querySelectorAll<SVGPathElement>('.section-path')) {
            path.classList.remove('highlighted', 'selected');
            path.style.stroke = '';
            path.style.strokeOpacity = '';
        }

        for (const index of this.highlightedIndices()) {
            const path = this.pathAt(svg, index);
            if (!path) continue;
            path.classList.add('highlighted');
            const color = this.sectionColors.get(this.trackSections[index].name);
            if (color) {
                path.style.stroke = color;
                path.style.strokeOpacity = '0.7';
            }
        }

        if (this.selectedIndex !== null) {
            const path = this.pathAt(svg, this.selectedIndex);
            if (path) {
                path.classList.add('selected');
                const color = this.sectionColors.get(this.trackSections[this.selectedIndex].name);
                if (color) {
                    path.style.stroke = color;
                    path.style.strokeOpacity = '0.9';
                }
            }
        }
    }

    /** Select and highlight a single section by name. */
    highlightSection(sectionName: string): void {
        const index = this.trackSections.findIndex((s) => s.name === sectionName);
        if (index !== -1) {
            this.selectedIndex = index;
            this.applyHighlights();
        }
    }

    /** Highlight a set of sections (reflected in the `highlight-sections` attribute). */
    highlightSections(sectionNames: string[] | string): void {
        const names = Array.isArray(sectionNames) ? sectionNames : [sectionNames];
        this.setAttribute('highlight-sections', names.join(','));
    }

    /** Assign a custom highlight color to a section. */
    setSectionColor(sectionName: string, color: string): void {
        this.sectionColors.set(sectionName, color);
        this.applyHighlights();
    }

    /** Assign custom highlight colors for several sections at once. */
    setSectionColors(colorMap: Record<string, string>): void {
        for (const [name, color] of Object.entries(colorMap)) {
            this.sectionColors.set(name, color);
        }
        this.applyHighlights();
    }

    /** Remove all custom section colors. */
    clearSectionColors(): void {
        this.sectionColors.clear();
        this.applyHighlights();
    }

    /** Zoom the viewBox to a section's bounding box and select it. */
    focusSection(sectionName: string, padding = 50): void {
        const section = this.trackSections.find((s) => s.name === sectionName);
        if (!section || section.coordinates.length === 0) return;

        const svg = this.root.querySelector('svg');
        if (!svg) return;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const coord of section.coordinates) {
            minX = Math.min(minX, coord.x);
            minY = Math.min(minY, coord.y);
            maxX = Math.max(maxX, coord.x);
            maxY = Math.max(maxY, coord.y);
        }

        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const viewBox = `${round2(minX)} ${round2(minY)} ${round2(maxX - minX)} ${round2(maxY - minY)}`;
        this.currentViewBox = viewBox;
        svg.style.transition = 'all 0.5s ease-in-out';
        svg.setAttribute('viewBox', viewBox);

        this.highlightSection(sectionName);
        emit(this, 'section-focus', { section, viewBox });
    }

    /** Reset zoom, selection, and highlights to the initial full-track view. */
    resetView(): void {
        const svg = this.root.querySelector('svg');
        if (!svg) return;

        this.currentViewBox = null;
        svg.style.transition = 'all 0.5s ease-in-out';
        svg.setAttribute('viewBox', DEFAULT_VIEWBOX);

        this.selectedIndex = null;
        this.removeAttribute('highlight-sections');
        this.applyHighlights();

        emit(this, 'view-reset', {});
    }

    /** Toggle the loading / empty / error overlays; `'none'` hides them all. */
    private setState(which: 'loading' | 'empty' | 'error' | 'none', message?: string): void {
        for (const name of ['loading', 'empty', 'error'] as const) {
            const el = this.root.querySelector(`.state.${name}`);
            if (el) el.toggleAttribute('hidden', name !== which);
        }
        if (which === 'error' && message !== undefined) {
            const el = this.root.querySelector('.state.error');
            if (el) el.textContent = `Error: ${message}`;
        }
    }

    private showError(message: string): void {
        this.root.querySelector('.container svg')?.remove();
        this.setState('error', message);
    }
}

defineOnce('ring-track-map', RingTrackMap);
