import type { OdometryTelemetry } from '../types/telemetry'

const NA = '--'

interface Props {
  odometry: OdometryTelemetry
}

function MotorRow({ label, rpm }: { label: string; rpm: number | null }) {
  return (
    <div className="leading-[2]">
      {label}: {rpm !== null ? `${rpm} RPM` : NA}
    </div>
  )
}

export default function Odometry({ odometry }: Props) {
  const { speed, distance, motors } = odometry

  return (
    <div className="border border-green flex flex-col h-full">
      <div className="px-2 pt-[6px] pb-1 text-[11px] font-bold">ODOMETRY</div>
      <hr className="border-t border-dashed border-green opacity-50 mx-2 mb-[6px]" />

      <div className="px-2 pb-2 flex-1 leading-[2]">
        <div>SPEED: {speed !== null ? `${speed} M/S` : NA}</div>
        <div>DIST: {distance !== null ? `${distance} M` : NA}</div>

        <div className="mt-1">MOTORS:</div>
        <hr className="border-t border-dashed border-green opacity-50 my-1" />

        <MotorRow label="FL" rpm={motors.FL} />
        <MotorRow label="FR" rpm={motors.FR} />
        <MotorRow label="RL" rpm={motors.RL} />
        <MotorRow label="RR" rpm={motors.RR} />
      </div>
    </div>
  )
}
