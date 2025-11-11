import React, { useEffect, useRef, useState } from "react";
import { MapPin, X, Info } from "lucide-react";

export default function GeographicQuestion({
  questionNumber = 4,
  value,
  selectedMeta,
  onChange,
  onSelect,
  onClear,
  onInfoClick
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);

  useEffect(() => {
    // Check if Google Maps is already loaded
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsScriptLoaded(true);
      return;
    }

    // Load Google Maps Places API
    // NOTE: Replace 'YOUR_API_KEY' with actual Google Places API key
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_PLACES_API_KEY&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setIsScriptLoaded(true);
    script.onerror = () => {
      console.error("Failed to load Google Maps");
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !inputRef.current || autocompleteRef.current) return;

    try {
      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["(regions)"], // Restricts to cities, regions, countries - no street addresses
        fields: ["place_id", "formatted_address", "geometry", "name"]
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();

        if (!place.geometry) {
          console.warn("No geometry for place");
          return;
        }

        const meta = {
          label: place.formatted_address || place.name,
          lat: place.geometry.location.lat(),
          lon: place.geometry.location.lng(),
          place_id: place.place_id,
          source: "google"
        };

        onSelect(meta);
      });

      autocompleteRef.current = autocomplete;
    } catch (error) {
      console.error("Error initializing Google Places:", error);
    }
  }, [isScriptLoaded, onSelect]);

  const hasSelection = selectedMeta && selectedMeta.label;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <label className="block flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">
              {questionNumber}. What geographic area do you primarily serve?
            </span>
            {onInfoClick && (
              <button
                type="button"
                onClick={onInfoClick}
                className="w-6 h-6 rounded-full border border-slate-300 hover:border-slate-400 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
                aria-label="More information"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="text-sm text-slate-500 italic mt-1 block">
            Start typing (e.g., "Denver, CO" or "Auckland, NZ") and choose a validated result.
          </span>
        </label>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search a city, region, or country..."
          defaultValue={selectedMeta?.label || ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-4 pr-12 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <MapPin className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
      </div>

      <div className="text-sm text-slate-500">
        ✅ Only verified locations can be saved. If you don't see yours, try a broader/alternate spelling.
      </div>

      {hasSelection && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="font-medium text-slate-900">Selected: </span>
            <span className="text-slate-700">{selectedMeta.label}</span>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="px-4 py-2 text-sm border border-slate-300 hover:border-slate-400 rounded-lg flex items-center gap-2 transition-colors"
          >
            <X className="w-4 h-4" />
            Change
          </button>
        </div>
      )}

      {!isScriptLoaded && (
        <div className="text-sm text-amber-600">
          Loading location validator...
        </div>
      )}
    </div>
  );
}