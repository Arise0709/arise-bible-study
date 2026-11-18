import fs from 'node:fs';
import path from 'node:path';

/**
 * Brand mark. To use the official Arise Church logo, save it as
 * public/brand/arise-logo.svg (or .png) and it replaces the text wordmark automatically.
 */
export function Logo({ light = true }: { light?: boolean }) {
  for (const f of ['arise-logo.svg', 'arise-logo.png']) {
    if (fs.existsSync(path.join(process.cwd(), 'public', 'brand', f))) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={`/brand/${f}`} alt="Arise Church" className="logo-img" />;
    }
  }
  return (
    <span className={`wordmark${light ? '' : ' wordmark-dark'}`} aria-label="Arise Church">
      <span className="wordmark-main">ARISE</span>
      <span className="wordmark-sub">CHURCH</span>
    </span>
  );
}
