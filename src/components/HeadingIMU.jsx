const NA = '--'

function getCompassDir(deg) {
  if (deg === null || deg === undefined) return NA
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

export default function HeadingIMU({ imu }) {
  const heading = imu.heading
  const pitch = imu.pitch
  const roll = imu.roll

  const headingStr = heading !== null ? String(Math.round(heading)).padStart(3, '0') + '°' : NA
  const dirStr = heading !== null ? getCompassDir(heading) : ''
  const pitchStr = pitch !== null ? `${pitch}°` : NA
  const rollStr = roll !== null ? `${roll}°` : NA

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">HEADING / IMU</div>
      <hr className="divider" />
      <div className="section-inner" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-around' }}>
        <div style={{ fontSize: '28px', fontWeight: 'bold', letterSpacing: '2px', textAlign: 'center', marginTop: '8px' }}>
          {headingStr} {dirStr}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '10px', textAlign: 'center', lineHeight: '1.6', marginTop: '8px' }}>
          <div>N</div>
          <div>|</div>
          <div>W-+-E</div>
          <div>|</div>
          <div>S</div>
        </div>
        <div style={{ fontSize: '10px', marginTop: '10px' }}>
          PITCH: {pitchStr} | ROLL: {rollStr}
        </div>
      </div>
    </div>
  )
}
