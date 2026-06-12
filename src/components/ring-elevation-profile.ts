/**
 * ring-elevation-profile — SVG elevation profile of the Nürburgring
 * Nordschleife (≈300 m of elevation over 20.8 km). Renders an area chart
 * from GPX data (via the `gpx-url` attribute or
 * {@link RingElevationProfile.loadFromString}) with optional grid, metric or
 * imperial axis labels, and a hover tooltip showing distance, elevation, and
 * the track section under the pointer.
 *
 * @fires profile-ready - Track data is parsed and the profile is rendered
 * @fires profile-hover - The pointer moved over a point of the profile
 * @fires profile-click - The profile was clicked at a point
 *
 * @cssprop --background-color - Chart background
 * @cssprop --text-color - Axis label color
 * @cssprop --grid-color - Grid line color
 * @cssprop --elevation-fill - Fill color of the elevation area
 * @cssprop --elevation-stroke - Stroke color of the elevation curve
 * @cssprop --tooltip-background - Tooltip background
 * @cssprop --tooltip-text - Tooltip text color
 */

import { GPXParser, type TrackData, type TrackPoint } from '../lib/gpx-parser.js';
import { createSVGElement } from '../lib/svg-utils.js';
import { metersToFeet, kmToMiles, clamp } from '../lib/math-utils.js';
import { defineOnce, emit, boolAttr } from './util.js';

/** Payload carried by profile-hover / profile-click events. */
export interface ProfileEventDetail {
    /** Distance from the start in kilometers. */
    distance: number;
    /** Elevation in meters. */
    elevation: number;
    point: TrackPoint;
}

const VIEW_WIDTH = 800;
const VIEW_HEIGHT = 300;
const PADDING = { top: 20, right: 40, bottom: 40, left: 50 } as const;
const GRAPH_WIDTH = VIEW_WIDTH - PADDING.left - PADDING.right;
const GRAPH_HEIGHT = VIEW_HEIGHT - PADDING.top - PADDING.bottom;

const TEMPLATE = `
<style>
  :host {
    display: block;
    width: 100%;
    height: 300px;
  }
  .container {
    width: 100%;
    height: 100%;
    position: relative;
    background: var(--background-color, #ffffff);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }
  .grid-line {
    stroke: var(--grid-color, #ecf0f1);
    stroke-width: 1;
    stroke-dasharray: 2 2;
  }
  .elevation-area {
    fill: var(--elevation-fill, #27ae60);
    fill-opacity: 0.35;
  }
  .elevation-line {
    fill: none;
    stroke: var(--elevation-stroke, #229954);
    stroke-width: 2;
  }
  .axis-label {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    fill: var(--text-color, #2c3e50);
  }
  .tooltip {
    position: absolute;
    background: var(--tooltip-background, rgba(44, 62, 80, 0.95));
    color: var(--tooltip-text, #ffffff);
    padding: 8px 12px;
    border-radius: 4px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    white-space: nowrap;
    z-index: 10;
  }
  .tooltip.visible { opacity: 1; }
  .tooltip-line { margin: 2px 0; }
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
  <div class="tooltip"></div>
  <div class="loading">Loading elevation data…</div>
</div>
`;

export class RingElevationProfile extends HTMLElement {
    static get observedAttributes(): string[] {
        return ['gpx-url', 'units', 'show-grid'];
    }

    private readonly root: ShadowRoot;
    private rendered = false;
    private data: TrackData | null = null;
    private hoveredPoint: TrackPoint | null = null;

    constructor() {
        super();
        this.root = this.attachShadow({ mode: 'open' });
    }

    /** Parsed track data, or null before any GPX has loaded. */
    get trackData(): TrackData | null {
        return this.data;
    }

    /** `'metric'` (default) or `'imperial'` axis/tooltip units. */
    get units(): string {
        return this.getAttribute('units') ?? 'metric';
    }
    set units(v: string) {
        this.setAttribute('units', v);
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
            this.renderProfile();
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

    /** Parse a GPX string and render the profile. Useful for tests and inlined data. */
    loadFromString(gpxText: string): void {
        try {
            this.data = GPXParser.parse(gpxText);
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
            return;
        }
        this.renderProfile();
        emit(this, 'profile-ready', { trackData: this.data });
    }

    private renderProfile(): void {
        if (!this.data || this.data.trackPoints.length === 0) return;

        const container = this.root.querySelector('.container');
        if (!container) return;

        const loading = container.querySelector('.loading');
        if (loading) loading.remove();
        const previous = container.querySelector('svg');
        if (previous) previous.remove();

        const doc = this.ownerDocument;
        const svg = createSVGElement(doc, 'svg', {
            viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`,
            preserveAspectRatio: 'xMidYMid meet',
        });

        const { trackPoints } = this.data;
        const elevations = trackPoints.map((p) => p.ele);
        const minEle = Math.min(...elevations);
        const maxEle = Math.max(...elevations);
        const eleRange = maxEle - minEle || 1;
        const maxDistance = trackPoints[trackPoints.length - 1].distance || 1;

        const toX = (distance: number): number => PADDING.left + (distance / maxDistance) * GRAPH_WIDTH;
        const toY = (ele: number): number => PADDING.top + GRAPH_HEIGHT - ((ele - minEle) / eleRange) * GRAPH_HEIGHT;

        if (boolAttr(this, 'show-grid')) {
            this.drawGrid(svg);
        }

        const linePoints = trackPoints.map((p) => `${toX(p.distance)} ${toY(p.ele)}`);
        const lineD = `M ${linePoints.join(' L ')}`;
        const baseline = PADDING.top + GRAPH_HEIGHT;
        const areaD = `M ${PADDING.left} ${baseline} L ${linePoints.join(' L ')} L ${PADDING.left + GRAPH_WIDTH} ${baseline} Z`;

        svg.appendChild(createSVGElement(doc, 'path', { class: 'elevation-area', d: areaD }));
        svg.appendChild(createSVGElement(doc, 'path', { class: 'elevation-line', d: lineD }));

        this.drawAxisLabels(svg, maxDistance, minEle, maxEle);

        svg.addEventListener('mousemove', (e) => this.handleMouseMove(e as MouseEvent));
        svg.addEventListener('mouseleave', () => this.handleMouseLeave());
        svg.addEventListener('click', () => this.handleClick());

        container.appendChild(svg);
    }

    private drawGrid(svg: SVGSVGElement): void {
        const doc = this.ownerDocument;
        const eleSteps = 5;
        for (let i = 0; i <= eleSteps; i++) {
            const y = PADDING.top + (GRAPH_HEIGHT / eleSteps) * i;
            svg.appendChild(
                createSVGElement(doc, 'line', {
                    class: 'grid-line',
                    x1: PADDING.left,
                    y1: y,
                    x2: PADDING.left + GRAPH_WIDTH,
                    y2: y,
                })
            );
        }
        const distSteps = 10;
        for (let i = 0; i <= distSteps; i++) {
            const x = PADDING.left + (GRAPH_WIDTH / distSteps) * i;
            svg.appendChild(
                createSVGElement(doc, 'line', {
                    class: 'grid-line',
                    x1: x,
                    y1: PADDING.top,
                    x2: x,
                    y2: PADDING.top + GRAPH_HEIGHT,
                })
            );
        }
    }

    private drawAxisLabels(svg: SVGSVGElement, maxDistance: number, minEle: number, maxEle: number): void {
        const doc = this.ownerDocument;
        const imperial = this.units === 'imperial';

        const distSteps = 5;
        for (let i = 0; i <= distSteps; i++) {
            const distance = (maxDistance / distSteps) * i;
            const x = PADDING.left + (GRAPH_WIDTH / distSteps) * i;
            const label = createSVGElement(doc, 'text', {
                class: 'axis-label',
                'data-axis': 'x',
                x,
                y: PADDING.top + GRAPH_HEIGHT + 20,
                'text-anchor': 'middle',
            });
            label.textContent = imperial
                ? `${kmToMiles(distance).toFixed(1)} mi`
                : `${distance.toFixed(1)} km`;
            svg.appendChild(label);
        }

        const eleSteps = 5;
        const eleRange = maxEle - minEle;
        for (let i = 0; i <= eleSteps; i++) {
            const elevation = minEle + (eleRange / eleSteps) * i;
            const y = PADDING.top + GRAPH_HEIGHT - (GRAPH_HEIGHT / eleSteps) * i;
            const label = createSVGElement(doc, 'text', {
                class: 'axis-label',
                'data-axis': 'y',
                x: PADDING.left - 10,
                y: y + 4,
                'text-anchor': 'end',
            });
            label.textContent = imperial
                ? `${Math.round(metersToFeet(elevation))} ft`
                : `${Math.round(elevation)} m`;
            svg.appendChild(label);
        }
    }

    /**
     * Map a mouse position to viewBox coordinates. When layout yields no size
     * (jsdom), client coordinates are taken as viewBox coordinates directly.
     */
    private toViewX(event: MouseEvent): number {
        const svg = this.root.querySelector('svg');
        if (!svg) return 0;
        const rect = svg.getBoundingClientRect();
        const scale = rect.width > 0 ? VIEW_WIDTH / rect.width : 1;
        return (event.clientX - rect.left) * scale;
    }

    /** The track point nearest to a distance along the track. */
    private pointAtDistance(distance: number): TrackPoint {
        const { trackPoints } = this.data!;
        let closest = trackPoints[0];
        let minDiff = Math.abs(closest.distance - distance);
        for (const point of trackPoints) {
            const diff = Math.abs(point.distance - distance);
            if (diff < minDiff) {
                minDiff = diff;
                closest = point;
            }
        }
        return closest;
    }

    private handleMouseMove(event: MouseEvent): void {
        if (!this.data || this.data.trackPoints.length === 0) return;

        const viewX = this.toViewX(event);
        if (viewX < PADDING.left || viewX > PADDING.left + GRAPH_WIDTH) {
            this.hideTooltip();
            this.hoveredPoint = null;
            return;
        }

        const { trackPoints } = this.data;
        const maxDistance = trackPoints[trackPoints.length - 1].distance;
        const distance = clamp(((viewX - PADDING.left) / GRAPH_WIDTH) * maxDistance, 0, maxDistance);
        const point = this.pointAtDistance(distance);

        this.hoveredPoint = point;
        this.showTooltip(point, viewX);
        emit<ProfileEventDetail>(this, 'profile-hover', {
            distance: point.distance,
            elevation: point.ele,
            point,
        });
    }

    private handleMouseLeave(): void {
        this.hideTooltip();
        this.hoveredPoint = null;
    }

    private handleClick(): void {
        if (!this.hoveredPoint) return;
        emit<ProfileEventDetail>(this, 'profile-click', {
            distance: this.hoveredPoint.distance,
            elevation: this.hoveredPoint.ele,
            point: this.hoveredPoint,
        });
    }

    private showTooltip(point: TrackPoint, viewX: number): void {
        const tooltip = this.root.querySelector<HTMLElement>('.tooltip');
        if (!tooltip) return;

        const imperial = this.units === 'imperial';
        const distance = imperial
            ? `${kmToMiles(point.distance).toFixed(2)} mi`
            : `${point.distance.toFixed(2)} km`;
        const elevation = imperial ? `${Math.round(metersToFeet(point.ele))} ft` : `${Math.round(point.ele)} m`;

        const doc = this.ownerDocument;
        tooltip.innerHTML = '';
        const section = this.data ? GPXParser.findSectionAtDistance(this.data.waypoints, point.distance) : null;
        if (section) {
            const line = doc.createElement('div');
            line.className = 'tooltip-line';
            const strong = doc.createElement('strong');
            strong.textContent = section.name;
            line.appendChild(strong);
            tooltip.appendChild(line);
        }
        for (const text of [`Distance: ${distance}`, `Elevation: ${elevation}`]) {
            const line = doc.createElement('div');
            line.className = 'tooltip-line';
            line.textContent = text;
            tooltip.appendChild(line);
        }

        tooltip.style.left = `${(viewX / VIEW_WIDTH) * 100}%`;
        tooltip.style.top = '0';
        tooltip.classList.add('visible');
    }

    private hideTooltip(): void {
        const tooltip = this.root.querySelector('.tooltip');
        if (tooltip) tooltip.classList.remove('visible');
    }

    private showError(message: string): void {
        const container = this.root.querySelector('.container');
        if (!container) return;
        container.innerHTML = '<div class="error"></div>';
        const error = container.querySelector('.error');
        if (error) error.textContent = `Error: ${message}`;
    }
}

defineOnce('ring-elevation-profile', RingElevationProfile);
