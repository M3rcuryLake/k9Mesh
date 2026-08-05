const NA = '--'

function MotorRow({ label, rpm }) {
  return (
    <div style={{ lineHeight: '2' }}>
      {label}: {rpm !== null && rpm !== undefined ? `${rpm} RPM` : NA}
    </div>
  )
}

export default function Odometry({ odometry }) {
  const { speed, distance, motors } = odometry

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">ODOMETRY</div>
      <hr className="divider" />
      <div className="section-inner" style={{ flex: 1, lineHeight: '2' }}>
        <div>SPEED: {speed !== null ? `${speed} M/S` : NA}</div>
        <div>DIST: {distance !== null ? `${distance} M` : NA}</div>
        <div style={{ marginTop: '4px' }}>MOTORS:</div>
        <hr className="divider" style={{ margin: '2px 0 4px 0' }} />
        <MotorRow label="FL" rpm={motors.FL} />
        <MotorRow label="FR" rpm={motors.FR} />
        <MotorRow label="RL" rpm={motors.RL} />
        <MotorRow label="RR" rpm={motors.RR} />
      </div>
    </div>
  )
}
