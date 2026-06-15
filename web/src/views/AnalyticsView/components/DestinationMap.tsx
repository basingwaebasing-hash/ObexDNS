import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import {
  ComposableMap,
  ZoomableGroup,
  Geographies,
  Geography,
  createCoordinates,
  createTranslateExtent,
} from "@vnedyalk0v/react19-simple-maps";
import { getFlagEmoji } from "../utils";
import { numericToAlpha2 } from "../countryMapping";

interface DestinationItem {
  dest_geoip: string;
  count: number;
}

interface DestinationMapProps {
  destinations: DestinationItem[];
}

export const DestinationMap: React.FC<DestinationMapProps> = ({ destinations }) => {
  const { t } = useTranslation();
  const [geographyData, setGeographyData] = useState<any>(null);
  const [position, setPosition] = useState({ coordinates: createCoordinates(0, 0), zoom: 1 });
  const [hoveredCountry, setHoveredCountry] = useState<{
    name: string;
    code: string;
    count: number;
    flag: string;
    x: number;
    y: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/world-110m.json")
      .then((r) => r.json())
      .then((data) => setGeographyData(data))
      .catch((e) => console.error("Failed to load map topology", e));
  }, []);

  const totalQueriesCount = useMemo(() => {
    return destinations.reduce((acc, d) => acc + d.count, 0);
  }, [destinations]);

  const scaleConfig = useMemo(() => {
    if (totalQueriesCount <= 0) {
      return { maxThreshold: 10, step: 1 };
    }
    if (totalQueriesCount <= 1000) {
      return { maxThreshold: 100, step: 10 };
    }
    const power = Math.floor(Math.log10(totalQueriesCount));
    const maxThreshold = Math.pow(10, power);
    const step = maxThreshold / 10;
    return { maxThreshold, step };
  }, [totalQueriesCount]);

  const destinationMap = useMemo(() => {
    const map: Record<string, { count: number; name: string; countryCode: string }> = {};
    destinations.forEach((d) => {
      try {
        const geo = JSON.parse(d.dest_geoip);
        if (geo && geo.country_code) {
          const code = geo.country_code.toUpperCase();
          map[code] = {
            count: d.count,
            name: geo.country,
            countryCode: code
          };
        }
      } catch (e) {
        console.error("Failed to parse dest_geoip", e);
      }
    });
    return map;
  }, [destinations]);

  const bounds = useMemo(() => {
    return createTranslateExtent(
      createCoordinates(-100, -50),
      createCoordinates(900, 450)
    );
  }, []);

  const getLevel = (count: number) => {
    if (!count || count <= 0) return 0;
    return Math.min(10, Math.floor(count / scaleConfig.step) + 1);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      const v = num / 1000000;
      return Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`;
    }
    if (num >= 1000) {
      const v = num / 1000;
      return Number.isInteger(v) ? `${v}K` : `${v.toFixed(1)}K`;
    }
    return num.toString();
  };

  const handleZoomIn = () => {
    if (position.zoom >= 8) return;
    setPosition((pos) => ({ ...pos, zoom: pos.zoom * 1.5 }));
  };

  const handleZoomOut = () => {
    if (position.zoom <= 1) return;
    setPosition((pos) => ({ ...pos, zoom: pos.zoom / 1.5 }));
  };

  const handleReset = () => {
    setPosition({ coordinates: createCoordinates(0, 0), zoom: 1 });
  };

  return (
    <div className="relative w-full h-[400px] mt-4 bg-gray-50 dark:bg-slate-950 rounded-xl overflow-hidden border border-gray-100 dark:border-slate-800 flex flex-col justify-between shadow-sm">
      {/* Map wrapper */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 overflow-hidden select-none cursor-grab active:cursor-grabbing"
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as SVGElement).tagName === "svg") {
            setHoveredCountry(null);
          }
        }}
      >
        <ComposableMap
          projection="geoEqualEarth"
          width={800}
          height={400}
          style={{ width: "100%", height: "100%" }}
        >
          <ZoomableGroup
            zoom={position.zoom}
            center={position.coordinates}
            onMoveEnd={(pos) => setPosition({ coordinates: createCoordinates(pos.coordinates[0], pos.coordinates[1]), zoom: pos.zoom })}
            maxZoom={8}
            minZoom={1}
            enablePan={true}
            translateExtent={bounds}
          >
            {geographyData && (
              <Geographies geography={geographyData}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const countryCode = numericToAlpha2[geo.id];
                    const dest = countryCode ? destinationMap[countryCode] : null;
                    const count = dest?.count || 0;
                    const fillLevel = getLevel(count);

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onMouseEnter={(event) => {
                          if (!countryCode) return;
                          const name = dest?.name || geo.properties.name;
                          const flag = getFlagEmoji(countryCode);
                          const containerRect = containerRef.current?.getBoundingClientRect();
                          const x = event.clientX - (containerRect?.left || 0);
                          const y = event.clientY - (containerRect?.top || 0) - 15;
                          setHoveredCountry({
                            name,
                            code: countryCode,
                            count,
                            flag,
                            x,
                            y,
                          });
                        }}
                        onMouseMove={(event) => {
                          const containerRect = containerRef.current?.getBoundingClientRect();
                          const x = event.clientX - (containerRect?.left || 0);
                          const y = event.clientY - (containerRect?.top || 0) - 15;
                          setHoveredCountry((prev) => (prev ? { ...prev, x, y } : null));
                        }}
                        onMouseLeave={() => {
                          setHoveredCountry(null);
                        }}
                        onClick={(event) => {
                          if (!countryCode) return;
                          const name = dest?.name || geo.properties.name;
                          const flag = getFlagEmoji(countryCode);
                          const containerRect = containerRef.current?.getBoundingClientRect();
                          const x = event.clientX - (containerRect?.left || 0);
                          const y = event.clientY - (containerRect?.top || 0) - 15;
                          setHoveredCountry({
                            name,
                            code: countryCode,
                            count,
                            flag,
                            x,
                            y,
                          });
                        }}
                        style={{
                          default: {
                            fill: `var(--map-color-${fillLevel})`,
                            stroke: "var(--map-stroke)",
                            strokeWidth: 0.5,
                            outline: "none",
                            transition: "fill 250ms, stroke 250ms",
                          },
                          hover: {
                            fill: "var(--map-hover)",
                            stroke: "var(--map-stroke)",
                            strokeWidth: 0.5,
                            outline: "none",
                            cursor: "pointer",
                          },
                          pressed: {
                            fill: "var(--map-hover)",
                            stroke: "var(--map-stroke)",
                            strokeWidth: 0.5,
                            outline: "none",
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            )}
          </ZoomableGroup>
        </ComposableMap>

        {/* Tooltip */}
        {hoveredCountry && (
          <div
            className="absolute pointer-events-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-xl border border-gray-200/50 dark:border-slate-800/50 text-xs z-50 flex flex-col gap-1 transition-all duration-75 text-gray-900 dark:text-gray-100"
            style={{
              left: `${hoveredCountry.x}px`,
              top: `${hoveredCountry.y}px`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="flex items-center gap-1.5 font-semibold whitespace-nowrap">
              <span className="text-sm">{hoveredCountry.flag}</span>
              <span>{hoveredCountry.name}</span>
            </div>
            <div className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {hoveredCountry.count.toLocaleString()} {t("analytics.queries")}
            </div>
          </div>
        )}
      </div>

      {/* Zoom Controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md p-1.5 rounded-lg border border-gray-200/50 dark:border-slate-800/50 shadow-sm z-10">
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
          title="Reset Zoom"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md p-2 rounded-lg border border-gray-200/50 dark:border-slate-800/50 shadow-sm z-10 max-w-[280px]">
        <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("analytics.queries")}</span>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 11 }).map((_, i) => (
            <div
              key={i}
              className="w-4 h-2.5 rounded-sm border border-black/5 dark:border-white/5"
              style={{ backgroundColor: `var(--map-color-${i})` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-semibold px-0.5">
          <span>0</span>
          <span>{formatNumber(scaleConfig.maxThreshold / 2)}</span>
          <span>{formatNumber(scaleConfig.maxThreshold)}+</span>
        </div>
      </div>
    </div>
  );
};
