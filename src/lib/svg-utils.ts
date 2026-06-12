/**
 * SVG utilities: GPS → SVG coordinate projection, path generation, and
 * section slicing along the track.
 */

import { calculateBounds } from './math-utils.js';
import type { TrackPoint, SectionWaypoint } from './gpx-parser.js';

/** A projected SVG coordinate carrying its source track point. */
export interface SVGCoordinate {
    x: number;
    y: number;
    original: TrackPoint;
}

/** A section enriched with its track points and pre-built SVG path. */
export interface TrackSection extends SectionWaypoint {
    points: TrackPoint[];
    coordinates: SVGCoordinate[];
    path: string;
}

/**
 * Project GPS coordinates into an SVG viewport, preserving aspect ratio and
 * centering the track. The Y axis is flipped (north = up).
 */
export function gpsToSVG(
    trackPoints: readonly TrackPoint[],
    svgWidth: number,
    svgHeight: number,
    padding = 20
): SVGCoordinate[] {
    if (trackPoints.length === 0) return [];

    const bounds = calculateBounds(trackPoints);
    const width = svgWidth - 2 * padding;
    const height = svgHeight - 2 * padding;

    const lonRange = bounds.maxLon - bounds.minLon;
    const latRange = bounds.maxLat - bounds.minLat;

    const scale = Math.min(width / lonRange, height / latRange);

    const centerOffsetX = (width - lonRange * scale) / 2;
    const centerOffsetY = (height - latRange * scale) / 2;

    return trackPoints.map((point) => ({
        x: padding + centerOffsetX + (point.lon - bounds.minLon) * scale,
        y: padding + centerOffsetY + (bounds.maxLat - point.lat) * scale,
        original: point,
    }));
}

/**
 * Generate an SVG path `d` attribute from coordinates. With `smooth`,
 * quadratic Bézier curves through the midpoints are used.
 */
export function generatePath(coordinates: readonly { x: number; y: number }[], smooth = true): string {
    if (coordinates.length === 0) return '';
    if (coordinates.length === 1) {
        return `M ${coordinates[0].x} ${coordinates[0].y}`;
    }

    if (!smooth) {
        return coordinates
            .map((coord, i) => (i === 0 ? `M ${coord.x} ${coord.y}` : `L ${coord.x} ${coord.y}`))
            .join(' ');
    }

    let path = `M ${coordinates[0].x} ${coordinates[0].y}`;
    for (let i = 1; i < coordinates.length - 1; i++) {
        const current = coordinates[i];
        const next = coordinates[i + 1];
        path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
    }
    const last = coordinates[coordinates.length - 1];
    path += ` L ${last.x} ${last.y}`;

    return path;
}

/**
 * Slice the track into sections: each waypoint's `startKm`–`endKm` range
 * selects the track points (and their projected coordinates) it covers.
 */
export function createSections(
    waypoints: readonly SectionWaypoint[],
    svgCoordinates: readonly SVGCoordinate[],
    trackPoints: readonly TrackPoint[]
): TrackSection[] {
    return waypoints.map((waypoint) => {
        const points: TrackPoint[] = [];
        const coordinates: SVGCoordinate[] = [];

        trackPoints.forEach((point, idx) => {
            if (point.distance >= waypoint.startKm && point.distance <= waypoint.endKm) {
                points.push(point);
                coordinates.push(svgCoordinates[idx]);
            }
        });

        return { ...waypoint, points, coordinates, path: generatePath(coordinates, true) };
    });
}

/** Result of a nearest-point search against projected coordinates. */
export interface ClosestPoint {
    index: number;
    distance: number;
    point: SVGCoordinate;
}

/** Find the projected coordinate closest to an (x, y) position. */
export function findClosestPoint(
    x: number,
    y: number,
    coordinates: readonly SVGCoordinate[]
): ClosestPoint | null {
    if (coordinates.length === 0) return null;

    let closestIndex = 0;
    let minDistance = Infinity;

    coordinates.forEach((coord, idx) => {
        const dx = x - coord.x;
        const dy = y - coord.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = idx;
        }
    });

    return { index: closestIndex, distance: minDistance, point: coordinates[closestIndex] };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create a namespaced SVG element with attributes. */
export function createSVGElement<K extends keyof SVGElementTagNameMap>(
    doc: Document,
    tag: K,
    attributes: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
    const element = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) {
        element.setAttribute(key, String(value));
    }
    return element;
}
