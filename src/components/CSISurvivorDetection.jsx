const NA = '--'

export default function CSISurvivorDetection({ csi }) {
  const hasData = csi.breathingDetected !== null && csi.breathingDetected !== undefined

  const terminalRow = {
    display: 'flex',
    alignItems: 'baseline',
    marginBottom: '6px',
    letterSpacing: '0.5px',
  }

  const label = {
    color: 'var(--green-dark)',
    marginRight: '6px',
    flexShrink: 0,
  }

  const value = {
    fontWeight: 'bold',
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-title">CSI SURVIVOR DETECTION</div>
      <hr className="divider" />

      <div className="section-inner" style={{ flex: 1 }}>

        {!hasData && (
          <div style={{ color: 'var(--green-dark)', lineHeight: '1.8' }}>WAITING FOR CSI DATA...</div>
        )}

        {hasData && (
          <div style={{ lineHeight: '1.8' }}>

            {/* Breathing status — value comes directly from telemetry, no frontend inference */}
            <div style={{ ...terminalRow, marginBottom: '10px', fontWeight: 'bold' }}>
              <span style={label}>&gt;</span>
              <span style={value}>
                {csi.breathingDetected ? 'BREATHING DETECTED' : 'NO BREATHING DETECTED'}
              </span>
            </div>

            {csi.breathingDetected && (
              <>
                <div style={terminalRow}>
                  <span style={label}>&gt; ESTIMATED RATE:</span>
                  <span style={value}>
                    {csi.breathingRate !== null && csi.breathingRate !== undefined
                      ? `${csi.breathingRate} BPM`
                      : NA}
                  </span>
                </div>

                <div style={terminalRow}>
                  <span style={label}>&gt; CONFIDENCE:</span>
                  <span style={value}>
                    {/* Render raw telemetry string — UI never rounds or truncates */}
                    {csi.confidence !== null && csi.confidence !== undefined
                      ? `${csi.confidence}%`
                      : NA}
                  </span>
                </div>

                <div style={terminalRow}>
                  <span style={label}>&gt; STATE:</span>
                  <span style={value}>
                    {csi.state !== null && csi.state !== undefined ? csi.state : NA}
                  </span>
                </div>
              </>
            )}

          </div>
        )}

      </div>

      {/* Footer — static placeholders; values (OFFLINE, CALIBRATING, FAULT, DEGRADED) set by telemetry later */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderTop: '1px dashed var(--green)',
        opacity: 0.7,
        fontSize: '10px',
        letterSpacing: '0.5px',
      }}>
        <span>CSI ARRAY: ONLINE</span>
        <span>CALIBRATED</span>
      </div>
    </div>
  )
}
