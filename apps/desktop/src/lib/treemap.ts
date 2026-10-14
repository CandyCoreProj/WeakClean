export type Rect = { x: number; y: number; w: number; h: number };
export type Placed<T> = Rect & { item: T };

/**
 * Squarified treemap (Bruls et al.) — จัดสี่เหลี่ยมให้ใกล้จัตุรัสที่สุด อ่านง่ายกว่าแถบยาว
 * `items` ต้องเรียงจากค่ามากไปน้อย และค่ามากกว่า 0
 */
export function squarify<T>(items: { value: number; item: T }[], width: number, height: number): Placed<T>[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const out: Placed<T>[] = [];

  let { x, y, w, h } = { x: 0, y: 0, w: width, h: height };
  let i = 0;
  while (i < items.length) {
    const side = Math.min(w, h);
    // ต่อแถวไปเรื่อยๆ ตราบที่อัตราส่วนที่แย่สุดยังดีขึ้น
    let end = i + 1;
    let areaSum = items[i].value * scale;
    let best = worst([items[i].value * scale], side);
    while (end < items.length) {
      const a = items[end].value * scale;
      const candidate = worst(items.slice(i, end + 1).map((it) => it.value * scale), side);
      if (candidate > best) break;
      best = candidate;
      areaSum += a;
      end++;
    }

    // วางแถวนี้ชิดด้านสั้นของพื้นที่ที่เหลือ
    const thickness = areaSum / side;
    let offset = 0;
    for (let k = i; k < end; k++) {
      const len = (items[k].value * scale) / thickness;
      out.push(
        w >= h
          ? { x, y: y + offset, w: thickness, h: len, item: items[k].item }
          : { x: x + offset, y, w: len, h: thickness, item: items[k].item },
      );
      offset += len;
    }
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    i = end;
  }
  return out;
}

function worst(areas: number[], side: number): number {
  const sum = areas.reduce((s, a) => s + a, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}
