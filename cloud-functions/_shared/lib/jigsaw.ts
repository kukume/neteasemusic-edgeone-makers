import { createCanvas, loadImage } from "canvas";

export type GapResult = {
  gapX: number;
  confidence: number;
  bgWidth: number;
  bgHeight: number;
  candidates?: number[];
};

/**
 * 易盾缺口：拼图轮廓应落在背景高亮描边 + 梯度边缘上。
 * 搜索范围避开左右贴边，降低右边缘误报。
 */
export async function findJigsawGapX(
  bgBuf: Buffer,
  sliceBuf?: Buffer,
): Promise<GapResult> {
  const bgImg = await loadImage(bgBuf);
  const width = bgImg.width;
  const height = bgImg.height;
  const bgCanvas = createCanvas(width, height);
  const bgCtx = bgCanvas.getContext("2d");
  bgCtx.drawImage(bgImg, 0, 0);
  const bg = bgCtx.getImageData(0, 0, width, height).data;

  if (!sliceBuf) {
    return whiteColumnGap(bg, width, height, Math.round(width * 0.2));
  }

  const sliceImg = await loadImage(sliceBuf);
  const sw = sliceImg.width;
  const sh = sliceImg.height;
  const sliceCanvas = createCanvas(sw, sh);
  const sliceCtx = sliceCanvas.getContext("2d");
  sliceCtx.drawImage(sliceImg, 0, 0);
  const slice = sliceCtx.getImageData(0, 0, sw, sh).data;

  const edgePts: Array<{ sx: number; sy: number }> = [];
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = (sw * y + x) << 2;
      if (slice[i + 3] < 128) continue;
      let isEdge = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const j = (sw * (y + dy) + (x + dx)) << 2;
        if (slice[j + 3] < 128) {
          isEdge = true;
          break;
        }
      }
      if (isEdge) edgePts.push({ sx: x, sy: y });
    }
  }

  // sobel magnitude of bg
  const sobel = new Float64Array(width * height);
  const lumAt = (x: number, y: number) => {
    const i = (width * y + x) << 2;
    return (bg[i] + bg[i + 1] + bg[i + 2]) / 3;
  };
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -lumAt(x - 1, y - 1) -
        2 * lumAt(x - 1, y) -
        lumAt(x - 1, y + 1) +
        lumAt(x + 1, y - 1) +
        2 * lumAt(x + 1, y) +
        lumAt(x + 1, y + 1);
      const gy =
        -lumAt(x - 1, y - 1) -
        2 * lumAt(x, y - 1) -
        lumAt(x + 1, y - 1) +
        lumAt(x - 1, y + 1) +
        2 * lumAt(x, y + 1) +
        lumAt(x + 1, y + 1);
      sobel[y * width + x] = Math.hypot(gx, gy);
    }
  }

  const minX = 20;
  const maxX = Math.max(minX, width - sw - 20);
  type Cand = { x: number; bright: number; sob: number; score: number };
  const cands: Cand[] = [];

  for (let x = minX; x <= maxX; x++) {
    let bright = 0;
    let sob = 0;
    let n = 0;
    for (const { sx, sy } of edgePts) {
      const bx = x + sx;
      const by = sy;
      if (bx <= 0 || bx >= width - 1 || by <= 0 || by >= height - 1) continue;
      const bi = (width * by + bx) << 2;
      bright += (bg[bi] + bg[bi + 1] + bg[bi + 2]) / 3;
      sob += sobel[by * width + bx];
      n += 1;
    }
    if (n < 10) continue;
    const brightAvg = bright / n;
    const sobAvg = sob / n;
    // 成功样本上 bright-edge 更稳；sobel 作辅助，并压制纯边缘峰值
    const score = brightAvg * 0.65 + sobAvg * 0.35;
    cands.push({ x, bright: brightAvg, sob: sobAvg, score });
  }

  cands.sort((a, b) => b.score - a.score);
  // 非极大抑制：候选间距至少 8px
  const picked: Cand[] = [];
  for (const c of cands) {
    if (picked.some((p) => Math.abs(p.x - c.x) < 8)) continue;
    picked.push(c);
    if (picked.length >= 5) break;
  }

  const best = picked[0] || { x: minX, bright: 0, sob: 0, score: 0 };
  return {
    gapX: best.x,
    confidence: Math.min(1, best.bright / 255),
    bgWidth: width,
    bgHeight: height,
    candidates: picked.map((p) => p.x),
  };
}

function whiteColumnGap(
  data: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  sliceWidth: number,
): GapResult {
  let peak = 0;
  let peakX = 0;
  for (let x = 10; x < width - 10; x++) {
    let s = 0;
    for (let y = 10; y < height - 10; y++) {
      const i = (width * y + x) << 2;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum > 200) s += 1;
    }
    if (s > peak) {
      peak = s;
      peakX = x;
    }
  }
  const gapX = Math.max(0, peakX - Math.floor(sliceWidth / 2));
  return {
    gapX,
    confidence: peak / height,
    bgWidth: width,
    bgHeight: height,
    candidates: [gapX],
  };
}

export function buildDragTrack(
  distance: number,
  steps = 40,
): Array<{ x: number; y: number; t: number }> {
  const track: Array<{ x: number; y: number; t: number }> = [];
  let t = 0;
  const overshoot = Math.min(5, Math.max(1, Math.floor(distance * 0.02)));
  // 总时长约 0.7~1.4s，前快后慢
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const eased = 1 - Math.pow(1 - p, 2.6);
    let x = Math.round(distance * eased);
    if (p > 0.86 && p < 0.95) x = distance + overshoot;
    if (p >= 0.95) x = distance;
    const y = Math.round((Math.random() - 0.5) * 3);
    const base = p < 0.2 ? 18 : p > 0.8 ? 22 : 12;
    t += base + Math.floor(Math.random() * 14);
    track.push({ x, y, t });
  }
  if (track.length) track[track.length - 1].x = distance;
  return track;
}
