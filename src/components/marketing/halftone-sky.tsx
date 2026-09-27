import { useEffect, useRef } from "react";

// Halftone cloud art for the landing bento cards, in the style of
// public/dotty-cloud.avif. Usage: <HalftoneSky seed={11} clouds={[[0.14, 0.7, 0.62]]} />
// Each cloud is [centerX, centerY, width] as fractions of the canvas.

type Cloud = [number, number, number];

interface Puff {
  x: number;
  y: number;
  rad: number;
}

interface CloudShape {
  puffs: Puff[];
  base: number;
  top: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number): number {
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    total += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    freq *= 2;
    amp *= 0.5;
  }
  return total;
}

function makeCloud(next: () => number, cx: number, cy: number, w: number): CloudShape {
  const puffs: Puff[] = [];
  const count = 9 + Math.floor(next() * 4);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const mid = Math.sin(Math.PI * t);
    puffs.push({
      x: cx - w / 2 + t * w + (next() - 0.5) * w * 0.06,
      y: cy - mid * w * 0.1 - next() * w * 0.03,
      rad: w * (0.08 + 0.15 * mid) * (0.85 + next() * 0.3),
    });
  }
  const top = Math.min(...puffs.map((p) => p.y - p.rad));
  return { puffs, base: cy + w * 0.07, top };
}

function cloudValue(cloud: CloudShape, x: number, y: number): number {
  let value = 0;
  for (const p of cloud.puffs) {
    const d = Math.hypot(x - p.x, (y - p.y) * 1.15) / p.rad;
    if (d < 1) value = Math.max(value, 1 - d * d);
  }
  const below = y - cloud.base;
  if (below > 0) value *= Math.max(0, 1 - below / 18);
  return value;
}

function draw(canvas: HTMLCanvasElement, seed: number, clouds: Cloud[]): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  // Same glow as the dashboard wallpaper (index.css body background).
  ctx.fillStyle = "#0b0c0f";
  ctx.fillRect(0, 0, W, H);
  const top = ctx.createRadialGradient(W * 0.1, 0, 0, W * 0.1, 0, Math.max(W, H) * 0.9);
  top.addColorStop(0, "rgba(58, 96, 142, 0.35)");
  top.addColorStop(0.6, "rgba(58, 96, 142, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H);
  const bottom = ctx.createRadialGradient(W * 0.9, H, 0, W * 0.9, H, Math.max(W, H) * 0.8);
  bottom.addColorStop(0, "rgba(40, 92, 104, 0.3)");
  bottom.addColorStop(0.6, "rgba(40, 92, 104, 0)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 0, W, H);

  const next = rng(seed);
  const shapes = clouds.map(([fx, fy, fw]) => makeCloud(next, fx * W, fy * H, fw * W));

  ctx.save();
  ctx.filter = "blur(24px)";
  ctx.fillStyle = "rgba(150, 180, 230, 0.05)";
  for (const shape of shapes) {
    for (const p of shape.puffs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.rad * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  const pitch = 3.5;
  for (let y = pitch / 2; y < H; y += pitch) {
    const fade = 1 - Math.min(1, Math.max(0, (y - H * 0.72) / (H * 0.28)));
    for (let x = pitch / 2; x < W; x += pitch) {
      let value = 0;
      let lit = 0;
      for (const shape of shapes) {
        const v = cloudValue(shape, x, y);
        if (v > value) {
          value = v;
          lit = 1 - Math.min(1, Math.max(0, (y - shape.top) / (shape.base - shape.top)));
        }
      }
      if (value <= 0) continue;
      const tone = value * (0.45 + 0.7 * fbm(x / 70, y / 70, seed)) * (0.55 + 0.6 * lit) * fade;
      if (tone < 0.1 + hash(Math.floor(x / pitch), Math.floor(y / pitch), seed + 5) * 0.3) continue;
      // Dot size follows tone, like a print halftone.
      const size = pitch * Math.min(0.95, 0.25 + 0.7 * tone);
      ctx.fillStyle = `rgba(190, 206, 235, ${Math.min(0.55, 0.1 + tone * 0.45).toFixed(3)})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
}

export function HalftoneSky({ seed, clouds }: { seed: number; clouds: Cloud[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    draw(canvas, seed, clouds);
    const observer = new ResizeObserver(() => draw(canvas, seed, clouds));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [seed, clouds]);

  return (
    <div aria-hidden className="absolute inset-0">
      <canvas ref={ref} className="absolute inset-0 size-full" />
      <div
        className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
        style={{ backgroundImage: "url(/noise.png)" }}
      />
    </div>
  );
}
