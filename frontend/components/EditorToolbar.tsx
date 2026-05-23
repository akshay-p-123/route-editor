"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import { savedRoutes, exportPng, type RoutePayload, type ExportPayload } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Download, RotateCcw, Undo2, AlertTriangle, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";

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
    activeRerouteId,
    setActiveRerouteId,
    isDirty,
    isValid,
    validationErrors,
    routePreviewEnabled,
    setRoutePreviewEnabled,
    isSuspiciousRoute,
    isRouteComputing,
    markSaved,
    reset,
    undo,
    history,
  } = useEditorStore();

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const hasRoute = !!selectedRouteGroup || isCustom;
  const color =
    selectedRouteGroup?.color ?? customMeta?.color?.replace("#", "") ?? "009B77";
  const textColor = selectedRouteGroup?.textColor ?? "ffffff";

  async function getToken(): Promise<string | null> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function handleSave() {
    const token = await getToken();
    if (!token) { onAuthRequired(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const shortName =
        selectedRouteGroup?.routes?.[0]?.number ?? customMeta?.shortName ?? "";
      const payload: RoutePayload = {
        name: selectedRouteGroup?.routeGroupName ?? customMeta?.name ?? "Untitled Route",
        short_name: shortName,
        color: `#${color}`,
        is_custom: isCustom,
        base_route_id: selectedRouteGroup?.id,
        reroute_id: activeRerouteId ?? undefined,
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
      queryClient.invalidateQueries({ queryKey: ["saved-routes"] });
      if (activeRerouteId) {
        queryClient.invalidateQueries({ queryKey: ["reroutes"] });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
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
        original_stops: originalStops.map((s) => ({
          lat: s.stop_lat, lon: s.stop_lon, stop_name: s.stop_name,
          is_removed: !!s.stop_id && !currIds.has(s.stop_id),
        })),
        modified_stops: stops.map((s) => ({
          lat: s.stop_lat, lon: s.stop_lon, stop_name: s.stop_name,
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

  const routeLabel = selectedRouteGroup?.routeGroupName ?? customMeta?.name ?? "New Route";
  const shortLabel = selectedRouteGroup?.routes?.[0]?.number ?? customMeta?.shortName ?? "";
  const errors   = validationErrors.filter((e) => e.severity === "error");
  const warnings = validationErrors.filter((e) => e.severity === "warning");
  const firstError   = errors[0];
  const firstWarning = warnings[0];

  return (
    <div className="flex flex-col">
      <div className="h-14 border-b flex items-center px-4 gap-3 bg-background">
        <Badge
          className="font-bold text-sm px-2.5 shrink-0"
          style={{ backgroundColor: `#${color}`, color: `#${textColor}`, borderColor: `#${color}` }}
        >
          {shortLabel}
        </Badge>

        <span className="font-medium text-sm truncate max-w-[180px]">{routeLabel}</span>

        {selectedDirection && (
          <span className="text-xs text-muted-foreground shrink-0">{selectedDirection}</span>
        )}

        {/* Mode badge */}
        {isCustom ? (
          <span className="text-xs text-emerald-600 font-medium shrink-0">Building</span>
        ) : (
          <span className="text-xs text-blue-500 font-medium shrink-0">Editing</span>
        )}

        {/* Error badge */}
        {!isValid && (
          <span
            className="flex items-center gap-1 text-xs text-destructive font-medium shrink-0"
            title={errors.map((e) => e.message).join("\n")}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {errors.length} {errors.length === 1 ? "error" : "errors"}
          </span>
        )}

        {/* Warning badge */}
        {warnings.length > 0 && (
          <span
            className="flex items-center gap-1 text-xs text-amber-500 font-medium shrink-0"
            title={warnings.map((e) => e.message).join("\n")}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
          </span>
        )}

        {isSuspiciousRoute && routePreviewEnabled && (
          <span
            className="flex items-center gap-1 text-xs text-amber-500 font-medium shrink-0"
            title="OSRM couldn't find a clean path — route shown as an approximation"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Route may be inaccurate
          </span>
        )}

        {isDirty && isValid && !isSuspiciousRoute && (
          <span className="text-xs text-amber-500 font-medium shrink-0">• Unsaved</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Route preview toggle */}
          {(() => {
            const needsRefresh = isDirty && !routePreviewEnabled && !isRouteComputing;
            return (
              <Button
                size="sm"
                variant={routePreviewEnabled ? "outline" : "ghost"}
                onClick={() => setRoutePreviewEnabled(!routePreviewEnabled)}
                disabled={isRouteComputing}
                title={
                  isRouteComputing ? "Computing route…"
                  : needsRefresh    ? "Click to preview the modified route"
                  : routePreviewEnabled ? "Hide route preview while editing"
                  : "Show route preview"
                }
                className={
                  needsRefresh
                    ? "border border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 shadow-sm shadow-amber-200 animate-pulse"
                    : ""
                }
              >
                {isRouteComputing
                  ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  : needsRefresh
                  ? <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  : routePreviewEnabled
                  ? <Eye className="w-3.5 h-3.5 mr-1" />
                  : <EyeOff className="w-3.5 h-3.5 mr-1" />}
                {isRouteComputing ? "Computing…" : needsRefresh ? "Preview route" : "Preview"}
              </Button>
            );
          })()}

          <Button
            size="sm"
            variant="outline"
            onClick={undo}
            disabled={history.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5 mr-1" />
            Undo
          </Button>

          <Button size="sm" variant="outline" onClick={reset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            Reset
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={exporting || !isValid}
            title={!isValid ? firstError?.message : undefined}
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            {exporting ? "Exporting…" : "Export PNG"}
          </Button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !isDirty || !isValid}
            title={!isValid ? firstError?.message : undefined}
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Error strip — blocks save */}
      {(!isValid || saveError) && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <span className="text-xs text-destructive">
            {saveError ?? firstError?.message}
            {errors.length > 1 && !saveError ? ` (+${errors.length - 1} more)` : ""}
          </span>
        </div>
      )}

      {/* Warning strip — informational, does not block save */}
      {warnings.length > 0 && isValid && !saveError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-700">
            {firstWarning?.message}
            {warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
