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
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Check if Google Maps is already loaded
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsScriptLoaded(true);
      return;
    }

    // Check if script is already being loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => setIsScriptLoaded(true));
      existingScript.addEventListener('error', () => setLoadError(true));
      return;
    }

    // Load Google Maps Places API
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_PLACES_API_KEY&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setIsScriptLoaded(true);
      } else {
        setLoadError(true);
      }
    };
    script.onerror = () => {
      setLoadError(true);
      console.warn("Failed to load Google Maps - users can still type manually");
    };
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!isScriptLoaded || !inputRef.current || autocompleteRef.current || loadError) return;

    try {
      const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["(regions)"],
        fields: ["place_id", "formatted_address", "geometry", "name"]
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();

        if (!place.geometry) {
          console.warn("No geometry for selected place");
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
      console.warn("Error initializing Google Places:", error);
      setLoadError(true);
    }
  }, [isScriptLoaded, onSelect, loadError]);

  const hasSelection = selectedMeta && selectedMeta.label;

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    // If user is typing after making a selection, clear the selection
    if (hasSelection && newValue !== selectedMeta.label) {
      onClear();
    }
  };

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
            {isScriptLoaded 
              ? "Start typing and select from suggestions, or type freely" 
              : loadError 
              ? "Type your geographic area (city, region, state, country)" 
              : "Loading location search..."}
          </span>
        </label>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder="e.g., Denver, CO or Auckland, NZ"
          value={hasSelection ? selectedMeta.label : value}
          onChange={handleInputChange}
          className="w-full p-4 pr-12 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <MapPin className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
      </div>

      {isScriptLoaded && !loadError && (
        <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
          💡 Select a suggestion from the dropdown for validated location data, or continue typing to enter manually.
        </div>
      )}

      {loadError && (
        <div className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
          ⚠️ Location search unavailable. Please type your geographic area manually.
        </div>
      )}

      {hasSelection && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <div>
              <span className="font-medium text-green-900">Validated: </span>
              <span className="text-green-800">{selectedMeta.label}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="px-4 py-2 text-sm bg-white border border-green-300 hover:border-green-400 hover:bg-green-50 rounded-lg flex items-center gap-2 transition-colors text-green-800 font-medium"
          >
            <X className="w-4 h-4" />
            Clear
          </button>
        </div>
      )}
    </div>
  );
}