/** Serialize an SVG element to PNG and trigger browser download. */
export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  opts: {
    filename: string;
    title?: string;
    subtitle?: string;
    background?: string;
  },
): Promise<void> {
  const { filename, title, subtitle, background = "#ffffff" } = opts;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || Number(svg.getAttribute("width")) || 800));
  const height = Math.max(1, Math.round(rect.height || Number(svg.getAttribute("height")) || 360));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const headerH = title || subtitle ? 36 : 0;
  const exportRoot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  exportRoot.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  exportRoot.setAttribute("width", String(width));
  exportRoot.setAttribute("height", String(height + headerH));
  exportRoot.setAttribute("viewBox", `0 0 ${width} ${height + headerH}`);

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height + headerH));
  bg.setAttribute("fill", background);
  exportRoot.appendChild(bg);

  if (title) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", "12");
    t.setAttribute("y", "16");
    t.setAttribute("fill", "#0f172a");
    t.setAttribute("font-size", "13");
    t.setAttribute("font-weight", "700");
    t.setAttribute("font-family", "system-ui, sans-serif");
    t.textContent = title;
    exportRoot.appendChild(t);
  }
  if (subtitle) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "text");
    s.setAttribute("x", "12");
    s.setAttribute("y", "30");
    s.setAttribute("fill", "#64748b");
    s.setAttribute("font-size", "10");
    s.setAttribute("font-family", "system-ui, sans-serif");
    s.textContent = subtitle;
    exportRoot.appendChild(s);
  }

  const chartGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  chartGroup.setAttribute("transform", `translate(0, ${headerH})`);
  chartGroup.appendChild(clone);
  exportRoot.appendChild(chartGroup);

  const svgBlob = new Blob(
    [new XMLSerializer().serializeToString(exportRoot)],
    { type: "image/svg+xml;charset=utf-8" },
  );
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = (height + headerH) * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.scale(2, 2);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height + headerH);
    ctx.drawImage(img, 0, 0, width, height + headerH);

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("PNG export failed"));
    img.src = src;
  });
}
