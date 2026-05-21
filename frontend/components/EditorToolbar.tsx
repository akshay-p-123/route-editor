"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { savedRoutes, exportPng, type RoutePayload, type ExportPayload } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Download, RotateCcw, List, Map as MapIcon } from "lucide-react";

interface EditorToolbarProps {
  onAuthRequired: () => void;
}

export default function EditorToolbar({ onAuthRequired }: EditorToolbarProps) {
  const {
    selectedRouteGroup,
    selectedDirection,
    isCustom,
    customMeta,
    stops,
    originalStops,
    savedRouteId,
    isDirty,
    editMode,
    setEditMode,
    markSaved,
    reset,
  } = useEditorStore();

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasRoute = !!selectedRouteGroup || isCustom;
  const color =
    selectedRouteGroup?.color ?? customMeta?.color?.replace("#", "") ?? "009B77";
  const textColor = selectedRouteGroup?.textColor ?? "ffffff";

  async function getToken(): Promise<string | null> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleSave() {
    const token = await getToken();
    if (!token) {
      onAuthRequired();
      return;
    }
    setSaving(true);
    try {
      const shortName =
        selectedRouteGroup?.routes?.[0]?.number ?? customMeta?.shortName ?? "";
      const payload: RoutePayload = {
        name: selectedRouteGroup?.routeGroupName ?? customMeta?.name ?? "Untitled Route",
        short_name: shortName,
        color: `#${color}`,
        is_custom: isCustom,
        base_route_id: selectedRouteGroup?.id,
        stops: stops.map((s) => ({
          stop_sequence: s.stop_sequence,
          stop_id: s.stop_id ?? null,
          stop_name: s.stop_name,
          stop_lat: s.stop_lat,
          stop_lon: s.stop_lon,
        })),
      };
      let id: string;
      if (savedRouteId) {
        const res = await savedRoutes.update(savedRouteId, payload, token);
        id = res.id;
      } else {
        const res = await savedRoutes.create(payload, token);
        id = res.id;
      }
      markSaved(id);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const origIds = new Set(originalStops.map((s) => s.stop_id));
      const currIds = new Set(stops.map((s) => s.stop_id));

      const payload: ExportPayload = {
        // Original stops: flag removed ones so the backend draws X markers
        original_stops: originalStops.map((s) => ({
          lat: s.stop_lat,
          lon: s.stop_lon,
          stop_name: s.stop_name,
          is_removed: !!s.stop_id && !currIds.has(s.stop_id),
        })),
        // Modified stops: current active stops only (no removed ones)
        modified_stops: stops.map((s) => ({
          lat: s.stop_lat,
          lon: s.stop_lon,
          stop_name: s.stop_name,
          is_added: !!s.stop_id && !origIds.has(s.stop_id),
        })),
        route_color: `#${color}`,
      };

      const blob = await exportPng(payload);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `route-${selectedRouteGroup?.routes?.[0]?.number ?? "custom"}-reroute.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  if (!hasRoute) {
    return (
      <div className="h-14 border-b flex items-center px-4 gap-3 bg-background">
        <span className="text-sm text-muted-foreground">
          Select a route to start editing
        </span>
      </div>
    );
  }

  const routeLabel =
    selectedRouteGroup?.routeGroupName ?? customMeta?.name ?? "New Route";
  const shortLabel =
    selectedRouteGroup?.routes?.[0]?.number ?? customMeta?.shortName ?? "";

  return (
    <div className="h-14 border-b flex items-center px-4 gap-3 bg-background">
      <Badge
        className="font-bold text-sm px-2.5"
        style={{
          backgroundColor: `#${color}`,
          color: `#${textColor}`,
          borderColor: `#${color}`,
        }}
      >
        {shortLabel}
      </Badge>
      <span className="font-medium text-sm truncate max-w-[200px]">{routeLabel}</span>
      {selectedDirection && (
        <span className="text-xs text-muted-foreground shrink-0">{selectedDirection}</span>
      )}
      {isDirty && (
        <span className="text-xs text-amber-500 font-medium">• Unsaved</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <div className="flex rounded-md border overflow-hidden">
          <Button
            size="sm"
            variant={editMode === "map" ? "default" : "ghost"}
            className="rounded-none h-8 px-3"
            onClick={() => setEditMode("map")}
          >
            <MapIcon className="w-3.5 h-3.5 mr-1" />
            Map
          </Button>
          <Button
            size="sm"
            variant={editMode === "list" ? "default" : "ghost"}
            className="rounded-none h-8 px-3"
            onClick={() => setEditMode("list")}
          >
            <List className="w-3.5 h-3.5 mr-1" />
            List
          </Button>
        </div>

        <Button size="sm" variant="outline" onClick={reset}>
          <RotateCcw className="w-3.5 h-3.5 mr-1" />
          Reset
        </Button>

        <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="w-3.5 h-3.5 mr-1" />
          {exporting ? "Exporting…" : "Export PNG"}
        </Button>

        <Button size="sm" onClick={handleSave} disabled={saving || !isDirty}>
          <Save className="w-3.5 h-3.5 mr-1" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
