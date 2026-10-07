/**
 * Web stand-in for react-native-maps, built on Leaflet + OpenStreetMap
 * tiles (free, no API key). metro.config.js points `react-native-maps` here
 * for web builds only; Android/iOS keep using the real library.
 *
 * Covers the part of the API ConVía uses: MapView (initialRegion, onPress,
 * onRegionChangeComplete, showsUserLocation, showsMyLocationButton, ref
 * methods animateToRegion / fitToCoordinates), Marker (custom children,
 * title/description, onPress, draggable/onDragEnd) and Polyline.
 */
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  createContext,
  forwardRef,
  ReactNode,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { StyleProp, View, ViewStyle } from 'react-native';

export type LatLng = { latitude: number; longitude: number };
export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };
type EdgePadding = { top: number; right: number; bottom: number; left: number };
type PressEvent = { nativeEvent: { coordinate: LatLng; action?: string } };

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = undefined;

const MapContext = createContext<L.Map | null>(null);

// OpenStreetMap's own tiles: free, no API key (CARTO's now require one). Attribution is mandatory.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const toLatLng = (point: LatLng) => L.latLng(point.latitude, point.longitude);
const fromLatLng = (point: L.LatLng): LatLng => ({ latitude: point.lat, longitude: point.lng });
const regionBounds = (region: Region) =>
  L.latLngBounds(
    [region.latitude - region.latitudeDelta / 2, region.longitude - region.longitudeDelta / 2],
    [region.latitude + region.latitudeDelta / 2, region.longitude + region.longitudeDelta / 2],
  );
function currentRegion(map: L.Map): Region {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
    longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest()),
  };
}

const STYLE_ID = 'convia-map-web-style';
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .convia-marker{background:none;border:0}
    .convia-marker-inner{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex}
    .convia-marker-inner.center{transform:translate(-50%,-50%)}
    .convia-me{width:16px;height:16px;border-radius:50%;background:#006FFD;border:3px solid #fff;box-shadow:0 0 0 6px rgba(0,111,253,.2)}
    .convia-locate{width:40px;height:40px;border-radius:20px;border:0;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer;display:grid;place-items:center}
    .convia-locate svg{width:20px;height:20px}
    .leaflet-container{font-family:inherit;background:#E8E9F1}
  `;
  document.head.appendChild(style);
}

export type MapViewProps = {
  initialRegion?: Region;
  region?: Region;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  onPress?: (event: PressEvent) => void;
  onRegionChangeComplete?: (region: Region) => void;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  scrollEnabled?: boolean;
  zoomEnabled?: boolean;
  accessibilityLabel?: string;
  mapPadding?: Partial<EdgePadding>;
};

export type MapViewHandle = {
  animateToRegion(region: Region, duration?: number): void;
  fitToCoordinates(coordinates: LatLng[], options?: { edgePadding?: Partial<EdgePadding>; animated?: boolean }): void;
};

function locateMe(map: L.Map, fly: boolean, onPosition: (point: L.LatLng) => void) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const point = L.latLng(position.coords.latitude, position.coords.longitude);
      onPosition(point);
      if (fly) map.flyTo(point, Math.max(map.getZoom(), 15), { duration: 0.6 });
    },
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
  );
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const { initialRegion, region, style, children, showsUserLocation, showsMyLocationButton, accessibilityLabel } = props;
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const handlers = useRef(props);
  useLayoutEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    if (!container.current) return undefined;
    injectStyles();
    const instance = L.map(container.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: props.scrollEnabled !== false,
      scrollWheelZoom: props.zoomEnabled !== false,
    });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(instance);
    const start = region ?? initialRegion;
    if (start) instance.fitBounds(regionBounds(start), { animate: false });
    else instance.setView([4.861, -74.032], 12); // Chía

    instance.on('click', (event: L.LeafletMouseEvent) => {
      handlers.current.onPress?.({ nativeEvent: { coordinate: fromLatLng(event.latlng), action: 'press' } });
    });
    instance.on('moveend', () => handlers.current.onRegionChangeComplete?.(currentRegion(instance)));

    // Maps inside modals mount before they have a size.
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    setMap(instance);
    return () => {
      observer.disconnect();
      instance.remove();
      setMap(null);
    };
    // The map is created once; later prop changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "My location" dot, shown only when the browser already has permission
  // (it is asked for elsewhere in the app, never just by opening a map).
  useEffect(() => {
    if (!map || !showsUserLocation) return undefined;
    let dot: L.Marker | null = null;
    const show = (point: L.LatLng) => {
      if (dot) dot.setLatLng(point);
      else dot = L.marker(point, { icon: L.divIcon({ className: 'convia-marker', html: '<div class="convia-me"></div>', iconSize: [16, 16] }), interactive: false, keyboard: false }).addTo(map);
    };
    let cancelled = false;
    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((status) => {
      if (!cancelled && status.state === 'granted') locateMe(map, false, show);
    }).catch(() => undefined);

    let control: L.Control | null = null;
    if (showsMyLocationButton) {
      const Locate = L.Control.extend({
        onAdd() {
          const button = L.DomUtil.create('button', 'convia-locate');
          button.type = 'button';
          button.setAttribute('aria-label', 'Ir a mi ubicación');
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#006FFD" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
          L.DomEvent.disableClickPropagation(button);
          L.DomEvent.on(button, 'click', () => locateMe(map, true, show));
          return button;
        },
      });
      control = new Locate({ position: 'bottomright' }).addTo(map);
    }
    return () => {
      cancelled = true;
      dot?.remove();
      control?.remove();
    };
  }, [map, showsUserLocation, showsMyLocationButton]);

  useEffect(() => {
    if (map && region) map.fitBounds(regionBounds(region));
  }, [map, region]);

  // Keep the map's own controls (location button, credits) clear of overlays, like native mapPadding.
  const padTop = props.mapPadding?.top ?? 0;
  const padBottom = props.mapPadding?.bottom ?? 0;
  useEffect(() => {
    if (!map) return;
    map.getContainer().querySelectorAll<HTMLElement>('.leaflet-top').forEach((corner) => { corner.style.top = `${padTop}px`; });
    map.getContainer().querySelectorAll<HTMLElement>('.leaflet-bottom').forEach((corner) => { corner.style.bottom = `${padBottom}px`; });
  }, [map, padTop, padBottom]);

  useImperativeHandle(ref, () => ({
    animateToRegion(target, duration = 500) {
      map?.flyToBounds(regionBounds(target), { duration: Math.max(0.1, duration / 1000) });
    },
    fitToCoordinates(coordinates, options) {
      if (!map || !coordinates.length) return;
      const pad = { top: 40, right: 40, bottom: 40, left: 40, ...options?.edgePadding };
      map.fitBounds(L.latLngBounds(coordinates.map(toLatLng)), {
        paddingTopLeft: [pad.left, pad.top],
        paddingBottomRight: [pad.right, pad.bottom],
        animate: options?.animated !== false,
        maxZoom: 17,
      });
    },
  }), [map]);

  return (
    <View accessibilityLabel={accessibilityLabel} style={[{ overflow: 'hidden' }, style]}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </View>
  );
});

export default MapView;

export type MarkerProps = {
  coordinate: LatLng;
  title?: string;
  description?: string;
  children?: ReactNode;
  onPress?: () => void;
  draggable?: boolean;
  onDragEnd?: (event: { nativeEvent: { coordinate: LatLng } }) => void;
  anchor?: { x: number; y: number };
};

export function Marker({ coordinate, title, description, children, onPress, draggable, onDragEnd, anchor }: MarkerProps) {
  const map = useContext(MapContext);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const handlers = useRef({ onPress, onDragEnd });
  useLayoutEffect(() => {
    handlers.current = { onPress, onDragEnd };
  });
  const centered = anchor ? anchor.y <= 0.5 : false;

  useEffect(() => {
    if (!map) return undefined;
    const icon = children
      ? L.divIcon({ className: 'convia-marker', html: `<div class="convia-marker-inner${centered ? ' center' : ''}"></div>`, iconSize: [0, 0] })
      : new L.Icon.Default();
    const instance = L.marker(toLatLng(coordinate), { icon, draggable: !!draggable, keyboard: !!onPress, title: title ?? '' }).addTo(map);
    instance.on('click', (event) => {
      L.DomEvent.stopPropagation(event);
      handlers.current.onPress?.();
    });
    instance.on('dragend', () => handlers.current.onDragEnd?.({ nativeEvent: { coordinate: fromLatLng(instance.getLatLng()) } }));
    marker.current = instance;
    setHost((instance.getElement()?.querySelector('.convia-marker-inner') as HTMLElement | null) ?? null);
    return () => {
      instance.remove();
      marker.current = null;
      setHost(null);
    };
    // Recreate only when the map or the kind of marker changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, !!children, !!draggable, centered]);

  const { latitude, longitude } = coordinate;
  useEffect(() => {
    marker.current?.setLatLng(L.latLng(latitude, longitude));
  }, [latitude, longitude]);

  useEffect(() => {
    const instance = marker.current;
    if (!instance) return;
    instance.unbindPopup();
    if (title && !onPress) {
      const body = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = title;
      body.appendChild(strong);
      if (description) {
        const detail = document.createElement('div');
        detail.textContent = description;
        detail.style.color = '#5B5F6E';
        body.appendChild(detail);
      }
      instance.bindPopup(body, { offset: [0, -24], closeButton: false });
    }
  }, [title, description, onPress, host]);

  return host && children ? createPortal(children, host) : null;
}

export type PolylineProps = {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: number[];
  tappable?: boolean;
  onPress?: () => void;
};

export function Polyline({ coordinates, strokeColor = '#006FFD', strokeWidth = 3, lineDashPattern, tappable, onPress }: PolylineProps) {
  const map = useContext(MapContext);
  const handler = useRef(onPress);
  useLayoutEffect(() => {
    handler.current = onPress;
  });
  const path = JSON.stringify(coordinates.map((point) => [point.latitude, point.longitude]));
  const dash = lineDashPattern?.join(' ');

  useEffect(() => {
    if (!map) return undefined;
    const line = L.polyline(JSON.parse(path) as [number, number][], {
      color: strokeColor,
      weight: strokeWidth,
      dashArray: dash,
      interactive: !!(tappable || onPress),
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    line.on('click', (event) => {
      L.DomEvent.stopPropagation(event);
      handler.current?.();
    });
    return () => {
      line.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, path, strokeColor, strokeWidth, dash, tappable]);

  return null;
}

export function Callout({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function Circle() {
  return null;
}
