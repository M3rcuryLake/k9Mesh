const NA = '--'

export default function CSISurvivorDetection({ csi }) {
  const hasData = csi.breathingDetected !== null && csi.breathingDetected !== undefined

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">CSI SURVIVOR DETECTION</div>
      <hr className="divider" />

      <div className="section-inner" style={{ flex: 1 }}>


        {!hasData && (
          <div style={{ color: 'var(--green-dark)', lineHeight: '1.8' }}>WAITING FOR CSI DATA...</div>
        )}


        {hasData && csi.breathingDetected && (
          <div>
            <div style={{ marginBottom: '10px', fontWeight: 'bold', letterSpacing: '1px' }}>
              ■ BREATHING DETECTED
            </div>

            <div style={{ lineHeight: '1', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div style={{ color: 'var(--green-dark)', fontSize: '9px', marginBottom: '2px' }}>Estimated Rate</div>
                <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
                  {csi.breathingRate !== null ? `${csi.breathingRate} BPM` : NA}
                </div>
              </div>

              <div>
                <div style={{ color: 'var(--green-dark)', fontSize: '9px', marginBottom: '2px' }}>Confidence</div>
                <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
                  {/* Display raw value with up to 10 decimal places — UI does not calculate precision */}
                  {csi.confidence !== null
                    ? `${Number(csi.confidence).toFixed(10)} %`
                    : NA}
                </div>
              </div>

              <div>
                <div style={{ color: 'var(--green-dark)', fontSize: '9px', marginBottom: '2px' }}>State</div>
                <div style={{ fontWeight: 'bold', fontSize: '13px' }}>
                  {csi.state !== null ? csi.state : NA}
                </div>
              </div>
            </div>
          </div>
        )}


        {hasData && !csi.breathingDetected && (
          <div style={{ fontWeight: 'bold', letterSpacing: '1px' }}>
            □ NO BREATHING DETECTED
          </div>
        )}

      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderTop: '1px dashed var(--green)',
        opacity: 0.7,
        fontSize: '10px',
      }}>
        <span>CSI ARRAY: {csi.arrayOnline !== null ? (csi.arrayOnline ? 'ONLINE' : 'OFFLINE') : NA}</span>
        <span>{csi.calibrated !== null ? (csi.calibrated ? 'CALIBRATED' : 'UNCALIBRATED') : NA}</span>
      </div>
    </div>
  )
}
