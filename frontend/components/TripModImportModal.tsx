"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import type { EditorStop } from "@/store/editorStore";
import { importTripMod, type TripModTrip } from "@/lib/api";
import { validateRoute } from "@/lib/validation";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2 } from "lucide-react";

interface TripModImportModalProps {
  onClose: () => void;
}

async function getToken(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function TripModImportModal({ onClose }: TripModImportModalProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripModTrip[] | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  async function handleLoad() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Could not load feed. Check the URL and try again.");
        return;
      }
      const result = await importTripMod(url.trim(), token);
      if (result.length === 0) {
        setTrips([]);
        return;
      }
      if (result.length === 1) {
        // Single trip — load immediately
        loadTrip(result[0]);
        return;
      }
      // Multiple trips — show selection
      setTrips(result);
      setSelectedTripId(result[0].trip_id);
    } catch (err) {
      setError("Could not load feed. Check the URL and try again.");
      console.error("TripMod import error:", err);
    } finally {
      setLoading(false);
    }
  }

  function loadTrip(trip: TripModTrip) {
    const stops: EditorStop[] = trip.stops.map((s, i) => ({
      stop_sequence: i,
      stop_id: s.stop_id,
      stop_name: s.stop_name,
      stop_lat: s.stop_lat,
      stop_lon: s.stop_lon,
      isAdded: true,
    }));
    const errs = validateRoute(stops);
    useEditorStore.setState({
      selectedRouteGroup: null,
      selectedDirection: null,
      originalStops: stops,
      stops,
      shapeId: null,
      isCustom: true,
      customMeta: {
        name: `TripMod: ${trip.trip_id}`,
        shortName: trip.route_short_name ?? "",
        color: "#009B77",
      },
      savedRouteId: null,
      activeRerouteId: null,
      isDirty: true,
      selectedStopId: null,
      routePreviewEnabled: true,
      isSuspiciousRoute: false,
      isRouteComputing: false,
      dismissedWarnings: new Set(),
      history: [],
      validationErrors: errs,
      isValid: errs.filter((e) => e.severity === "error").length === 0,
    });
    onClose();
  }

  function handleOpenInEditor() {
    if (!trips || !selectedTripId) return;
    const trip = trips.find((t) => t.trip_id === selectedTripId);
    if (trip) loadTrip(trip);
  }

  // ── Zero trips result ────────────────────────────────────────────────────────
  if (trips !== null && trips.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
        <div className="bg-background rounded-lg shadow-xl p-6 w-96 space-y-4">
          <h3 className="font-semibold">Import TripModifications Feed</h3>
          <p className="text-sm text-muted-foreground text-center py-4">
            No modifications found in this feed.
          </p>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Trip selection step ──────────────────────────────────────────────────────
  if (trips !== null && trips.length > 1) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
        <div className="bg-background rounded-lg shadow-xl p-6 w-96 space-y-4">
          <h3 className="font-semibold">Import TripModifications Feed</h3>
          <p className="text-sm font-semibold">Select a trip to import</p>
          <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-1">
            {trips.map((trip) => (
              <button
                key={trip.trip_id}
                className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors ${
                  selectedTripId === trip.trip_id ? "bg-muted/50" : ""
                }`}
                onClick={() => setSelectedTripId(trip.trip_id)}
              >
                <span className="flex flex-col min-w-0">
                  <span className="font-semibold truncate">{trip.trip_id}</span>
                  {trip.route_short_name && (
                    <span className="text-xs text-muted-foreground truncate">
                      {trip.route_short_name}
                    </span>
                  )}
                </span>
                <Badge variant="secondary" className="shrink-0">
                  {trip.stops.length} stops
                </Badge>
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={handleOpenInEditor}
              disabled={!selectedTripId}
            >
              Open in editor
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── URL input step ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-background rounded-lg shadow-xl p-6 w-96 space-y-4">
        <h3 className="font-semibold">Import TripModifications Feed</h3>
        <div className="space-y-2">
          <Input
            type="text"
            placeholder="https://…/trip-modifications.pb"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && !loading && url.trim() && handleLoad()}
          />
          {error ? (
            <div className="flex items-center gap-1 text-sm text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {error}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter a GTFS-RT TripModifications protobuf feed URL
            </p>
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleLoad}
            disabled={!url.trim() || loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" />
                Loading…
              </>
            ) : (
              "Load modifications"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
