/**
 * Mathematical utilities for GPS and elevation calculations.
 */

/** A point on the earth's surface in decimal degrees. */
export interface GeoPoint {
    lat: number;
    lon: number;
}

/** Bounding box of a set of GPS coordinates. */
export interface Bounds {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
}

const EARTH_RADIUS_KM = 6371;

/** Convert degrees to radians. */
export function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/** Convert radians to degrees. */
export function toDegrees(radians: number): number {
    return radians * (180 / Math.PI);
}

/**
 * Distance between two GPS points using the Haversine formula.
 * @returns Distance in kilometers
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
}

/**
 * Gradient between two elevations over a distance.
 * @param ele1 - Elevation of first point (meters)
 * @param ele2 - Elevation of second point (meters)
 * @param distance - Distance between points (kilometers)
 * @returns Gradient as a percentage (positive uphill, negative downhill)
 */
export function calculateGradient(ele1: number, ele2: number, distance: number): number {
    if (distance === 0) return 0;
    return ((ele2 - ele1) / (distance * 1000)) * 100;
}

/** Bounding box for a set of GPS coordinates; all-zero for an empty set. */
export function calculateBounds(points: readonly GeoPoint[]): Bounds {
    if (points.length === 0) {
        return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    for (const p of points) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
    }

    return { minLat, maxLat, minLon, maxLon };
}

/** Linear interpolation between two values, t in [0, 1]. */
export function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Convert meters to feet. */
export function metersToFeet(meters: number): number {
    return meters * 3.28084;
}

/** Convert kilometers to miles. */
export function kmToMiles(km: number): number {
    return km * 0.621371;
}
