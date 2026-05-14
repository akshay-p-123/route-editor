"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { savedRoutes, type SavedRoute } from "@/lib/api";
import { useEditorStore } from "@/store/editorStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Pencil, Trash2, X } from "lucide-react";
import type { EditorStop } from "@/store/editorStore";

interface SavedRoutesDashboardProps {
  onClose: () => void;
}

export default function SavedRoutesDashboard({ onClose }: SavedRoutesDashboardProps) {
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const { loadRoute, startCustomRoute, markSaved } = useEditorStore();

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      const data = await savedRoutes.list(session.access_token);
      setRoutes(data);
      setLoading(false);
    })();
  }, []);

  async function handleDelete(id: string) {
    if (!token) return;
    await savedRoutes.delete(id, token);
    setRoutes((prev) => prev.filter((r) => r.id !== id));
  }

  function handleOpen(route: SavedRoute) {
    const stops: EditorStop[] = route.route_stops
      .sort((a, b) => a.stop_sequence - b.stop_sequence)
      .map((s) => ({
        stop_sequence: s.stop_sequence,
        stop_id: s.stop_id ?? null,
        stop_name: s.stop_name,
        stop_lat: s.stop_lat,
        stop_lon: s.stop_lon,
      }));

    if (route.is_custom) {
      startCustomRoute({
        name: route.name,
        shortName: route.short_name ?? "",
        color: route.color ?? "#009B77",
      });
      useEditorStore.setState({ stops, originalStops: stops, savedRouteId: route.id });
    } else {
      // Reconstruct a minimal RouteGroup from saved metadata
      loadRoute(
        {
          id: route.base_route_id ?? "",
          routeGroupName: route.name,
          color: (route.color ?? "#009B77").replace("#", ""),
          textColor: "ffffff",
          routes: route.short_name
            ? [{ id: "", number: route.short_name }]
            : [],
        },
        stops,
        ""
      );
      markSaved(route.id);
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-background rounded-xl shadow-xl w-full max-w-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-lg">Saved Routes</h2>
          <Button size="icon" variant="ghost" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          ) : routes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No saved routes yet. Edit a route and click Save.
            </p>
          ) : (
            routes.map((route) => {
              const color = route.color ?? "#009B77";
              return (
                <Card key={route.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-3 p-3">
                      <div
                        className="w-1 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {route.short_name && (
                            <Badge
                              className="text-xs font-bold"
                              style={{
                                backgroundColor: color,
                                color: "#fff",
                                borderColor: color,
                              }}
                            >
                              {route.short_name}
                            </Badge>
                          )}
                          <span className="font-medium text-sm truncate">
                            {route.name}
                          </span>
                          {route.is_custom && (
                            <Badge variant="outline" className="text-xs shrink-0">
                              Custom
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {route.route_stops?.length ?? 0} stops · Updated{" "}
                          {new Date(route.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleOpen(route)}
                          title="Open in editor"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(route.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
