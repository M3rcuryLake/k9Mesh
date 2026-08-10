import React, { useMemo } from 'react';
import type { MlTelemetry } from '../types/telemetry';

interface MlClassificationPanelProps {
  ml: MlTelemetry;
}

export default function MlClassificationPanel({ ml }: MlClassificationPanelProps) {
  const isAvailable = ml.ready !== false && (ml.classification !== null || ml.score !== null || ml.motion !== null);

  // Helper to map `t` [0..1] to a color from yellow -> orange -> red
  const getIntensityColor = (t: number) => {
    // clamp t between 0 and 1
    const val = Math.min(1, Math.max(0, t));
    
    // RGB interpolation:
    // LOW (0.0): Yellow (255, 255, 0)
    // HIGH (1.0): Red (255, 0, 0)
    const r = 255;
    const g = Math.floor(255 * (1 - val));
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  };

  const scoreText = ml.score !== null ? ml.score.toFixed(2) : '--';
  
  let motionText = '--';
  if (ml.motion === true) motionText = 'TRUE';
  else if (ml.motion === false) motionText = 'FALSE';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        border: '1px solid var(--cyan)',
        background: 'rgba(0, 18, 25, 0.6)',
        position: 'relative',
        padding: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--cyan)', paddingBottom: 4, marginBottom: 8 }}>
        <span style={{ fontWeight: 'bold' }}>ML CLASSIFICATION</span>
        <span>
          SCORE: <span style={{ color: 'var(--yellow)', marginLeft: 4 }}>{scoreText}</span>
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!isAvailable ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0, 255, 255, 0.4)' }}>
            DATA UNAVAILABLE
          </div>
        ) : (
          <div style={{ flex: 1, position: 'relative', border: '1px dashed rgba(0, 255, 255, 0.3)' }}>
            <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
              {/* Grid lines */}
              <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(0, 255, 255, 0.1)" strokeWidth="1" />
              <line x1="50%" y1="0" x2="50%" y2="100%" stroke="rgba(0, 255, 255, 0.1)" strokeWidth="1" />
              
              {/* Plot points */}
              {ml.classification?.map((pt, i) => (
                <circle
                  key={i}
                  cx={`${pt.x * 100}%`}
                  cy={`${(1 - pt.y) * 100}%`} // Assuming y=0 is bottom, SVG y=0 is top
                  r="3"
                  fill={getIntensityColor(pt.t)}
                  opacity="0.8"
                />
              ))}
            </svg>
            
            <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 10, color: 'var(--cyan)' }}>
              x/y classification space
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, paddingTop: 4, borderTop: '1px solid rgba(0, 255, 255, 0.3)', display: 'flex', justifyContent: 'space-between' }}>
        <span>
          MOTION: <span style={{ color: ml.motion ? 'var(--alert)' : 'var(--cyan)' }}>{motionText}</span>
        </span>
        
        {/* Intensity Legend */}
        {isAvailable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
            <span>LOW</span>
            <div style={{ width: 40, height: 8, background: 'linear-gradient(to right, rgb(255,255,0), rgb(255,0,0))' }} />
            <span>HIGH</span>
          </div>
        )}
      </div>
    </div>
  );
}
