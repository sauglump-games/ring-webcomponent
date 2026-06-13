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
const GRAPH_TOP = PADDING.top;
const GRAPH_BOTTOM = PADDING.top + GRAPH_HEIGHT;
const GRAPH_LEFT = PADDING.left;
const GRAPH_RIGHT = PADDING.left + GRAPH_WIDTH;

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
  <div class="tooltip"></div>
  <div class="state loading">Loading elevation data…</div>
  <div class="state empty" hidden>No elevation data</div>
  <div class="state error" hidden></div>
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
    /** Monotonic id so a slow fetch can't overwrite a newer one (see #13). */
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
        } else if (this.data) {
            this.render();
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
            // A newer load started while we awaited — discard this stale result.
            if (token !== this.loadToken) return;
            this.loadFromString(text);
        } catch (error) {
            if (token !== this.loadToken) return;
            this.showError(error instanceof Error ? error.message : String(error));
        }
    }

    /** Parse a GPX string and render the profile. Useful for tests and inlined data. */
    loadFromString(gpxText: string): void {
        // Any direct load supersedes an in-flight fetch.
        this.loadToken++;
        try {
            this.data = GPXParser.parse(gpxText);
        } catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
            return;
        }
        this.render();
        emit(this, 'profile-ready', {
            trackData: this.data,
            empty: this.data.trackPoints.length === 0,
        });
    }

    /** Render the current data: profile when present, empty state otherwise. */
    private render(): void {
        if (this.data && this.data.trackPoints.length > 0) {
            this.renderProfile();
        } else {
            this.setState('empty');
        }
    }

    private renderProfile(): void {
        if (!this.data || this.data.trackPoints.length === 0) return;

        const container = this.root.querySelector('.container');
        if (!container) return;

        // A fresh render invalidates any visible tooltip (e.g. after a units
        // switch the old text would be wrong — #8).
        this.hideTooltip();
        this.hoveredPoint = null;

        this.setState('none');
        container.querySelector('svg')?.remove();

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

        const toX = (distance: number): number => GRAPH_LEFT + (distance / maxDistance) * GRAPH_WIDTH;
        const toY = (ele: number): number => GRAPH_BOTTOM - ((ele - minEle) / eleRange) * GRAPH_HEIGHT;

        if (boolAttr(this, 'show-grid')) {
            this.drawGrid(svg);
        }

        const linePoints = trackPoints.map((p) => `${toX(p.distance)} ${toY(p.ele)}`);
        const lineD = `M ${linePoints.join(' L ')}`;
        const areaD = `M ${GRAPH_LEFT} ${GRAPH_BOTTOM} L ${linePoints.join(' L ')} L ${GRAPH_RIGHT} ${GRAPH_BOTTOM} Z`;

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
            const y = GRAPH_TOP + (GRAPH_HEIGHT / eleSteps) * i;
            svg.appendChild(
                createSVGElement(doc, 'line', {
                    class: 'grid-line',
                    x1: GRAPH_LEFT,
                    y1: y,
                    x2: GRAPH_RIGHT,
                    y2: y,
                })
            );
        }
        const distSteps = 10;
        for (let i = 0; i <= distSteps; i++) {
            const x = GRAPH_LEFT + (GRAPH_WIDTH / distSteps) * i;
            svg.appendChild(
                createSVGElement(doc, 'line', {
                    class: 'grid-line',
                    x1: x,
                    y1: GRAPH_TOP,
                    x2: x,
                    y2: GRAPH_BOTTOM,
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
            const x = GRAPH_LEFT + (GRAPH_WIDTH / distSteps) * i;
            const label = createSVGElement(doc, 'text', {
                class: 'axis-label',
                'data-axis': 'x',
                x,
                y: GRAPH_BOTTOM + 20,
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
            const y = GRAPH_BOTTOM - (GRAPH_HEIGHT / eleSteps) * i;
            const label = createSVGElement(doc, 'text', {
                class: 'axis-label',
                'data-axis': 'y',
                x: GRAPH_LEFT - 10,
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
     * Map a client position to viewBox coordinates, honouring the letterbox
     * `preserveAspectRatio="xMidYMid meet"` introduces (#1). Uses the SVG's
     * screen CTM when available; falls back to the element rect (jsdom has no
     * layout and no CTM, so client coordinates map 1:1 to the viewBox).
     */
    private toViewPoint(event: MouseEvent): { x: number; y: number } {
        const svg = this.root.querySelector('svg') as SVGSVGElement | null;
        if (!svg) return { x: 0, y: 0 };

        try {
            const ctm = svg.getScreenCTM?.();
            if (ctm && typeof svg.createSVGPoint === 'function') {
                const pt = svg.createSVGPoint();
                pt.x = event.clientX;
                pt.y = event.clientY;
                const local = pt.matrixTransform(ctm.inverse());
                return { x: local.x, y: local.y };
            }
        } catch {
            /* fall through to the rect-based fallback */
        }

        const rect = svg.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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

        const { x: viewX, y: viewY } = this.toViewPoint(event);
        // Reject the pointer when it's outside the plotted area on either axis
        // (the x-axis labels and margins must not produce hover events — #5).
        if (viewX < GRAPH_LEFT || viewX > GRAPH_RIGHT || viewY < GRAPH_TOP || viewY > GRAPH_BOTTOM) {
            this.hideTooltip();
            this.hoveredPoint = null;
            return;
        }

        const { trackPoints } = this.data;
        const maxDistance = trackPoints[trackPoints.length - 1].distance;
        const distance = clamp(((viewX - GRAPH_LEFT) / GRAPH_WIDTH) * maxDistance, 0, maxDistance);
        const point = this.pointAtDistance(distance);

        this.hoveredPoint = point;
        this.showTooltip(point, event);
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

    private showTooltip(point: TrackPoint, event: MouseEvent): void {
        const tooltip = this.root.querySelector<HTMLElement>('.tooltip');
        const container = this.root.querySelector('.container');
        if (!tooltip || !container) return;

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

        tooltip.classList.add('visible');
        this.positionTooltip(tooltip, container, event);
    }

    /** Place the tooltip near the cursor, kept within the container (#6). */
    private positionTooltip(tooltip: HTMLElement, container: Element, event: MouseEvent): void {
        const cRect = container.getBoundingClientRect();
        const tRect = tooltip.getBoundingClientRect();
        const cursorX = event.clientX - cRect.left;
        const cursorY = event.clientY - cRect.top;

        let left = cursorX + 12;
        if (cRect.width > 0 && left + tRect.width > cRect.width) {
            left = cursorX - tRect.width - 12;
        }
        let top = cursorY - tRect.height - 12;
        if (top < 0) top = cursorY + 12;

        tooltip.style.left = `${Math.max(0, left)}px`;
        tooltip.style.top = `${Math.max(0, top)}px`;
    }

    private hideTooltip(): void {
        const tooltip = this.root.querySelector('.tooltip');
        if (tooltip) tooltip.classList.remove('visible');
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
        // Keep the structural nodes (tooltip, svg slot) intact — only toggle the
        // overlay — so recovery to a good load isn't broken (#2, #3).
        this.root.querySelector('.container svg')?.remove();
        this.hideTooltip();
        this.setState('error', message);
    }
}

defineOnce('ring-elevation-profile', RingElevationProfile);
