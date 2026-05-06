declare module 'lune' {
    export function phase(date: Date): {
        phase: number;
        illuminated: number;
        age: number;
        distance: number;
        angular_diameter: number;
        sun_distance: number;
        sun_angular_diameter: number;
    };
} 