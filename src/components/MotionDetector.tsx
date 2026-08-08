import type { MotionTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  motion: MotionTelemetry
}

/** Static terrain radar placeholder — awaits live sensor data in Phase 2. Nothing moves. */
function TerrainRadar() {
  return (
    <div className="border border-green mx-2 overflow-hidden">
      <svg
        viewBox="0 0 300 80"
        width="100%"
        height="80"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid — vertical */}
        {[75, 150, 225].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="80" stroke="#00ff66" strokeWidth="0.4" opacity="0.25" />
        ))}
        {/* Grid — horizontal */}
        {[26, 53].map((y) => (
          <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="#00ff66" strokeWidth="0.4" opacity="0.25" />
        ))}

        {/* Terrain profile — peaks right-of-centre, matching reference */}
        <polyline
          points="0,76 20,76 40,75 60,74 75,72 88,70 100,72 112,70 125,66 138,60 150,54 162,50 172,48 182,50 193,54 205,60 220,66 240,71 265,74 300,76"
          fill="none"
          stroke="#00ff66"
          strokeWidth="1.5"
        />

        {/* Rover — positioned on terrain peak at x≈172 (~57% of width) */}
        {/* Main body */}
        <rect x="159" y="34" width="26" height="11" fill="none" stroke="#00ff66" strokeWidth="1.2" />
        {/* Left wheel */}
        <rect x="155" y="41" width="6" height="4" fill="#00ff66" />
        {/* Right wheel */}
        <rect x="183" y="41" width="6" height="4" fill="#00ff66" />
        {/* Antenna mast */}
        <line x1="172" y1="34" x2="172" y2="28" stroke="#00ff66" strokeWidth="1" />
        {/* Antenna tip */}
        <rect x="170" y="26" width="4" height="2" fill="#00ff66" />

        {/* Downward sonar pulses from rover belly — static, nothing animates */}
        <path d="M 163,45 Q 172,53 181,45" fill="none" stroke="#00ff66" strokeWidth="0.9" opacity="0.65" />
        <path d="M 156,45 Q 172,62 188,45" fill="none" stroke="#00ff66" strokeWidth="0.9" opacity="0.45" />
        <path d="M 149,45 Q 172,74 195,45" fill="none" stroke="#00ff66" strokeWidth="0.9" opacity="0.25" />
      </svg>
    </div>
  )
}

export default function MotionDetector({ motion }: Props) {
  const level = motion.level ?? NA

  return (
    <div className="border border-green flex flex-col h-full">
      <div className="px-2 pt-[6px] pb-1 text-[11px] font-bold">MOTION DETECTOR</div>
      <hr className="border-t border-dashed border-green opacity-50 mx-2 mb-[6px]" />

      <div className="px-2 pb-2 flex-1">
        {/* STATE: VALUE on one line — label dim, value bright */}
        <div className="leading-[1.8] mb-3">
          <span className="text-green-dark">STATE: </span>
          <span className="font-bold">{level}</span>
        </div>

        <div className="text-[9px] font-bold tracking-widest mb-1">TERRAIN RADAR</div>
        <TerrainRadar />
      </div>

      <div className="px-2 py-1 border-t border-dashed border-green opacity-70 text-[10px]">
        LAST EVENT:{' '}
        {motion.lastEventSeconds !== null ? `T - ${motion.lastEventSeconds}` : NA}
      </div>
    </div>
  )
}
