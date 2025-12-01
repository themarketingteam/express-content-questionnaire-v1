import React, { useEffect, useRef, useState } from "react";
import { MapPin, X, Info, ChevronDown } from "lucide-react";

const TEMP_API_KEY = "AIzaSyDyQuexeP2lIif4UEYVe845bIYrytVp6O0";

export default function GeographicQuestion({
  questionNumber = 4,
  value,
  selectedMeta,
  onChange,
  onSelect,
  onClear,
  onInfoClick,
  isOpen = true,
  onClick
}) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (window.google && window.google.maps && window.google.maps.places) {
      setIsScriptLoaded(true);
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => setIsScriptLoaded(true));
      existingScript.addEventListener('error', () => setLoadError(true));
      return;
    }

    const apiKey = TEMP_API_KEY || window.ENV?.GOOGLE_PLACES_API_KEY || import.meta.env.VITE_GOOGLE_PLACES_API_KEY;
    
    if (!apiKey) {
      console.warn("Google Places API key not configured");
      setLoadError(true);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
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

        // Check if this is a continent by examining address components
        const addressComponents = place.address_components || [];
        const isContinent = addressComponents.length === 1 && 
                           addressComponents[0].types.includes('continent');
        
        if (isContinent) {
          alert("Please select a more specific location such as a city, county, or region. Continents are not allowed.");
          onClear();
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
    
    if (hasSelection && newValue !== selectedMeta.label) {
      onClear();
    }
  };

  const extractCityName = (label) => {
    if (!label) return null;
    // Extract city name from formatted address (e.g., "Nashville, TN, USA" -> "Nashville")
    const parts = label.split(',');
    if (parts.length > 0) {
      return parts[0].trim();
    }
    return label;
  };

  const handleGreaterAreaToggle = () => {
    if (!selectedMeta || !selectedMeta.label) return;
    
    const cityName = extractCityName(selectedMeta.label);
    const isAlreadyGreater = selectedMeta.label.startsWith("Greater ");
    
    if (isAlreadyGreater) {
      // Remove "Greater ... Area" and restore original
      const originalLabel = selectedMeta.originalLabel || selectedMeta.label.replace(/^Greater /, '').replace(/ Area$/, '');
      onSelect({
        ...selectedMeta,
        label: originalLabel,
        isGreaterArea: false,
        originalLabel: undefined
      });
    } else {
      // Add "Greater ... Area"
      onSelect({
        ...selectedMeta,
        label: `Greater ${cityName} Area`,
        isGreaterArea: true,
        originalLabel: selectedMeta.label
      });
    }
  };

  const isGreaterArea = selectedMeta?.isGreaterArea || false;

  return (
    <div className="space-y-4">
      <style>{`
        .pac-container {
          z-index: 9999 !important;
          border-radius: 12px !important;
          margin-top: 4px !important;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15) !important;
          border: 1px solid #e2e8f0 !important;
          font-family: inherit !important;
        }
        .pac-item {
          padding: 12px 16px !important;
          cursor: pointer !important;
          font-size: 14px !important;
          border-top: 1px solid #f1f5f9 !important;
        }
        .pac-item:first-child {
          border-top: none !important;
        }
        .pac-item:hover {
          background-color: #f8fafc !important;
        }
        .pac-item-selected {
          background-color: #eff6ff !important;
        }
        .pac-matched {
          font-weight: 600 !important;
          color: #2563eb !important;
        }
        .pac-icon {
          margin-right: 12px !important;
        }
      `}</style>

      <div 
        className="cursor-pointer"
        onClick={() => {
          if (onClick) {
            onClick();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-slate-900">
            {questionNumber}. What is your primary city of service or geological region of service?
          </span>
          {onInfoClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInfoClick();
              }}
              className="w-6 h-6 rounded-full border border-slate-300 hover:border-slate-400 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-all"
              aria-label="More information"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          )}
          {!isOpen && (
            <ChevronDown className="w-5 h-5 text-slate-400 ml-auto" />
          )}
        </div>
        {isOpen && (
          <span className="text-sm text-slate-500 italic mt-1 block">
            {isScriptLoaded 
              ? "Start typing a city or town name for best results" 
              : loadError 
              ? "Type your city, county, or region (continents not allowed)" 
              : "Loading location search..."}
          </span>
        )}
      </div>

      {isOpen && (
        <>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g., Nashville, TN or Davidson County, TN"
              value={hasSelection ? selectedMeta.label : value}
              onChange={handleInputChange}
              autoComplete="off"
              className="w-full p-4 pr-12 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <MapPin className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
          </div>

          {isScriptLoaded && !loadError && (
            <div className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
              💡 Best practice: Select a specific city or town. Broader selections (state/country) are less effective for local SEO.
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
        </>
      )}
    </div>
  );
}