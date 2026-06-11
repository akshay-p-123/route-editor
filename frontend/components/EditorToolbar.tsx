"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditorStore } from "@/store/editorStore";
import { savedRoutes, exportPng, estimateTravelTime, type RoutePayload, type ExportPayload, type Reroute } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Download, RotateCcw, Undo2, AlertTriangle, Eye, EyeOff, Loader2, RefreshCw, Copy, Pencil, FileInput, Clock, Info } from "lucide-react";
import TripModImportModal from "@/components/TripModImportModal";

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
    isDirty,
    isValid,
    validationErrors,
    routePreviewEnabled,
    setRoutePreviewEnabled,
    isSuspiciousRoute,
    isRouteComputing,
    travelTimeEstimates,
    travelTimeEstimatesStale,
    setTravelTimeEstimates,
    markSaved,
    reset,
    undo,
    history,
  } = useEditorStore();

  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setIsAuthed(!!session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setIsAuthed(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [showSaveNameDialog, setShowSaveNameDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [showTripModImport, setShowTripModImport] = useState(false);
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

  function handleSave() {
    if (!savedRouteId) {
      // First save — prompt for a name before creating
      const routePart = [selectedRouteGroup?.routeGroupName, selectedDirection].filter(Boolean).join(" ") || "Untitled Route";
      const rerouteName = activeRerouteId
        ? (queryClient.getQueryData<Reroute[]>(["reroutes"]) ?? []).find((r) => r.id === activeRerouteId)?.name
        : undefined;
      const currentName = isCustom
        ? (customMeta?.name ?? "Untitled Route")
        : rerouteName ? `${rerouteName} -- ${routePart}` : routePart;
      setSaveName(currentName);
      setShowSaveNameDialog(true);
    } else {
      void doSave(savedRouteId, null);
    }
  }

  async function confirmSaveName() {
    setShowSaveNameDialog(false);
    void doSave(null, saveName.trim() || null);
  }

  async function confirmRename() {
    setShowRenameDialog(false);
    const newName = renameName.trim();
    if (!newName || !savedRouteId) return;
    const token = await getToken();
    if (!token) { onAuthRequired(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const current = await savedRoutes.get(savedRouteId, token);
      const payload: RoutePayload = {
        name: newName,
        short_name: current.short_name ?? undefined,
        color: current.color ?? undefined,
        is_custom: current.is_custom,
        base_route_id: current.base_route_id ?? undefined,
        reroute_id: current.reroute_id ?? undefined,
        stops: current.route_stops.map((s) => ({
          stop_sequence: s.stop_sequence,
          stop_id: s.stop_id ?? null,
          stop_name: s.stop_name,
          stop_lat: s.stop_lat,
          stop_lon: s.stop_lon,
        })),
      };
      await savedRoutes.update(savedRouteId, payload, token);
      if (isCustom && customMeta) {
        useEditorStore.setState({ customMeta: { ...customMeta, name: newName } });
      } else if (selectedRouteGroup) {
        useEditorStore.setState({ selectedRouteGroup: { ...selectedRouteGroup, routeGroupName: newName } });
      }
      queryClient.invalidateQueries({ queryKey: ["saved-routes"] });
      if (activeRerouteId) {
        queryClient.invalidateQueries({ queryKey: ["reroutes"] });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setSaving(false);
    }
  }

  async function doSave(existingId: string | null, nameOverride: string | null) {
    const token = await getToken();
    if (!token) { onAuthRequired(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const shortName =
        selectedRouteGroup?.routes?.[0]?.number ?? customMeta?.shortName ?? "";
      const payload: RoutePayload = {
        name: nameOverride ?? selectedRouteGroup?.routeGroupName ?? customMeta?.name ?? "Untitled Route",
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
      if (existingId) {
        const res = await savedRoutes.update(existingId, payload, token);
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

  function handleSaveAsCopy() {
    const currentName = isCustom
      ? (customMeta?.name ?? "Untitled Route")
      : (selectedRouteGroup?.routeGroupName ?? "Untitled Route");
    setCopyName(currentName + " (copy)");
    setShowCopyDialog(true);
  }

  async function confirmSaveAsCopy() {
    setShowCopyDialog(false);
    const token = await getToken();
    if (!token) { onAuthRequired(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const shortName = selectedRouteGroup?.routes?.[0]?.number ?? customMeta?.shortName ?? "";
      const payload: RoutePayload = {
        name: copyName,
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
      const res = await savedRoutes.create(payload, token);
      markSaved(res.id);
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

  async function handleEstimateTravelTime() {
    setEstimating(true);
    setEstimateError(null);
    const requestStops = stops;
    try {
      const token = await getToken();
      if (!token) { onAuthRequired(); return; }
      const result = await estimateTravelTime(originalStops, requestStops, token);
      if (useEditorStore.getState().stops === requestStops) {
        setTravelTimeEstimates(result);
      }
    } catch (err) {
      setEstimateError("Couldn't estimate travel time — OSRM or MTD data unavailable. Try again in a moment.");
      console.error(err);
    } finally {
      setEstimating(false);
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

        {savedRouteId && (
          <button
            onClick={() => { setRenameName(routeLabel); setShowRenameDialog(true); }}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title="Rename route"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}

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

          {/* Estimate Travel Time trigger */}
          {(() => {
            const tooFewStops = stops.length < 2;
            const hasEstimate = travelTimeEstimates !== null;
            const isStale = hasEstimate && travelTimeEstimatesStale;
            return (
              <Button
                size="sm"
                variant={hasEstimate ? "outline" : "default"}
                onClick={handleEstimateTravelTime}
                disabled={estimating || tooFewStops}
                title={tooFewStops ? "Add at least 2 stops to estimate travel time" : undefined}
                className={
                  isStale
                    ? "border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100 animate-pulse"
                    : ""
                }
              >
                {estimating
                  ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  : isStale
                  ? <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  : <Clock className="w-3.5 h-3.5 mr-1" />}
                {estimating
                  ? "Estimating…"
                  : isStale
                  ? "Update Estimate"
                  : hasEstimate
                  ? "Re-estimate"
                  : "Estimate Travel Time"}
              </Button>
            );
          })()}

          <span
            className="shrink-0 text-muted-foreground"
            title="Estimates combine road-network travel time changes (via OSRM) with live MTD departure delay data for each stop. Hover a stop's badge for per-stop details."
          >
            <Info className="w-3.5 h-3.5" />
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTripModImport(true)}
          >
            <FileInput className="w-3.5 h-3.5 mr-1" />
            Import TripMod
          </Button>

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

          {savedRouteId && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveAsCopy}
              disabled={saving || !isValid}
              title="Save current state as a new route"
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              Copy
            </Button>
          )}
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

      {/* Estimate error strip */}
      {estimateError && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
          <span className="text-xs text-destructive">
            {estimateError}
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

      {/* Guest notice — shown when editing without being signed in */}
      {isAuthed === false && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 flex items-center gap-2">
          <span className="text-xs text-blue-700 flex-1">
            You&apos;re not signed in — changes won&apos;t be saved.
          </span>
          <button
            onClick={onAuthRequired}
            className="text-xs text-blue-600 underline shrink-0 hover:text-blue-800"
          >
            Sign in
          </button>
        </div>
      )}

      {(exporting || estimating) && (
        <div className="h-0.5 overflow-hidden bg-gray-200">
          <div
            className="h-full w-[35%] bg-blue-500"
            style={{ animation: "indeterminate 1.2s linear infinite" }}
          />
        </div>
      )}

      {showSaveNameDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-background rounded-lg shadow-xl p-6 w-80 space-y-4">
            <h3 className="font-semibold">Name this route edit</h3>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName.trim() && confirmSaveName()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowSaveNameDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={confirmSaveName} disabled={!saveName.trim()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {showRenameDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-background rounded-lg shadow-xl p-6 w-80 space-y-4">
            <h3 className="font-semibold">Rename route</h3>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && renameName.trim() && confirmRename()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowRenameDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={confirmRename} disabled={!renameName.trim() || saving}>
                {saving ? "Saving…" : "Rename"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCopyDialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-background rounded-lg shadow-xl p-6 w-80 space-y-4">
            <h3 className="font-semibold">Save as Copy</h3>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && copyName.trim() && confirmSaveAsCopy()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowCopyDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={confirmSaveAsCopy} disabled={!copyName.trim()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {showTripModImport && (
        <TripModImportModal onClose={() => setShowTripModImport(false)} />
      )}
    </div>
  );
}
