const NA = '--'

const LEVEL_LABELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
}

export default function MotionDetector({ motion }) {
  const level = motion.level !== null && motion.level !== undefined
    ? (LEVEL_LABELS[motion.level] ?? motion.level)
    : null

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">MOTION DETECTOR</div>
      <hr className="divider" />
      <div className="section-inner" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
        <div style={{ color: '#004422', fontSize: '9px', marginBottom: '6px' }}>Motion</div>
        <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '2px' }}>
          {level !== null ? level : NA}
        </div>
      </div>
      <div style={{ padding: '4px 8px', borderTop: '1px dashed var(--green)', opacity: 0.7, fontSize: '10px' }}>
        LAST EVENT: {motion.lastEventSeconds !== null ? `T - ${motion.lastEventSeconds}S` : NA}
      </div>
    </div>
  )
}
