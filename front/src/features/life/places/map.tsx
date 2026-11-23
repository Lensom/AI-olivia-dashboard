"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, GeoJSON as GeoJSONLayer } from "leaflet";
import { codeOfShape } from "./countries";

export type MapPlace = {
  id: string;
  name: string;
  location: string;
  visited: boolean;
  lat: number;
  lon: number;
  image: string;
  emoji: string;
};

type Labels = { visited: string; planned: string; edit: string };

const VISITED = "#10b981";
const PLANNED = "#d97706";

/** The popup is built from DOM nodes, not an HTML string: names are your own text and must never run as markup. */
function popupFor(p: MapPlace, labels: Labels, onEdit: (id: string) => void): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = "width:200px;font-family:inherit";
  if (p.image) {
    const img = document.createElement("img");
    img.src = p.image;
    img.alt = "";
    img.style.cssText = "width:100%;height:110px;object-fit:cover;border-radius:8px;display:block;margin-bottom:6px";
    box.append(img);
  }
  const name = document.createElement("div");
  name.textContent = `${p.emoji} ${p.name}`;
  name.style.cssText = "font-weight:600;font-size:13px;line-height:1.3;color:#1f1c17";
  const where = document.createElement("div");
  where.textContent = p.location;
  where.style.cssText = "font-size:11px;color:#6f675b;margin-top:2px";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:6px";
  const status = document.createElement("span");
  status.textContent = p.visited ? `✓ ${labels.visited}` : labels.planned;
  status.style.cssText = `font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;${p.visited ? "background:#d1fae5;color:#065f46" : "background:#fef3c7;color:#92400e"}`;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = labels.edit;
  edit.style.cssText = "margin-left:auto;font-size:11px;color:#6f675b;background:none;border:0;cursor:pointer;text-decoration:underline";
  edit.addEventListener("click", () => onEdit(p.id));
  row.append(status, edit);
  box.append(name, where, row);
  return box;
}

/**
 * Leaflet map: a dot per place (green been there, amber planned) over the countries you've been to, shaded.
 * Leaflet touches `window`, so it loads in the browser only, after the first render.
 */
export function PlacesMap({ places, countries, labels, onEdit }: { places: MapPlace[]; countries: string[]; labels: Labels; onEdit: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const dots = useRef<LayerGroup | null>(null);
  const shapes = useRef<GeoJSONLayer | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  // The latest props, for the async setup to draw with once Leaflet has loaded.
  const latest = useRef({ places, countries, labels, onEdit });
  useEffect(() => {
    latest.current = { places, countries, labels, onEdit };
  });

  const drawDots = () => {
    const L = lib.current;
    if (!L || !map.current || !dots.current) return;
    const { places: ps, labels: ls, onEdit: edit } = latest.current;
    dots.current.clearLayers();
    // Plans first, so the green ones sit on top where they overlap.
    for (const p of [...ps].sort((a, b) => Number(a.visited) - Number(b.visited))) {
      L.circleMarker([p.lat, p.lon], { radius: 7, color: "#ffffff", weight: 2, fillColor: p.visited ? VISITED : PLANNED, fillOpacity: 0.95 })
        .bindTooltip(p.name, { direction: "top", offset: [0, -6] })
        .bindPopup(() => popupFor(p, ls, edit), { minWidth: 200, maxWidth: 220 })
        .addTo(dots.current);
    }
    if (!fitted.current && ps.length) {
      map.current.fitBounds(L.latLngBounds(ps.map((p) => [p.lat, p.lon] as [number, number])), { padding: [30, 30], maxZoom: 5 });
      fitted.current = true;
    }
  };

  const paintCountries = () => {
    if (!shapes.current) return;
    const been = new Set(latest.current.countries);
    shapes.current.setStyle((f) => {
      const code = codeOfShape(f?.id, f?.properties?.name);
      return code && been.has(code)
        ? { fillColor: VISITED, fillOpacity: 0.28, color: VISITED, weight: 0.8, opacity: 0.6 }
        : { fillOpacity: 0, weight: 0, opacity: 0 };
    });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!alive || !box.current || map.current) return;
      lib.current = L;
      const m = L.map(box.current, { worldCopyJump: true, minZoom: 2, zoomControl: true }).setView([30, 10], 2);
      // OpenStreetMap's own tiles: no key, fine for personal use, credit required.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(m);
      map.current = m;
      dots.current = L.layerGroup().addTo(m);
      drawDots();
      // Country shapes (108 KB) come after the map is up.
      const [{ feature }, world] = await Promise.all([import("topojson-client"), import("world-atlas/countries-110m.json")]);
      if (!alive) return;
      const topo = (world as { default?: unknown }).default ?? world;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- world-atlas ships untyped TopoJSON
      const geo = feature(topo as any, (topo as any).objects.countries);
      shapes.current = L.geoJSON(geo as never, { interactive: false }).addTo(m);
      shapes.current.bringToBack();
      paintCountries();
    })();
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
      dots.current = null;
      shapes.current = null;
      fitted.current = false;
    };
    // Set up once; the effects below redraw on changes.
  }, []);

  useEffect(drawDots, [places, labels, onEdit]);
  useEffect(paintCountries, [countries]);

  return <div ref={box} className="relative z-0 h-[65vh] min-h-[380px] w-full overflow-hidden rounded-2xl border border-black/5 bg-[#e9e4d8]" />;
}
