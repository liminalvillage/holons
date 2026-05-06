export function getHoloSphereName() {
    return import.meta.env.MODE === 'production' ? 'Holosphere' : 'HolosphereDebug';
}