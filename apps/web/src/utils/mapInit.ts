import mapboxgl from "mapbox-gl";
const { Map, GeolocateControl, Popup } = mapboxgl;
import { MapboxSearchBox } from "@mapbox/search-js-web";

export function initializeMap(container, accessToken, config, onLoadCallback) {
  const map = new Map({
    container: container,
    accessToken: accessToken,
    center: [config.lng, config.lat],
    zoom: config.zoom,
    style: "mapbox://styles/mapbox/satellite-streets-v12",
    projection: "globe",
  });

  const search = new MapboxSearchBox();
  search.accessToken = accessToken;
  map.addControl(search);

  map.addControl(
    new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserHeading: true,
    }),
  );

  map.on("style.load", () => {
    map.setFog({
      color: "rgb(186, 210, 235)",
      "high-color": "rgb(36, 92, 92)",
      "horizon-blend": 0.02,
      "space-color": "rgb(17, 24, 39)",
      "star-intensity": 0.6,
    });
  });

  map.on("load", () => {
    onLoadCallback(map);
  });

  return map;
}
