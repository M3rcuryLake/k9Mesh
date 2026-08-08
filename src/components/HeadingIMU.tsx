import type { ImuTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  imu: ImuTelemetry
}

type CompassDir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

const DIRS: CompassDir[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function getDir(deg: number): CompassDir {
  return DIRS[Math.round(deg / 45) % 8]
}

/**
 * Returns a 5-element array of strings representing the ASCII compass art
 * with the marker (*) placed at the current heading direction.
 *
 * Layout (9 chars wide, centre at col 4):
 *   Line 0:  "    N    "
 *   Line 1:  "    |    "
 *   Line 2:  "W --+-- E"
 *   Line 3:  "    |    "
 *   Line 4:  "    S    "
 */
function compassArt(heading: number | null): string[] {
  const base = [
    '    N    ',
    '    |    ',
    'W --+-- E',
    '    |    ',
    '    S    ',
  ]

  if (heading === null) return base

  const dir = getDir(heading)

  // [lineIndex, colIndex] for each cardinal / intercardinal
  const markerPos: Record<CompassDir, [number, number]> = {
    N:  [0, 4],
    NE: [1, 8],
    E:  [2, 8],
    SE: [3, 8],
    S:  [4, 4],
    SW: [3, 0],
    W:  [2, 0],
    NW: [1, 0],
  }

  const [row, col] = markerPos[dir]
  const line = base[row]
  base[row] = line.slice(0, col) + '*' + line.slice(col + 1)
  return base
}

export default function HeadingIMU({ imu }: Props) {
  const { heading, pitch, roll } = imu

  const headingStr =
    heading !== null
      ? String(Math.round(heading)).padStart(3, '0') + '°'
      : NA
  const dirStr   = heading !== null ? getDir(heading) : ''
  const pitchStr = pitch !== null ? `${pitch}°` : NA
  const rollStr  = roll  !== null ? `${roll}°`  : NA

  const lines = compassArt(heading)

  return (
    <div className="border border-green flex flex-col h-full">
      <div className="px-2 pt-[6px] pb-1 text-[11px] font-bold">HEADING / IMU</div>
      <hr className="border-t border-dashed border-green opacity-50 mx-2 mb-[6px]" />

      <div className="px-2 pb-2 flex-1 flex flex-col items-center justify-around">

        {/* Heading readout */}
        <div className="text-[28px] font-bold tracking-[2px] text-center mt-2">
          {headingStr} {dirStr}
        </div>

        {/* ASCII compass */}
        <pre className="font-mono text-[10px] text-center leading-[1.6] mt-2">
          {lines.join('\n')}
        </pre>

        {/* Pitch / Roll */}
        <div className="text-[10px] mt-2">
          PITCH: {pitchStr} | ROLL: {rollStr}
        </div>

      </div>
    </div>
  )
}
