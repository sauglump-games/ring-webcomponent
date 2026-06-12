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
import { gpsToSVG, generatePath, createSections, createSVGElement, type SVGCoordinate, type TrackSection } from '../lib/svg-utils.js';
import { defineOnce, emit, boolAttr } from './util.js';

/** Section payload carried by section-click / section-hover events. */
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
  .loading, .error {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--text-color, #2c3e50);
  }
  .error { color: #e74c3c; }
</style>
<div class="container">
  <div class="loading">Loading track data…</div>
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
    private selectedSection: TrackSection | null = null;
    private readonly sectionColors = new Map<string, string>();

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
    }

    /** Parsed track data, or null before any GPX has loaded. */
    get trackData(): TrackData | null {
        return this.data;
    }

    /** The track sliced into named sections (empty before data loads). */
    get sections(): TrackSection[] {
        return this.trackSections;
    }

    connectedCallback(): void {
        if (!this.rendered) {
            this.root.innerHTML = TEMPLATE;
            this.rendered = true;
        }
        if (this.getAttribute('gpx-url')) {
            void this.loadFromUrl();
        }
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (oldValue === newValue || !this.rendered) return;
        if (name === 'gpx-url') {
            void this.loadFromUrl();
        } else if (this.data) {
            this.renderTrack();
        }
    }

    /** Fetch and render the GPX document referenced by `gpx-url`. */
    private async loadFromUrl(): Promise<void> {
        const gpxUrl = this.getAttribute('gpx-url');
        if (!gpxUrl) return;
        try {
            const response = await fetch(gpxUrl);
            if (!response.ok) {
                throw new Error(`Failed to load GPX file: ${response.statusText}`);
            }
            this.loadFromString(await response.text());
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
        }
    }

    /** Parse a GPX string and render the track. Useful for tests and inlined data. */
    loadFromString(gpxText: string): void {
        try {
            this.data = GPXParser.parse(gpxText);
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
            return;
        }
        this.renderTrack();
        emit(this, 'map-ready', { trackData: this.data, sections: this.trackSections });
    }

    private renderTrack(): void {
        if (!this.data) return;

        const container = this.root.querySelector('.container');
        if (!container) return;

        const doc = this.ownerDocument;
        const svg = createSVGElement(doc, 'svg', {
            viewBox: DEFAULT_VIEWBOX,
            preserveAspectRatio: 'xMidYMid meet',
        });

        this.svgCoordinates = gpsToSVG(this.data.trackPoints, VIEW_WIDTH, VIEW_HEIGHT, 40);
        this.trackSections = createSections(this.data.waypoints, this.svgCoordinates, this.data.trackPoints);

        const mainPath = createSVGElement(doc, 'path', {
            class: 'track-path',
            d: generatePath(this.svgCoordinates, true),
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
            sectionPath.addEventListener('click', () => this.handleSectionClick(section));
            sectionPath.addEventListener('mouseenter', () => this.handleSectionHover(section));
            svg.appendChild(sectionPath);
        });

        if (boolAttr(this, 'show-labels')) {
            this.addLabels(svg);
        }

        container.innerHTML = '';
        container.appendChild(svg);

        this.applyHighlights();
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

    private handleSectionClick(section: TrackSection): void {
        this.selectedSection = section;
        this.applyHighlights();
        emit(this, 'section-click', this.sectionDetail(section));
    }

    private handleSectionHover(section: TrackSection): void {
        emit(this, 'section-hover', this.sectionDetail(section));
    }

    private applyHighlights(): void {
        const svg = this.root.querySelector('svg');
        if (!svg) return;

        for (const path of svg.querySelectorAll<SVGPathElement>('.section-path')) {
            path.classList.remove('highlighted', 'selected');
            path.style.stroke = '';
            path.style.strokeOpacity = '';
        }

        const highlightAttr = this.getAttribute('highlight-sections');
        if (highlightAttr) {
            for (const name of highlightAttr.split(',').map((s) => s.trim())) {
                const path = svg.querySelector<SVGPathElement>(`[data-section="${name}"]`);
                if (!path) continue;
                path.classList.add('highlighted');
                const color = this.sectionColors.get(name);
                if (color) {
                    path.style.stroke = color;
                    path.style.strokeOpacity = '0.7';
                }
            }
        }

        if (this.selectedSection) {
            const path = svg.querySelector<SVGPathElement>(`[data-section="${this.selectedSection.name}"]`);
            if (path) {
                path.classList.add('selected');
                const color = this.sectionColors.get(this.selectedSection.name);
                if (color) {
                    path.style.stroke = color;
                    path.style.strokeOpacity = '0.9';
                }
            }
        }
    }

    /** Select and highlight a single section by name. */
    highlightSection(sectionName: string): void {
        const section = this.trackSections.find((s) => s.name === sectionName);
        if (section) {
            this.selectedSection = section;
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

        const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
        svg.style.transition = 'all 0.5s ease-in-out';
        svg.setAttribute('viewBox', viewBox);

        this.highlightSection(sectionName);
        emit(this, 'section-focus', { section, viewBox });
    }

    /** Reset zoom, selection, and highlights to the initial full-track view. */
    resetView(): void {
        const svg = this.root.querySelector('svg');
        if (!svg) return;

        svg.style.transition = 'all 0.5s ease-in-out';
        svg.setAttribute('viewBox', DEFAULT_VIEWBOX);

        this.selectedSection = null;
        this.removeAttribute('highlight-sections');
        this.applyHighlights();

        emit(this, 'view-reset', {});
    }

    private showError(message: string): void {
        const container = this.root.querySelector('.container');
        if (!container) return;
        container.innerHTML = '<div class="error"></div>';
        const error = container.querySelector('.error');
        if (error) error.textContent = `Error: ${message}`;
    }
}

defineOnce('ring-track-map', RingTrackMap);
