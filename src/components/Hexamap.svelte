<script lang="ts">
  import { onMount } from 'svelte';
  import mapboxgl from 'mapbox-gl';
  import * as h3 from 'h3-js';

  let map: mapboxgl.Map;
  let mapContainer: HTMLElement;

  const config = {
    lng: 13.7496496,
    lat: 42.8917571,
    zoom: 0
  };

  let hexagonData = {};

  onMount(() => {
    const accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? '';
    if (!accessToken) {
      console.error('[Hexamap] VITE_MAPBOX_TOKEN is not set');
      return;
    }
    mapboxgl.accessToken = accessToken;

    map = new mapboxgl.Map({
      container: mapContainer,
      center: [config.lng, config.lat],
      zoom: (config.zoom + 2),
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      projection: 'globe'
    });

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6
      });
    });

    map.on('load', function () {
      renderHexes(map);
      ["zoomend", "dragend", "resize", "move"].forEach(event => {
        map.on(event, () => renderHexes(map));
      });

      map.addSource('h3-hex-areas', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      });

      map.addLayer({
        id: 'highlighted-hex',
        type: 'fill',
        source: 'h3-hex-areas',
        paint: {
          'fill-color': 'red',
          'fill-opacity': 0.6,
          'fill-outline-color': 'rgba(255, 0, 0, 1)'
        }
      });
    });

    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
        },
        trackUserLocation: true,
        showUserHeading: true
      })
    );

    map.on('click', (e) => {
      const clickedHex = h3.latLngToCell(e.lngLat.lat, e.lngLat.lng, getResolution(map.getZoom()));
      new mapboxgl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(clickedHex)
        .addTo(map);

      highlightHexagon(map, clickedHex);
      sendHex(clickedHex);
    });
  });

  function sendHex(hex) {
    // Implement Telegram.WebApp.sendData here if needed
    console.log('Sending hex:', hex);
  }

  function highlightHexagon(map, hex) {
    const kRing = h3.gridDisk(hex, 3);
    let hexagons = kRing.reduce((res, hexagon) => ({ ...res, [hexagon]: Math.random() }), {});

    const hexBoundary = h3.cellToBoundary(hex, true);

    let coordinates = hexBoundary.map(point => [point[1], point[0]]);
    coordinates.push(coordinates[0]); // Close the polygon

    const hexGeoJson = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates]
      }
    };

    map.getSource('h3-hex-areas').setData({
      type: 'FeatureCollection',
      features: [hexGeoJson]
    });
  }

  function getResolution(zoom) {
    const zoomToRes = [
      [3.0, 0], [4.4, 1], [5.7, 2], [7.1, 3], [8.4, 4],
      [9.8, 5], [11.4, 6], [12.7, 7], [14.1, 8], [15.5, 9],
      [16.8, 10], [18.2, 11], [19.5, 12], [21.1, 13], [21.9, 14]
    ];

    for (let [z, res] of zoomToRes) {
      if (zoom <= z) return res;
    }
    return 15;
  }

  // Add the following functions from index.html
  function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  function highlightNearbyHexagons(map, hex) {
    const kRing = h3.gridDisk(hex, 1);
    // Reduce hexagon list to a map with random values
    let hexagons = kRing.reduce((res, hexagon) => ({ ...res, [hexagon]: Math.random() }), {});
    console.log(hexagons);
    kRing.forEach(hexID => {
      hexagonData[hexID] = {
        height: Math.random() * 6500, // maxHeight is the maximum height you want
        color: getRandomColor() // A function to generate random colors
      };
    });
    // Further implementation if needed
  }

  function renderHexes(map: mapboxgl.Map): void {
    const latitudeMax = 90;
    const latitudeMin = -latitudeMax;
    const longitudeMax = 180;
    const longitudeMin = -longitudeMax;

    const extraFillArea = 0.5;
    const borderLayerName = 'hex-layer-border';
    const hexSourceName = 'hex-source';

    const currentZoom = map.getZoom();
    const h3res = getResolution(currentZoom);
    console.log("Resolution: " + JSON.stringify(h3res));

    // Check if we're in browser environment before accessing window
    if (typeof window === 'undefined') return;
    
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    const cUL = map.unproject([0, 0]).toArray(); // Upper left
    const cLR = map.unproject([iw, ih]).toArray(); // Lower right
    const x1 = Math.min(cUL[0], cLR[0]);
    const x2 = Math.max(cUL[0], cLR[0]);
    const y1 = Math.min(cUL[1], cLR[1]);
    const y2 = Math.max(cUL[1], cLR[1]);
    const dh = x2 - x1;
    const dv = y2 - y1;
    console.log(`REAL Coordinates x1:${x1} x2:${x2} y1:${y1} y2:${y2} dh:${dh} dv:${dv}`);

    let x1withBuffer = x1 - dh * extraFillArea;
    let x2withBuffer = x2 + dh * extraFillArea;
    let y1withBuffer = y1 - dv * extraFillArea;
    let y2withBuffer = y2 + dv * extraFillArea;
    let fullX = x1withBuffer < longitudeMin || x2withBuffer > longitudeMax;

    x1withBuffer = Math.max(x1withBuffer, longitudeMin);
    x2withBuffer = Math.min(x2withBuffer, longitudeMax);
    y1withBuffer = Math.max(y1withBuffer, latitudeMin);
    y2withBuffer = Math.min(y2withBuffer, latitudeMax);
    console.log(`BUFF Coordinates x1:${x1withBuffer} x2:${x2withBuffer} y1:${y1withBuffer} y2:${y2withBuffer} fullView:${fullX}`);

    let coordinates = [];
    if (fullX) {
      coordinates.push([
        [latitudeMin, longitudeMin],
        [latitudeMin, 0],
        [latitudeMax, 0],
        [latitudeMax, longitudeMin]
      ]);

      coordinates.push([
        [latitudeMin, 0],
        [latitudeMin, longitudeMax],
        [latitudeMax, longitudeMax],
        [latitudeMax, 0]
      ]);
    } else {
      const xIncrement = 180;
      let lowerX = x1withBuffer;
      while (lowerX < longitudeMax && lowerX < x2withBuffer) {
        const upperX = Math.min(lowerX + xIncrement, x2withBuffer, 180);
        coordinates.push([[
          [y2withBuffer, lowerX],
          [y2withBuffer, upperX],
          [y1withBuffer, upperX],
          [y1withBuffer, lowerX]
        ]]);
        console.log(`PUSH Coordinates x1:${lowerX} x2:${upperX} y1:${y1withBuffer} y2:${y2withBuffer}`);
        lowerX += xIncrement;
      }
    }

    const shapes = [].concat(...coordinates.map(e => h3.polygonToCells(e, h3res)));
    const innershapes = [].concat(...coordinates.map(e => h3.polygonToCells(e, h3res + 1)));
    const hexBoundaries: any[] = [];
    const pentaBoundaries: any[] = [];
    const innerBoundaries: any[] = [];

    for (let i = 0; i < shapes.length; i++) {
      let h = h3.cellToBoundary(shapes[i], true);
      if (h.find((e) => e[0] < -128) !== undefined) {
        h = h.map((e) => e[0] > 0 ? [e[0] - 360, e[1]] : e);
      }

      if (h3.isPentagon(shapes[i])) {
        pentaBoundaries.push(h);
      } else {
        hexBoundaries.push(h);
      }
    }
    for (let i = 0; i < innershapes.length; i++) {
      let h = h3.cellToBoundary(innershapes[i], true);
      if (h.find((e) => e[0] < -128) !== undefined) {
        h = h.map((e) => e[0] > 0 ? [e[0] - 360, e[1]] : e);
      }
      innerBoundaries.push(h);
    }

    console.log(`currentZoom: ${currentZoom}, resolution: ${h3res}, shapes: ${hexBoundaries.length}`);

    const featureCollection = {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "properties": { 'color': 'gray' },
          "geometry": {
            "type": "Polygon",
            "coordinates": innerBoundaries
          }
        },
        {
          "type": "Feature",
          "properties": { 'color': 'white' },
          "geometry": {
            "type": "Polygon",
            "coordinates": hexBoundaries
          }
        },
        {
          "type": "Feature",
          "properties": { 'color': 'gray' },
          "geometry": {
            "type": "Polygon",
            "coordinates": pentaBoundaries
          }
        }
      ]
    };

    const hexSource = map.getSource(hexSourceName);
    if (hexSource !== undefined) {
      (hexSource as any).setData(featureCollection);
    } else {
      const hexGeoJson = {
        type: 'geojson',
        data: featureCollection,
      };
      map.addSource(hexSourceName, hexGeoJson);
      map.addLayer({
        'id': borderLayerName,
        'source': hexSourceName,
        'type': 'line',
        'layout': {},
        'paint': {
          'line-color': ['get', 'color'],
          'line-width': 2
        }
      });
    }
  }
</script>

<div bind:this={mapContainer} id="map"></div>

<style>
  #map {
    width: 100%;
    height: 100vh;
  }

  :global(body) {
    margin: 0;
    padding: 0;
  }
</style>
