const originals = new WeakMap<HTMLImageElement, { src: string; srcset: string }>();

export function paintImg(img: HTMLImageElement, dataUri: string): void {
  if (!originals.has(img)) {
    // Never store our own data URI as the "original" (framework may have
    // re-created attributes between paints).
    if (!img.src.startsWith('data:')) originals.set(img, { src: img.src, srcset: img.srcset });
    else originals.set(img, { src: '', srcset: '' });
  }
  if (img.src !== dataUri) img.src = dataUri;
  if (img.srcset !== '') img.srcset = '';
  img.dataset.ubicon = '1';
}

export function unpaintImg(img: HTMLImageElement): void {
  const o = originals.get(img);
  if (o) { img.src = o.src; img.srcset = o.srcset; originals.delete(img); }
  delete img.dataset.ubicon;
}
