/**
 * Sign-in backdrop: deep midnight navy with slow, translucent, flowing ribbons in electric blue, cyan and aqua,
 * a few soft light pools and a faint highlight edge on each ribbon. Pure inline SVG and CSS, so it works offline
 * and ships with the app; nothing is fetched. Only transform and opacity animate, on three groups, very slowly.
 * Reduced and Off motion, a slow GPU (Lite) and High contrast each tone it down or hide it, see the .scene3d rules
 * in login.css. (The component keeps its old name and test id so imports and tests stay stable.)
 */
export function Scene3D() {
  return (
    <div className="scene3d" aria-hidden="true" data-testid="scene3d">
      <div className="s3-glow a" />
      <div className="s3-glow b" />
      <div className="s3-glow c" />
      <svg className="s3-art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="s3-g1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1d4ed8" stopOpacity="0.00" />
            <stop offset="0.35" stopColor="#2563eb" stopOpacity="0.43" />
            <stop offset="0.7" stopColor="#22d3ee" stopOpacity="0.39" />
            <stop offset="1" stopColor="#2dd4bf" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="s3-g2" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#06b6d4" stopOpacity="0.04" />
            <stop offset="0.45" stopColor="#0ea5e9" stopOpacity="0.35" />
            <stop offset="1" stopColor="#1e3a8a" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="s3-g3" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#14b8a6" stopOpacity="0.00" />
            <stop offset="0.5" stopColor="#22d3ee" stopOpacity="0.30" />
            <stop offset="1" stopColor="#3b82f6" stopOpacity="0.23" />
          </linearGradient>
          <linearGradient id="s3-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#a5f3fc" stopOpacity="0" />
            <stop offset="0.5" stopColor="#a5f3fc" stopOpacity="0.55" />
            <stop offset="1" stopColor="#a5f3fc" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="s3-ribbon r1">
          <path d="M-120 700 C 140 520, 330 760, 620 600 S 1080 250, 1720 330 L 1720 520 C 1180 450, 940 740, 620 820 S 160 940, -120 880 Z" fill="url(#s3-g1)" />
          <path d="M-120 700 C 140 520, 330 760, 620 600 S 1080 250, 1720 330" fill="none" stroke="url(#s3-edge)" strokeWidth="1.5" />
        </g>
        <g className="s3-ribbon r2">
          <path d="M-100 160 C 200 40, 420 300, 760 210 S 1250 -40, 1700 120 L 1700 300 C 1260 190, 1000 450, 740 410 S 220 250, -100 330 Z" fill="url(#s3-g2)" />
          <path d="M-100 160 C 200 40, 420 300, 760 210 S 1250 -40, 1700 120" fill="none" stroke="url(#s3-edge)" strokeWidth="1.5" />
        </g>
        <g className="s3-ribbon r3">
          <path d="M900 980 C 1000 720, 1240 640, 1420 470 S 1640 170, 1720 90 L 1720 330 C 1600 430, 1500 640, 1300 760 S 1060 960, 900 980 Z" fill="url(#s3-g3)" />
          <path d="M900 980 C 1000 720, 1240 640, 1420 470 S 1640 170, 1720 90" fill="none" stroke="url(#s3-edge)" strokeWidth="1.5" />
        </g>
      </svg>
      <div className="s3-vignette" />
    </div>
  );
}
