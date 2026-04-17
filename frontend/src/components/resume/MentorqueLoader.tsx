import React from "react";

interface MentorqueLoaderProps {
  size?: number;
  className?: string;
}

export function MentorqueLoader({ size = 54, className }: MentorqueLoaderProps) {
  const duration = "2s";

  return (
    <div
      className={className}
      style={
        {
          "--ml-size": `${size}px`,
          "--ml-duration": duration,
          "--ml-bg":
            "linear-gradient(0deg, rgba(30,64,175,0.22) 0%, rgba(59,130,246,0.20) 100%)",
        } as React.CSSProperties
      }
    >
      <style>{`
        @keyframes mentorque-ripple {
          0% { transform: scale(1); box-shadow: rgba(30, 64, 175, 0.30) 0px 6px 8px -2px; }
          50% { transform: scale(1.24); box-shadow: rgba(59, 130, 246, 0.30) 0px 16px 14px -6px; }
          100% { transform: scale(1); box-shadow: rgba(30, 64, 175, 0.30) 0px 6px 8px -2px; }
        }
      `}</style>

      <div
        className="relative"
        style={{ width: "var(--ml-size)", height: "var(--ml-size)" }}
      >
        {[40, 30, 20, 10, 0].map((inset, i) => (
          <div
            key={i}
            className="absolute rounded-full backdrop-blur-[4px]"
            style={{
              inset: `${inset}%`,
              zIndex: 100 - i,
              background: "var(--ml-bg)",
              borderTop: `1px solid rgba(125, 211, 252, ${1 - i * 0.18})`,
              animation: `mentorque-ripple var(--ml-duration) infinite ease-in-out`,
              animationDelay: `${i * 0.14}s`,
            }}
          />
        ))}

      </div>
    </div>
  );
}

