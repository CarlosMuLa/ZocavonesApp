import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Crosshair, MapPin, Search } from 'lucide-react';
import { Toaster, sileo } from 'sileo';

import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select } from './components/ui/select';

// Fix Leaflet default marker icon URLs for Vite builds
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

const ZMG_CENTER = [20.67, -103.35];
const ZMG_BOUNDS = {
  minLat: 20.40,
  maxLat: 20.85,
  minLng: -103.60,
  maxLng: -103.15,
};

const MUNICIPIOS = [
  'Guadalajara',
  'Zapopan',
  'San Pedro Tlaquepaque',
  'Tonalá',
  'Tlajomulco de Zúñiga',
  'El Salto',
  'Otro',
];

const CAUSAS = [
  'Lluvia / Inundación',
  'Fuga o colapso de drenaje',
  'Fuga de agua potable',
  'Obra / Desconocida',
];

const TAMANOS = ['Pequeño (< 1 m)', 'Mediano (1–3 m)', 'Grande (> 3 m)'];

function isWithinBounds(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= ZMG_BOUNDS.minLat &&
    lat <= ZMG_BOUNDS.maxLat &&
    lng >= ZMG_BOUNDS.minLng &&
    lng <= ZMG_BOUNDS.maxLng
  );
}

function normalizeMunicipio(raw) {
  if (!raw) return 'Otro';
  const text = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (text.includes('guadalajara')) return 'Guadalajara';
  if (text.includes('zapopan')) return 'Zapopan';
  if (text.includes('tlaquepaque')) return 'San Pedro Tlaquepaque';
  if (text.includes('tonala')) return 'Tonalá';
  if (text.includes('tlajomulco')) return 'Tlajomulco de Zúñiga';
  if (text.includes('el salto')) return 'El Salto';
  return 'Otro';
}

export default function App() {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [latStr, setLatStr] = useState(ZMG_CENTER[0].toFixed(6));
  const [lngStr, setLngStr] = useState(ZMG_CENTER[1].toFixed(6));
  const [fechaIncidente, setFechaIncidente] = useState(todayIso);
  const [municipio, setMunicipio] = useState('');
  const [colonia, setColonia] = useState('');
  const [callePrincipal, setCallePrincipal] = useState('');
  const [cruces, setCruces] = useState('');
  const [causaAparente, setCausaAparente] = useState('');
  const [tamanoCategoria, setTamanoCategoria] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [turnstileSitekey, setTurnstileSitekey] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState(null);
  const turnstileWidgetIdRef = useRef(null);
  const turnstileContainerRef = useRef(null);

  const [duplicateRecord, setDuplicateRecord] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [summingDuplicate, setSummingDuplicate] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const reverseAbortRef = useRef(null);
  const searchAbortRef = useRef(null);
  const skipNextAutocompleteRef = useRef(false);
  const dupDialogRef = useRef(null);
  const wasInBoundsRef = useRef(true);

  const parsedLat = Number.parseFloat(latStr);
  const parsedLng = Number.parseFloat(lngStr);
  const inBounds = isWithinBounds(parsedLat, parsedLng);

  const reverseGeocode = useCallback((lat, lng) => {
    if (reverseAbortRef.current) {
      reverseAbortRef.current.abort();
    }
    const controller = new AbortController();
    reverseAbortRef.current = controller;

    const request = (async () => {
      try {
        const url = new URL('https://nominatim.openstreetmap.org/reverse');
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lng));
        url.searchParams.set('addressdetails', '1');
        url.searchParams.set('accept-language', 'es');

        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error('Nominatim respondió con error');
        }

        const data = await res.json();
        const addr = data.address || {};

        // Sobrescribir siempre automáticamente colonia, calle_principal y municipio
        setColonia(
          addr.suburb ||
            addr.neighbourhood ||
            addr.quarter ||
            addr.residential ||
            addr.village ||
            ''
        );
        setCallePrincipal(
          addr.road || addr.pedestrian || addr.footway || addr.path || ''
        );
        setMunicipio(
          normalizeMunicipio(
            addr.city || addr.town || addr.municipality || addr.county || ''
          )
        );
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
    })();

    sileo.promise(request, {
      loading: { title: 'Consultando dirección en Nominatim...' },
      success: { title: 'Dirección actualizada', duration: 1500 },
      error: {
        title: 'Sin respuesta de Nominatim',
        description: 'Puedes completar colonia, calle y municipio manualmente.',
        duration: 2500,
      },
    });
  }, []);

  const updatePinPosition = useCallback(
    (lat, lng, options = {}) => {
      const { panMap = false, zoom = null, runReverse = true } = options;
      const fixedLat = Number(lat.toFixed(6));
      const fixedLng = Number(lng.toFixed(6));

      setLatStr(fixedLat.toFixed(6));
      setLngStr(fixedLng.toFixed(6));

      if (markerRef.current) {
        markerRef.current.setLatLng([fixedLat, fixedLng]);
      }
      if (panMap && mapRef.current) {
        if (zoom !== null) {
          mapRef.current.setView([fixedLat, fixedLng], zoom);
        } else {
          mapRef.current.panTo([fixedLat, fixedLng]);
        }
      }

      const valid = isWithinBounds(fixedLat, fixedLng);
      if (!valid && wasInBoundsRef.current) {
        sileo.warning({
          title: 'Ubicación fuera de la ZMG',
          description: 'Mueve el pin dentro del área metropolitana para habilitar el envío.',
        });
      }
      wasInBoundsRef.current = valid;

      if (runReverse) {
        reverseGeocode(fixedLat, fixedLng);
      }
    },
    [reverseGeocode]
  );

  // Inicializar mapa Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const zmgLeafletBounds = L.latLngBounds(
      [ZMG_BOUNDS.minLat, ZMG_BOUNDS.minLng],
      [ZMG_BOUNDS.maxLat, ZMG_BOUNDS.maxLng]
    );

    const map = L.map(mapContainerRef.current, {
      center: ZMG_CENTER,
      zoom: 12,
      minZoom: 11,
      maxBounds: zmgLeafletBounds,
      maxBoundsViscosity: 1.0,
    });
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri',
      }
    ).addTo(map);

    L.rectangle(zmgLeafletBounds, {
      color: '#18181b',
      weight: 1.5,
      dashArray: '6 6',
      fillOpacity: 0.03,
      interactive: false,
    }).addTo(map);

    const marker = L.marker(ZMG_CENTER, { draggable: true }).addTo(map);

    map.on('click', (e) => {
      updatePinPosition(e.latlng.lat, e.latlng.lng);
    });

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      updatePinPosition(pos.lat, pos.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    reverseGeocode(ZMG_CENTER[0], ZMG_CENTER[1]);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [reverseGeocode, updatePinPosition]);

  // Cargar configuración de Turnstile desde la API
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/config`)
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (active && cfg?.turnstileSitekey) {
          setTurnstileSitekey(cfg.turnstileSitekey);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Renderizar widget Turnstile cuando exista sitekey
  useEffect(() => {
    if (!turnstileSitekey || !turnstileContainerRef.current) return;

    let timerId;
    const tryRender = () => {
      if (!window.turnstile) {
        timerId = setTimeout(tryRender, 200);
        return;
      }
      if (turnstileWidgetIdRef.current !== null) return;
      turnstileWidgetIdRef.current = window.turnstile.render(
        turnstileContainerRef.current,
        {
          sitekey: turnstileSitekey,
          callback: (token) => setTurnstileToken(token),
          'expired-callback': () => setTurnstileToken(null),
        }
      );
    };
    tryRender();

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [turnstileSitekey]);

  // Sincronizar diálogo nativo de duplicados
  useEffect(() => {
    const dialog = dupDialogRef.current;
    if (!dialog) return;
    if (duplicateRecord && !dialog.open) {
      dialog.showModal();
    } else if (!duplicateRecord && dialog.open) {
      dialog.close();
    }
  }, [duplicateRecord]);

  function handleManualCoordsBlur() {
    const lat = Number.parseFloat(latStr);
    const lng = Number.parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (markerRef.current) markerRef.current.setLatLng([lat, lng]);
    if (mapRef.current) mapRef.current.panTo([lat, lng]);

    const valid = isWithinBounds(lat, lng);
    if (!valid && wasInBoundsRef.current) {
      sileo.warning({
        title: 'Ubicación fuera de la ZMG',
        description: 'Las coordenadas deben estar dentro de la Zona Metropolitana de Guadalajara.',
      });
    }
    wasInBoundsRef.current = valid;
    if (valid) {
      reverseGeocode(lat, lng);
    }
  }

  const fetchNominatimSuggestions = useCallback(async (query, signal) => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('countrycodes', 'mx');
    url.searchParams.set(
      'viewbox',
      `${ZMG_BOUNDS.minLng},${ZMG_BOUNDS.maxLat},${ZMG_BOUNDS.maxLng},${ZMG_BOUNDS.minLat}`
    );
    url.searchParams.set('bounded', '1');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', 'es');

    const res = await fetch(url.toString(), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Error consultando Nominatim');
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  }, []);

  // Sugerencias automáticas mientras el usuario escribe (debounce 350ms)
  useEffect(() => {
    if (skipNextAutocompleteRef.current) {
      skipNextAutocompleteRef.current = false;
      return;
    }

    const query = searchQuery.trim();
    if (query.length < 3) {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      setSearchResults([]);
      return;
    }

    const timerId = setTimeout(async () => {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const items = await fetchNominatimSuggestions(query, controller.signal);
        setSearchResults(items);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setSearchResults([]);
        }
      }
    }, 350);

    return () => clearTimeout(timerId);
  }, [fetchNominatimSuggestions, searchQuery]);

  async function handleSearch(e) {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearching(true);
    try {
      const items = await fetchNominatimSuggestions(query, controller.signal);
      if (items.length === 0) {
        setSearchResults([]);
        sileo.warning({
          title: 'Sin resultados',
          description: 'No se encontraron calles o colonias coincidentes en la ZMG.',
        });
        return;
      }
      setSearchResults(items);
    } catch (err) {
      if (err.name !== 'AbortError') {
        sileo.error({
          title: 'Error de búsqueda',
          description: 'No se pudo consultar Nominatim.',
        });
      }
    } finally {
      setSearching(false);
    }
  }

  function handleGps() {
    if (!navigator.geolocation) {
      sileo.error({
        title: 'GPS no disponible',
        description: 'Tu navegador no soporta geolocalización.',
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updatePinPosition(pos.coords.latitude, pos.coords.longitude, {
          panMap: true,
          zoom: 16,
        });
        sileo.success({
          title: 'Ubicación GPS capturada',
          description: 'Pin actualizado con tu posición actual.',
        });
      },
      (err) => {
        sileo.error({
          title: 'Error de GPS',
          description: err.message,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function resetAfterSuccess(title, description) {
    sileo.success({ title, description });
    setCruces('');
    setCausaAparente('');
    setTamanoCategoria('');
    if (turnstileSitekey && window.turnstile && turnstileWidgetIdRef.current !== null) {
      window.turnstile.reset(turnstileWidgetIdRef.current);
      setTurnstileToken(null);
    }
  }

  async function submitReport(payload) {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/socavones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.status === 409 && data.duplicado) {
        setPendingPayload(payload);
        setDuplicateRecord(data.duplicado);
        sileo.warning({
          title: 'Posible duplicado detectado',
          description: 'Revisa el registro cercano antes de confirmar.',
        });
        return;
      }

      if (!res.ok) {
        sileo.error({
          title: 'No se pudo registrar',
          description: data.error || 'Error al guardar el reporte.',
        });
        return;
      }

      resetAfterSuccess(
        `Reporte #${data.socavon.id} registrado`,
        `Guardado correctamente en ${data.socavon.municipio}.`
      );
    } catch {
      sileo.error({
        title: 'Error de conexión',
        description: 'No fue posible comunicarse con la API.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    if (!inBounds) {
      sileo.warning({
        title: 'Ubicación fuera de la ZMG',
        description: 'Corrige las coordenadas antes de enviar.',
      });
      return;
    }
    if (turnstileSitekey && !turnstileToken) {
      sileo.warning({
        title: 'Verificación requerida',
        description: 'Completa el widget anti-spam de Turnstile.',
      });
      return;
    }

    await submitReport({
      fecha_incidente: fechaIncidente,
      municipio,
      colonia: colonia.trim(),
      calle_principal: callePrincipal.trim(),
      cruces: cruces.trim(),
      latitud: parsedLat,
      longitud: parsedLng,
      causa_aparente: causaAparente,
      tamano_categoria: tamanoCategoria || null,
      turnstile_token: turnstileToken,
    });
  }

  async function handleSumarExistente() {
    if (!duplicateRecord) return;
    setSummingDuplicate(true);
    try {
      const res = await fetch(`${API_BASE}/api/socavones/${duplicateRecord.id}/sumar`, {
        method: 'POST',
      });
      const data = await res.json();
      setDuplicateRecord(null);
      setPendingPayload(null);

      if (!res.ok) {
        sileo.error({
          title: 'Error al sumar reporte',
          description: data.error || 'Intenta de nuevo.',
        });
        return;
      }

      resetAfterSuccess(
        `Reporte sumado al socavón #${data.socavon.id}`,
        `Total acumulado: ${data.socavon.reportes_sumados} reportes.`
      );
    } catch {
      setDuplicateRecord(null);
      sileo.error({
        title: 'Error de conexión',
        description: 'No se pudo sumar al reporte existente.',
      });
    } finally {
      setSummingDuplicate(false);
    }
  }

  async function handleForzarRegistro() {
    if (!pendingPayload) return;
    const payload = { ...pendingPayload, forzar_registro: true };
    setDuplicateRecord(null);
    setPendingPayload(null);
    await submitReport(payload);
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <Toaster position="top-center" />

      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center px-3 py-3 sm:px-6 sm:py-3.5 lg:px-8">
          <div className="min-w-0 flex-1 flex-col">
            <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Registro Ciudadano de Socavones
            </h1>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              Zona Metropolitana de Guadalajara (ZMG)
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
          {/* Columna Mapa */}
          <section className="lg:col-span-7">
            <Card className="p-3 sm:p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <form onSubmit={handleSearch} className="flex flex-1 gap-2" noValidate>
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar calle o colonia en la ZMG..."
                    className="text-base sm:text-sm"
                  />
                  <Button type="submit" disabled={searching} className="shrink-0">
                    <Search className="h-4 w-4" />
                    <span className="hidden sm:inline">Buscar</span>
                  </Button>
                </form>
                <Button variant="outline" onClick={handleGps} className="w-full sm:w-auto">
                  <Crosshair className="h-4 w-4" />
                  Usar mi GPS
                </Button>
              </div>

              {searchResults.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Sugerencias de ubicación"
                  className="mb-3 max-h-48 divide-y divide-border overflow-y-auto rounded-md border bg-background text-sm shadow-sm"
                >
                  {searchResults.map((item) => (
                    <li key={item.place_id} role="option">
                      <button
                        type="button"
                        onClick={() => {
                          skipNextAutocompleteRef.current = true;
                          setSearchQuery(item.display_name.split(',')[0] || item.display_name);
                          setSearchResults([]);
                          updatePinPosition(Number(item.lat), Number(item.lon), {
                            panMap: true,
                            zoom: 16,
                          });
                        }}
                        className="w-full px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {item.display_name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="relative h-[300px] w-full overflow-hidden rounded-md border sm:h-[400px] lg:h-[560px]">
                <div ref={mapContainerRef} className="h-full w-full" />
              </div>

              <div className="mt-3 flex items-center text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  Toca el mapa o arrastra el pin para ubicar el socavón.
                </span>
              </div>
            </Card>
          </section>

          {/* Columna Formulario */}
          <section className="lg:col-span-5">
            <Card>
              <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-4">
                <CardTitle>Datos del incidente</CardTitle>
                <CardDescription>
                  Colonia, calle principal y municipio se actualizan automáticamente al mover el pin.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                {!inBounds && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertTitle>Ubicación fuera de la ZMG</AlertTitle>
                    <AlertDescription>
                      Las coordenadas deben estar dentro del rango permitido (latitud 20.40 a 20.85,
                      longitud -103.60 a -103.15). El envío está bloqueado hasta corregir la
                      ubicación.
                    </AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleFormSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="latitud" className="text-xs">
                        Latitud <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="latitud"
                        type="number"
                        step="0.000001"
                        required
                        value={latStr}
                        onChange={(e) => setLatStr(e.target.value)}
                        onBlur={handleManualCoordsBlur}
                        className="h-10 text-base tabular-nums sm:h-9 sm:text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="longitud" className="text-xs">
                        Longitud <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="longitud"
                        type="number"
                        step="0.000001"
                        required
                        value={lngStr}
                        onChange={(e) => setLngStr(e.target.value)}
                        onBlur={handleManualCoordsBlur}
                        className="h-10 text-base tabular-nums sm:h-9 sm:text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="fecha_incidente">
                      Fecha del incidente <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="fecha_incidente"
                      type="date"
                      min="2018-01-01"
                      max={todayIso}
                      required
                      value={fechaIncidente}
                      onChange={(e) => setFechaIncidente(e.target.value)}
                      className="text-base sm:text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="municipio">
                      Municipio <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      id="municipio"
                      required
                      value={municipio}
                      onChange={(e) => setMunicipio(e.target.value)}
                      className="text-base sm:text-sm"
                    >
                      <option value="">Selecciona un municipio...</option>
                      {MUNICIPIOS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="colonia">Colonia</Label>
                    <Input
                      id="colonia"
                      maxLength={120}
                      placeholder="Se completa al mover el pin"
                      value={colonia}
                      onChange={(e) => setColonia(e.target.value)}
                      className="text-base sm:text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="calle_principal">Calle principal</Label>
                    <Input
                      id="calle_principal"
                      maxLength={150}
                      placeholder="Se completa al mover el pin"
                      value={callePrincipal}
                      onChange={(e) => setCallePrincipal(e.target.value)}
                      className="text-base sm:text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cruces">Cruces o referencia</Label>
                    <Input
                      id="cruces"
                      maxLength={150}
                      placeholder="Ej. Entre Av. Vallarta y Calle Morelos"
                      value={cruces}
                      onChange={(e) => setCruces(e.target.value)}
                      className="text-base sm:text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="causa_aparente">
                      Causa aparente <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      id="causa_aparente"
                      required
                      value={causaAparente}
                      onChange={(e) => setCausaAparente(e.target.value)}
                      className="text-base sm:text-sm"
                    >
                      <option value="">Selecciona una causa...</option>
                      {CAUSAS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tamano_categoria">Tamaño estimado</Label>
                    <Select
                      id="tamano_categoria"
                      value={tamanoCategoria}
                      onChange={(e) => setTamanoCategoria(e.target.value)}
                      className="text-base sm:text-sm"
                    >
                      <option value="">Selecciona un tamaño (opcional)...</option>
                      {TAMANOS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {turnstileSitekey && <div ref={turnstileContainerRef} className="overflow-x-auto pt-1" />}

                  <Button
                    type="submit"
                    className="h-11 w-full sm:h-10"
                    disabled={!inBounds || submitting}
                  >
                    {submitting ? 'Enviando reporte...' : 'Enviar reporte de socavón'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>
        </div>
      </main>

      {/* Dialog de prevención de duplicados */}
      <dialog
        ref={dupDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setDuplicateRecord(null);
          setPendingPayload(null);
        }}
        className="mx-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg sm:p-6"
      >
        {duplicateRecord && (
          <>
            <div className="space-y-2">
              <h3 className="text-base font-semibold leading-none tracking-tight sm:text-lg">
                Posible socavón duplicado detectado
              </h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Ya existe un reporte registrado a menos de 50 metros y dentro de ±30 días.
              </p>
            </div>

            <div className="my-4 rounded-md border bg-muted/50 p-3.5">
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-muted-foreground">Fecha:</dt>
                  <dd className="font-semibold text-foreground">
                    {String(duplicateRecord.fecha_incidente || '').slice(0, 10)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-muted-foreground">Ubicación:</dt>
                  <dd className="text-right text-foreground">
                    {[
                      duplicateRecord.calle_principal,
                      duplicateRecord.colonia,
                      duplicateRecord.municipio,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    {duplicateRecord.distancia_m !== undefined
                      ? ` (~${duplicateRecord.distancia_m} m)`
                      : ''}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-muted-foreground">Causa:</dt>
                  <dd className="text-foreground">
                    {duplicateRecord.causa_aparente || 'No especificada'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="font-medium text-muted-foreground">Reportes sumados:</dt>
                  <dd className="font-semibold text-foreground">
                    {duplicateRecord.reportes_sumados ?? 1}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="mb-4 text-xs text-muted-foreground">
              ¿Deseas sumar tu reporte a este registro existente o confirmar que se trata de un
              evento distinto?
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-full sm:h-9 sm:w-auto"
                onClick={() => {
                  setDuplicateRecord(null);
                  setPendingPayload(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-10 w-full sm:h-9 sm:w-auto"
                onClick={handleForzarRegistro}
              >
                Confirmar evento distinto
              </Button>
              <Button
                size="sm"
                className="h-10 w-full sm:h-9 sm:w-auto"
                disabled={summingDuplicate}
                onClick={handleSumarExistente}
              >
                {summingDuplicate ? 'Sumando...' : 'Sumar a este socavón existente'}
              </Button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
