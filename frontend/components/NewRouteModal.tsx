"use client";

import { useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette } from "lucide-react";

const PRESET_COLORS = [
  "#009B77", "#E63946", "#457B9D", "#F4A261",
  "#6A4C93", "#2A9D8F", "#E9C46A", "#264653",
];

interface NewRouteModalProps {
  onClose: () => void;
}

export default function NewRouteModal({ onClose }: NewRouteModalProps) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const startCustomRoute = useEditorStore((s) => s.startCustomRoute);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    startCustomRoute({ name: name.trim(), shortName: shortName.trim(), color });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>New Custom Route</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="route-name">Route name</Label>
              <Input
                id="route-name"
                placeholder="e.g. Green Street Express"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-short">Number</Label>
              <Input
                id="route-short"
                placeholder="e.g. 22X"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? "#000" : "transparent",
                      transform: color === c ? "scale(1.2)" : "scale(1)",
                    }}
                    aria-label={c}
                  />
                ))}
                <div className="relative w-7 h-7" title="Custom color">
                  <label
                    htmlFor="custom-color"
                    className="flex w-7 h-7 cursor-pointer items-center justify-center rounded-full border-2 border-dashed transition-all hover:scale-110"
                    style={
                      PRESET_COLORS.includes(color)
                        ? { borderColor: "#9ca3af" }
                        : { borderColor: "#000", backgroundColor: color, transform: "scale(1.2)" }
                    }
                  >
                    {PRESET_COLORS.includes(color) && (
                      <Palette className="w-3 h-3 text-muted-foreground" />
                    )}
                  </label>
                  <input
                    id="custom-color"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1">
                Create
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
