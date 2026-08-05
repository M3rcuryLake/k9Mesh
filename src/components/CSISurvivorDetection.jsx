const NA = '--'

export default function CSISurvivorDetection({ csi }) {
  const hasData = csi.breathingDetected !== null && csi.breathingDetected !== undefined

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">CSI SURVIVOR DETECTION</div>
      <hr className="divider" />
      <div className="section-inner" style={{ flex: 1 }}>

        {!hasData && (
          <div style={{ color: '#004422', marginBottom: '12px', lineHeight: '1.8' }}>WAITING...</div>
        )}

        {hasData && csi.breathingDetected && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ marginBottom: '8px' }}>🟢 Breathing Detected</div>
            <div style={{ lineHeight: '2.2' }}>
              <div style={{ color: '#004422', fontSize: '9px' }}>Estimated Rate</div>
              <div style={{ fontWeight: 'bold' }}>{csi.breathingRate !== null ? `${csi.breathingRate} BPM` : NA}</div>

              <div style={{ color: '#004422', fontSize: '9px', marginTop: '4px' }}>Confidence</div>
              <div style={{ fontWeight: 'bold' }}>{csi.confidence !== null ? `${csi.confidence}%` : NA}</div>

              <div style={{ color: '#004422', fontSize: '9px', marginTop: '4px' }}>State</div>
              <div style={{ fontWeight: 'bold' }}>{csi.state !== null ? csi.state : NA}</div>
            </div>
          </div>
        )}

        {hasData && !csi.breathingDetected && (
          <div style={{ marginBottom: '12px', color: '#00ff66' }}>⬛ No Breathing Detected</div>
        )}

      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderTop: '1px dashed var(--green)', opacity: 0.7, fontSize: '10px' }}>
        <span>CSI ARRAY: {csi.arrayOnline !== null ? (csi.arrayOnline ? 'ONLINE' : 'OFFLINE') : NA}</span>
        <span>{csi.calibrated !== null ? (csi.calibrated ? 'CALIBRATED' : 'UNCALIBRATED') : NA}</span>
      </div>
    </div>
  )
}
