export function getRandomColor() {
    const letters = "0123456789ABCDEF";
    let color = "#";
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

export function getResolution(zoom: number): number {
    const zoomToRes: [number, number][] = [
        [3.0, 0],
        [4.4, 1],
        [5.7, 2],
        [7.1, 3],
        [8.4, 4],
        [9.8, 5],
        [11.4, 6],
        [12.7, 7],
        [14.1, 8],
        [15.5, 9],
        [16.8, 10],
        [18.2, 11],
        [19.5, 12],
        [21.1, 13],
        [21.9, 14],
    ];

    for (const [z, res] of zoomToRes) {
        if (zoom <= z) return res;
    }
    return 15;
}

export function getZoom(resolution: number): number {
    const resToZoom: [number, number][] = [
        [0, 3.0],
        [1, 4.4],
        [2, 5.7],
        [3, 7.1],
        [4, 8.4],
        [5, 9.8],
        [6, 11.4],
        [7, 12.7],
        [8, 14.1],
        [9, 15.5],
        [10, 16.8],
        [11, 18.2],
        [12, 19.5],
        [13, 21.1],
        [14, 21.9],
    ];

    for (const [res, z] of resToZoom) {
        if (resolution === res) return z;
    }
    return 21.9;
}

// Add other utility functions as needed
