import { useEffect, useRef, useState } from 'react';

interface CoinData {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  rotY: number;
  rotSpeedY: number;
  wobble: number;
  scale: number;
}

interface Spark {
  id: number;
  x: number;
  y: number;
  scale: number;
  alpha: number;
}

export function InteractiveWalletCoins() {
  const containerRef = useRef<HTMLDivElement>(null);
  const coinsRef = useRef<CoinData[]>([
    { id: 0, x: 145, y: 110, vx: 0.45, vy: -0.35, radius: 44, mass: 1.6, rotY: 15, rotSpeedY: 0.8, wobble: 0, scale: 1 },
    { id: 1, x: 55, y: 70, vx: -0.4, vy: 0.45, radius: 36, mass: 1.1, rotY: -25, rotSpeedY: -1.0, wobble: 0, scale: 1 },
    { id: 2, x: 165, y: 195, vx: 0.4, vy: 0.35, radius: 28, mass: 0.75, rotY: 40, rotSpeedY: 1.3, wobble: 0, scale: 1 },
  ]);

  const [renderTicks, setRenderTicks] = useState(0);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const draggingId = useRef<number | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastPointerPos = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 });
  const pointerSpeed = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const animFrameId = useRef<number | 0>(0);
  const sparksRef = useRef<Spark[]>([]);

  useEffect(() => {
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
      lastTime = currentTime;

      const container = containerRef.current;
      const bounds = container ? container.getBoundingClientRect() : { width: 240, height: 260 };
      const w = bounds.width > 0 ? bounds.width : 240;
      const h = bounds.height > 0 ? bounds.height : 260;

      const coins = coinsRef.current;

      // 1. Update positions & natural floating
      for (const coin of coins) {
        if (draggingId.current === coin.id) continue;

        coin.x += coin.vx;
        coin.y += coin.vy;

        // Gentle rotational progression
        coin.rotY = (coin.rotY + coin.rotSpeedY) % 360;

        // Dampen wobble
        if (coin.wobble > 0) {
          coin.wobble = Math.max(0, coin.wobble - dt * 2.5);
        }

        // Clamp speed
        const speed = Math.hypot(coin.vx, coin.vy);
        const minSpeed = 0.35;
        const maxSpeed = 2.0;
        if (speed < minSpeed && speed > 0.01) {
          coin.vx = (coin.vx / speed) * minSpeed;
          coin.vy = (coin.vy / speed) * minSpeed;
        } else if (speed > maxSpeed) {
          coin.vx = (coin.vx / speed) * maxSpeed;
          coin.vy = (coin.vy / speed) * maxSpeed;
        }

        // Boundary bounce (walls)
        const pad = 4;
        if (coin.x - coin.radius < pad) {
          coin.x = coin.radius + pad;
          coin.vx = Math.abs(coin.vx) * 0.92;
          coin.rotSpeedY = -coin.rotSpeedY * 0.9 + (Math.random() - 0.5) * 1.5;
        } else if (coin.x + coin.radius > w - pad) {
          coin.x = w - pad - coin.radius;
          coin.vx = -Math.abs(coin.vx) * 0.92;
          coin.rotSpeedY = -coin.rotSpeedY * 0.9 + (Math.random() - 0.5) * 1.5;
        }

        if (coin.y - coin.radius < pad) {
          coin.y = coin.radius + pad;
          coin.vy = Math.abs(coin.vy) * 0.92;
        } else if (coin.y + coin.radius > h - pad) {
          coin.y = h - pad - coin.radius;
          coin.vy = -Math.abs(coin.vy) * 0.92;
        }
      }

      // 2. Inter-coin elastic collision & bounce physics
      for (let i = 0; i < coins.length; i++) {
        for (let j = i + 1; j < coins.length; j++) {
          const c1 = coins[i]!;
          const c2 = coins[j]!;

          const dx = c2.x - c1.x;
          const dy = c2.y - c1.y;
          const dist = Math.hypot(dx, dy);
          const minDist = c1.radius + c2.radius;

          if (dist < minDist && dist > 0.001) {
            // Normal collision vector
            const nx = dx / dist;
            const ny = dy / dist;

            // Relative velocity
            const kx = c1.vx - c2.vx;
            const ky = c1.vy - c2.vy;
            const vn = nx * kx + ny * ky;

            // Only bounce if moving towards each other
            if (vn > 0) {
              const restitution = 0.96; // bouncy elasticity
              const impulse = ((1 + restitution) * vn) / (c1.mass + c2.mass);

              if (draggingId.current !== c1.id) {
                c1.vx -= (impulse * c2.mass) * nx;
                c1.vy -= (impulse * c2.mass) * ny;
                c1.rotSpeedY = -c1.rotSpeedY * 0.8 + (Math.random() - 0.5) * 2.5;
                c1.wobble = 1.0;
              }
              if (draggingId.current !== c2.id) {
                c2.vx += (impulse * c1.mass) * nx;
                c2.vy += (impulse * c1.mass) * ny;
                c2.rotSpeedY = -c2.rotSpeedY * 0.8 + (Math.random() - 0.5) * 2.5;
                c2.wobble = 1.0;
              }

              // Positional separation to prevent clipping
              const overlap = minDist - dist;
              const sepX = nx * (overlap * 0.52);
              const sepY = ny * (overlap * 0.52);
              if (draggingId.current !== c1.id) {
                c1.x -= sepX;
                c1.y -= sepY;
              }
              if (draggingId.current !== c2.id) {
                c2.x += sepX;
                c2.y += sepY;
              }

              // Spawn contact flash spark
              const midX = (c1.x + c2.x) / 2;
              const midY = (c1.y + c2.y) / 2;
              if (sparksRef.current.length < 8) {
                sparksRef.current.push({
                  id: Math.random(),
                  x: midX,
                  y: midY,
                  scale: 0.6 + Math.random() * 0.6,
                  alpha: 1.0,
                });
              }
            }
          }
        }
      }

      // 3. Update sparks
      if (sparksRef.current.length > 0) {
        sparksRef.current = sparksRef.current
          .map(s => ({ ...s, alpha: s.alpha - dt * 3.5, scale: s.scale + dt * 1.5 }))
          .filter(s => s.alpha > 0);
        setSparks([...sparksRef.current]);
      }

      setRenderTicks(t => (t + 1) % 100000);
      animFrameId.current = requestAnimationFrame(loop);
    };

    animFrameId.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameId.current);
  }, []);

  // Pointer interactions (drag, toss, poke)
  const handlePointerDown = (id: number, e: React.PointerEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const coin = coinsRef.current.find(c => c.id === id);
    if (!coin) return;

    draggingId.current = id;
    dragOffset.current = { x: px - coin.x, y: py - coin.y };
    lastPointerPos.current = { x: px, y: py, time: performance.now() };
    pointerSpeed.current = { vx: 0, vy: 0 };

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingId.current === null) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const now = performance.now();

    const coin = coinsRef.current.find(c => c.id === draggingId.current);
    if (coin) {
      coin.x = px - dragOffset.current.x;
      coin.y = py - dragOffset.current.y;

      const dt = (now - lastPointerPos.current.time) / 1000;
      if (dt > 0.005) {
        pointerSpeed.current = {
          vx: (px - lastPointerPos.current.x) * 0.08,
          vy: (py - lastPointerPos.current.y) * 0.08,
        };
      }
      lastPointerPos.current = { x: px, y: py, time: now };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId.current !== null) {
      const coin = coinsRef.current.find(c => c.id === draggingId.current);
      if (coin) {
        // Fling with release velocity
        coin.vx = Math.max(-2.5, Math.min(2.5, pointerSpeed.current.vx));
        coin.vy = Math.max(-2.5, Math.min(2.5, pointerSpeed.current.vy));
        coin.rotSpeedY += (pointerSpeed.current.vx + pointerSpeed.current.vy) * 0.8;
      }
      draggingId.current = null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="wallet-coins-interactive"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label="Interactive 3D Bouncing Tcoins"
      title="Drag or poke the coins!"
    >
      {/* Contact Collision Sparks */}
      {sparks.map(s => (
        <span
          key={s.id}
          className="coin-spark-hit"
          style={{
            left: s.x,
            top: s.y,
            opacity: s.alpha,
            transform: `translate(-50%, -50%) scale(${s.scale})`,
          }}
        >
          ✦
        </span>
      ))}

      {/* 3 Physical Bouncing Coins */}
      {coinsRef.current.map(coin => {
        const size = coin.radius * 2;
        const wobbleX = Math.sin(coin.wobble * Math.PI * 4) * 6;
        const wobbleScale = 1 + Math.sin(coin.wobble * Math.PI * 4) * 0.08;

        return (
          <div
            key={coin.id}
            className="dynamic-coin-item"
            style={{
              width: size,
              height: size,
              left: coin.x,
              top: coin.y,
              transform: `translate(-50%, -50%) rotateY(${coin.rotY}deg) rotateX(${16 + wobbleX}deg) scale(${wobbleScale})`,
              zIndex: Math.round(coin.radius + (Math.sin((coin.rotY * Math.PI) / 180) * 10)),
              cursor: draggingId.current === coin.id ? 'grabbing' : 'grab',
            }}
            onPointerDown={e => handlePointerDown(coin.id, e)}
          >
            {/* Dynamic Coin Ambient Drop Shadow */}
            <span
              className="dynamic-coin-shadow"
              style={{
                width: size * 0.85,
                height: size * 0.28,
                bottom: -size * 0.12,
                transform: `translateX(-50%) rotateY(${-coin.rotY}deg)`,
              }}
            />

            {/* 3D Realistic Gold Coin SVG Artwork */}
            <div className="dynamic-coin-art">
              <CoinSvg size={size} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CoinSvg({ size }: { size: number }) {
  const idPrefix = `c-${Math.round(size)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="coin-svg"
      style={{
        display: 'block',
        overflow: 'visible',
        filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.55)) drop-shadow(0 0 16px rgba(245,192,55,0.3))',
      }}
    >
      <defs>
        {/* Outer Rim Gold Gradient */}
        <linearGradient id={`${idPrefix}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff9bf" />
          <stop offset="22%" stopColor="#f7c844" />
          <stop offset="50%" stopColor="#b57e10" />
          <stop offset="78%" stopColor="#6e4600" />
          <stop offset="100%" stopColor="#f7c844" />
        </linearGradient>

        {/* Coin Center Face Radial Gradient */}
        <radialGradient id={`${idPrefix}-face`} cx="38%" cy="32%" r="66%">
          <stop offset="0%" stopColor="#fff6be" />
          <stop offset="28%" stopColor="#f7c844" />
          <stop offset="65%" stopColor="#c78e12" />
          <stop offset="90%" stopColor="#7a4c00" />
          <stop offset="100%" stopColor="#4a2c00" />
        </radialGradient>

        {/* Ambient Violet/Purple Theme Glow along Bottom/Right Edge */}
        <linearGradient id={`${idPrefix}-purple`} x1="100%" y1="100%" x2="10%" y2="10%">
          <stop offset="0%" stopColor="#d8b4fe" stopOpacity="0.85" />
          <stop offset="35%" stopColor="#a855f7" stopOpacity="0.45" />
          <stop offset="70%" stopColor="transparent" stopOpacity="0" />
        </linearGradient>

        {/* Embossed Letter 3D Gradient */}
        <linearGradient id={`${idPrefix}-letter`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fffad4" />
          <stop offset="35%" stopColor="#ffd859" />
          <stop offset="80%" stopColor="#c4870c" />
          <stop offset="100%" stopColor="#693e00" />
        </linearGradient>

        {/* Deep 3D Chamfer Filter */}
        <filter id={`${idPrefix}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1.4" dy="2.2" stdDeviation="1.2" floodColor="#291500" floodOpacity="0.95" />
          <feDropShadow dx="-0.6" dy="-0.6" stdDeviation="0.6" floodColor="#fff8b5" floodOpacity="0.8" />
        </filter>
      </defs>

      {/* 3D Cylindrical Extruded Base Slices */}
      <circle cx="50" cy="54" r="47" fill="#4d2c00" />
      <circle cx="50" cy="53" r="47" fill="#7a4800" />
      <circle cx="50" cy="52" r="47" fill="#a86807" />
      <circle cx="50" cy="51" r="47" fill="#d49214" />
      <circle cx="50" cy="50" r="47" fill={`url(#${idPrefix}-rim)`} />

      {/* Reeded / Milled Rim Grooves */}
      <circle
        cx="50"
        cy="50"
        r="44.5"
        fill="none"
        stroke="#422500"
        strokeWidth="2.2"
        strokeDasharray="2.2 2"
        opacity="0.75"
      />

      {/* Beveled Outer Lip */}
      <circle cx="50" cy="50" r="43.2" fill="none" stroke="#fff8b5" strokeWidth="1" opacity="0.9" />
      <circle cx="50" cy="50" r="41.2" fill="none" stroke="#5c3600" strokeWidth="1.2" opacity="0.65" />

      {/* Coin Field */}
      <circle cx="50" cy="50" r="40" fill={`url(#${idPrefix}-face)`} />

      {/* Purple Ambient Bounce Light matching background */}
      <circle cx="50" cy="50" r="47" fill="none" stroke={`url(#${idPrefix}-purple)`} strokeWidth="3.5" />

      {/* Inner Minted Beaded Border */}
      <circle
        cx="50"
        cy="50"
        r="36.5"
        fill="none"
        stroke="#ffeb8a"
        strokeWidth="1.2"
        strokeDasharray="1.2 2.2"
        opacity="0.65"
      />
      <circle cx="50" cy="50" r="34" fill="none" stroke="#6e4200" strokeWidth="0.8" opacity="0.5" />

      {/* Embossed Absolute Capital "T" */}
      <g filter={`url(#${idPrefix}-shadow)`}>
        <path
          d="M 24 28 H 76 V 39.5 H 58 V 74 H 42 V 39.5 H 24 Z"
          fill={`url(#${idPrefix}-letter)`}
          stroke="#422400"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        {/* Top Crisp Specular Highlight on Crossbar */}
        <path d="M 25.5 29.5 H 74.5 V 31.5 H 25.5 Z" fill="#ffffff" opacity="0.9" />
        {/* Left Side Light on Crossbar & Vertical Stem */}
        <path d="M 25 30 V 38 H 27 V 30 Z" fill="#ffffff" opacity="0.75" />
        <path d="M 43.5 40.5 V 72.5 H 45.5 V 40.5 Z" fill="#ffffff" opacity="0.6" />
      </g>

      {/* Sweeping Specular Curved Glare */}
      <path
        d="M24 38 Q 45 22 76 34 Q 50 38 24 38 Z"
        fill="#ffffff"
        opacity="0.3"
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  );
}
