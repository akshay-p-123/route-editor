"use client";

import { useState, useEffect, useRef } from "react";
import { mtd, type StopSearchResult } from "@/lib/api";
import { useEditorStore } from "@/store/editorStore";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

function useDebounce(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function StopSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StopSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const addStop = useEditorStore((s) => s.addStop);
  const debounced = useDebounce(query, 250);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    mtd.searchStops(debounced).then((data) => {
      if (!cancelled) setResults(data.result ?? []);
    }).catch(() => {
      if (!cancelled) setResults([]);
    });
    return () => { cancelled = true; };
  }, [debounced]);

  function handleAdd(stop: StopSearchResult) {
    addStop(stop);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="relative rounded-md shadow-md ring-2 ring-primary/20 focus-within:ring-primary/50 transition-shadow">
        <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-8 h-10 text-sm font-medium border-0 shadow-none focus-visible:ring-0"
          placeholder="Add a stop…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>

      {open && results.length > 0 && (
        <ul className="absolute bottom-full mb-1 left-0 right-0 z-50 bg-popover border rounded-md shadow-md max-h-52 overflow-y-auto text-sm">
          {results.map((stop) => {
            const display = stop.subName
              ? `${stop.name} (${stop.subName})`
              : stop.name;
            return (
              <li key={stop.stopId}>
                <button
                  className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                  onMouseDown={() => handleAdd(stop)}
                  title={display}
                >
                  <span className="block truncate">{display}</span>
                  {stop.city && (
                    <span className="text-xs text-muted-foreground">{stop.city}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
