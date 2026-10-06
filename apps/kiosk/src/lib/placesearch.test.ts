// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The geocoder behind the search boxes: what a query asks for, and how its
// answer reads as rows.
import { describe, expect, it } from "vitest";
import { parsePlaces, placesUrl } from "./placesearch";

describe("placesUrl", () => {
  it("encodes the query and carries the token and the limit", () => {
    const url = new URL(placesUrl(" Via Roma 1, Bologna ", "tok"));
    expect(url.pathname).toBe(
      "/geocoding/v5/mapbox.places/Via%20Roma%201%2C%20Bologna.json",
    );
    expect(url.searchParams.get("access_token")).toBe("tok");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.has("types")).toBe(false);
    expect(url.searchParams.has("proximity")).toBe(false);
  });

  it("biases toward the map's centre, lng first", () => {
    const url = new URL(
      placesUrl("roma", "tok", {
        proximity: { lat: 44.5, lng: 11.3 },
        language: "it",
        types: "place,locality",
        limit: 3,
      }),
    );
    expect(url.searchParams.get("proximity")).toBe("11.3,44.5");
    expect(url.searchParams.get("language")).toBe("it");
    expect(url.searchParams.get("types")).toBe("place,locality");
    expect(url.searchParams.get("limit")).toBe("3");
  });

  it("leaves a centre that is not a number out", () => {
    const url = new URL(
      placesUrl("roma", "tok", { proximity: { lat: NaN, lng: 11.3 } }),
    );
    expect(url.searchParams.has("proximity")).toBe(false);
  });
});

describe("parsePlaces", () => {
  it("reads name, context, centre and extent off a feature", () => {
    expect(
      parsePlaces({
        features: [
          {
            id: "place.1",
            text: "Bologna",
            place_name: "Bologna, Emilia-Romagna, Italy",
            center: [11.34, 44.49],
            bbox: [11.2, 44.4, 11.4, 44.6],
          },
        ],
      }),
    ).toEqual([
      {
        id: "place.1",
        name: "Bologna",
        context: "Emilia-Romagna, Italy",
        label: "Bologna, Emilia-Romagna, Italy",
        lat: 44.49,
        lng: 11.34,
        bbox: [11.2, 44.4, 11.4, 44.6],
      },
    ]);
  });

  it("gives a place with no parent an empty context and no extent", () => {
    const [hit] = parsePlaces({
      features: [{ id: "country.1", text: "Italy", center: [12.5, 42.8] }],
    });
    expect(hit).toMatchObject({ name: "Italy", context: "", label: "Italy" });
    expect(hit.bbox).toBeUndefined();
  });

  it("drops features with no usable centre, and tolerates junk", () => {
    expect(
      parsePlaces({
        features: [
          { id: "a", text: "Nowhere" },
          { id: "b", text: "Half", center: [11, null] },
          null,
        ],
      }),
    ).toEqual([]);
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces({ message: "Not Authorized" })).toEqual([]);
  });
});
