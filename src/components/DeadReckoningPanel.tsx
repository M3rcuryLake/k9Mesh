import { useRef } from 'react'
import type { GpsTelemetry, ImuTelemetry, OdometryTelemetry } from '../types/telemetry'

const NA = '--'
const GRID_W = 320
const GRID_H = 280
const CYAN = '#00e5ff'

// Compass helper
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
function getDir(deg: number): string {
  return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
}

interface Props {
  gps: GpsTelemetry
  imu: ImuTelemetry
  odometry: OdometryTelemetry
}

export default function DeadReckoningPanel({ gps, imu, odometry }: Props) {
  const hasFix = gps.latitude !== null && gps.longitude !== null
  const pathRef = useRef<{ lat: number; lon: number }[]>([])

  if (hasFix) {
    const last = pathRef.current[pathRef.current.length - 1]
    if (!last || last.lat !== gps.latitude || last.lon !== gps.longitude) {
      pathRef.current.push({ lat: gps.latitude!, lon: gps.longitude! })
      if (pathRef.current.length > 200) pathRef.current.shift()
    }
  }

  // Map lat/lon to SVG coords (relative to centroid of path)
  const path = pathRef.current
  const latValues = path.map(p => p.lat)
  const lonValues = path.map(p => p.lon)
  const latMid = latValues.length ? (Math.min(...latValues) + Math.max(...latValues)) / 2 : 0
  const lonMid = lonValues.length ? (Math.min(...lonValues) + Math.max(...lonValues)) / 2 : 0
  const scale = 50000 // pixels per degree (rough dead-reckoning scale)

  const toSvg = (lat: number, lon: number) => ({
    x: GRID_W / 2 + (lon - lonMid) * scale,
    y: GRID_H / 2 - (lat - latMid) * scale,
  })

  const svgPath = path.map(p => toSvg(p.lat, p.lon))
  const pathStr = svgPath.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
  const rover = hasFix ? toSvg(gps.latitude!, gps.longitude!) : { x: GRID_W / 2, y: GRID_H / 2 }

  const headingDeg = imu.heading !== null ? imu.heading : null
  const headingStr = headingDeg !== null ? `${String(Math.round(headingDeg)).padStart(3, '0')}°` : NA
  const dirStr = headingDeg !== null ? getDir(headingDeg) : ''
  const pitchStr = imu.pitch !== null ? `${imu.pitch.toFixed(1)}°` : NA
  const rollStr = imu.roll !== null ? `${imu.roll.toFixed(1)}°` : NA

  // Heading indicator arrow in compass cross
  const arrowAngle = headingDeg !== null ? (headingDeg * Math.PI) / 180 : null
  const arrowLen = 18

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      border: '1px solid var(--cyan-border)',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        borderBottom: '1px solid var(--cyan-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: '0.08em', color: 'var(--cyan)' }}>
          2D DEAD RECKONING
        </span>
        <span style={{ fontSize: 9, color: 'var(--cyan-label)', border: '1px solid var(--cyan-border)', padding: '1px 5px' }}>
          LOCALIZATION
        </span>
      </div>

      {/* Status line */}
      <div style={{ padding: '4px 8px', fontSize: 9, color: 'var(--cyan-label)', borderBottom: '1px solid var(--cyan-border)', flexShrink: 0 }}>
        {hasFix
          ? '■ DEAD RECKONING ACTIVE / SENSOR FUSION: GPS + IMU'
          : '■ DEAD RECKONING STANDBY / AWAITING FIX'}
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${GRID_W} ${GRID_H}`} preserveAspectRatio="xMidYMid meet">
          {/* Grid */}
          {Array.from({ length: 9 }, (_, i) => (i + 1) * GRID_W / 10).map(x => (
            <line key={`gv${x}`} x1={x} y1={0} x2={x} y2={GRID_H} stroke={CYAN} strokeWidth={0.3} opacity={0.08} />
          ))}
          {Array.from({ length: 7 }, (_, i) => (i + 1) * GRID_H / 8).map(y => (
            <line key={`gh${y}`} x1={0} y1={y} x2={GRID_W} y2={y} stroke={CYAN} strokeWidth={0.3} opacity={0.08} />
          ))}
          {/* Crosshair */}
          <line x1={GRID_W / 2} y1={0} x2={GRID_W / 2} y2={GRID_H} stroke={CYAN} strokeWidth={0.5} opacity={0.15} />
          <line x1={0} y1={GRID_H / 2} x2={GRID_W} y2={GRID_H / 2} stroke={CYAN} strokeWidth={0.5} opacity={0.15} />

          {/* Trajectory path */}
          {path.length > 1 && hasFix && (
            <path d={pathStr} fill="none" stroke={CYAN} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.6} />
          )}

          {/* Rover marker */}
          {hasFix ? (
            <g>
              <circle cx={rover.x} cy={rover.y} r={5} fill="none" stroke={CYAN} strokeWidth={1.5} />
              <circle cx={rover.x} cy={rover.y} r={2} fill={CYAN} />
              {arrowAngle !== null && (
                <line
                  x1={rover.x} y1={rover.y}
                  x2={rover.x + Math.sin(arrowAngle) * arrowLen}
                  y2={rover.y - Math.cos(arrowAngle) * arrowLen}
                  stroke={CYAN} strokeWidth={1.5}
                />
              )}
              <text x={rover.x + 8} y={rover.y - 6} fill={CYAN} fontSize={8} fontFamily="'Courier New', monospace">
                ROVER_LOC
              </text>
            </g>
          ) : (
            <text x={GRID_W / 2} y={GRID_H / 2} textAnchor="middle" dominantBaseline="middle"
              fill="var(--cyan-label)" fontSize={11} fontFamily="'Courier New', monospace">
              NO POSITION FIX
            </text>
          )}
        </svg>

        {/* Coordinate overlay */}
        <div style={{
          position: 'absolute',
          bottom: 4,
          left: 8,
          fontSize: 9,
          color: 'var(--text-mid)',
        }}>
          X: {gps.longitude !== null ? gps.longitude.toFixed(4) : NA}&nbsp;&nbsp;
          Y: {gps.latitude !== null ? gps.latitude.toFixed(4) : NA}
        </div>
      </div>

      {/* Bottom strip: Heading + IMU */}
      <div style={{
        display: 'flex',
        borderTop: '1px solid var(--cyan-border)',
        flexShrink: 0,
      }}>
        {/* Heading */}
        <div style={{
          flex: 1,
          padding: '5px 10px',
          borderRight: '1px solid var(--cyan-border)',
        }}>
          <div style={{ fontSize: 9, color: 'var(--cyan-label)' }}>HEADING</div>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--cyan)', letterSpacing: '0.04em' }}>
            {headingStr}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>{dirStr}</div>
        </div>

        {/* Compass cross */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 12px', borderRight: '1px solid var(--cyan-border)' }}>
          <svg width={44} height={44} viewBox="-22 -22 44 44">
            <line x1={0} y1={-18} x2={0} y2={18} stroke="var(--cyan)" strokeWidth={0.8} opacity={0.4} />
            <line x1={-18} y1={0} x2={18} y2={0} stroke="var(--cyan)" strokeWidth={0.8} opacity={0.4} />
            <text x={0} y={-20} textAnchor="middle" fill="var(--cyan-label)" fontSize={6} fontFamily="'Courier New', monospace">N</text>
            <text x={20} y={1} textAnchor="start" dominantBaseline="middle" fill="var(--cyan-label)" fontSize={6} fontFamily="'Courier New', monospace">E</text>
            {arrowAngle !== null && (
              <line
                x1={0} y1={0}
                x2={Math.sin(arrowAngle) * 15}
                y2={-Math.cos(arrowAngle) * 15}
                stroke="var(--cyan)" strokeWidth={1.5}
              />
            )}
            <circle cx={0} cy={0} r={2} fill="var(--cyan)" />
          </svg>
        </div>

        {/* IMU State */}
        <div style={{ flex: 1, padding: '5px 10px' }}>
          <div style={{ fontSize: 9, color: 'var(--cyan-label)', marginBottom: 3 }}>IMU STATE</div>
          <div style={{ fontSize: 10 }}>
            <span style={{ color: 'var(--cyan-label)' }}>P: </span>
            <span style={{ color: 'var(--cyan)' }}>{pitchStr}</span>
            <span style={{ color: 'var(--cyan-label)', marginLeft: 6 }}>R: </span>
            <span style={{ color: 'var(--cyan)' }}>{rollStr}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
