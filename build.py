"""Build a static deployment and a standalone offline/local-host edition. No packages."""
from pathlib import Path
import json
import os
import re
import shutil
import hashlib

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
for name in ('index.html', 'styles.css', 'arcade.css', 'config.js', 'api.js', 'bulk.js', 'arcade.js', 'app.js', 'reset-password.html', 'password-reset.js'):
    shutil.copy2(ROOT / name, DIST / name)
url = os.getenv('COUNCIL_SUPABASE_URL', '').strip()
key = os.getenv('COUNCIL_SUPABASE_ANON_KEY', '').strip()
if bool(url) != bool(key):
    raise SystemExit('Set BOTH COUNCIL_SUPABASE_URL and COUNCIL_SUPABASE_ANON_KEY, or leave both empty.')
if key.startswith('sb_secret_'):
    raise SystemExit('Never embed a private service key.')
if url and key:
    configuration = json.dumps({'url': url, 'key': key}, ensure_ascii=True).replace('<', '\\u003c')
    (DIST / 'config.js').write_text('window.COUNCIL_CONFIG = ' + configuration + ';\n')
# New deployments must not mix a cached iPhone script with the updated backend/UI.
for html_name in ('index.html', 'reset-password.html'):
    html = (ROOT / html_name).read_text()
    def fingerprint(match):
        filename = match.group(2)
        target = DIST / filename
        if not target.is_file():
            return match.group(0)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()[:12]
        return match.group(1) + filename + '?v=' + digest + match.group(3)
    (DIST / html_name).write_text(re.sub(r'((?:src|href)=["\'])([\w.-]+\.(?:js|css))(["\'])', fingerprint, html))
(DIST / '.nojekyll').touch()
# This is the same app, fully bundled; it can be opened without a web server.
page = (ROOT / 'index.html').read_text()
for name in ('styles.css', 'arcade.css'):
    page = re.sub(r'<link\b[^>]*href=[\"\'](?:\./)?' + re.escape(name) + r'[\"\'][^>]*>', lambda _, n=name: '<style>\n' + (ROOT / n).read_text() + '\n</style>', page)
for name in ('config.js', 'api.js', 'bulk.js', 'arcade.js', 'app.js'):
    source = (DIST / name).read_text().replace('</script', '<\\/script')
    page = re.sub(r'<script\b[^>]*src=[\"\'](?:\./)?' + re.escape(name) + r'[\"\'][^>]*>\s*</script>', lambda _, s=source: '<script>\n' + s + '\n</script>', page)
(ROOT / 'Councillion.html').write_text(page)
print('Built dist/ and Councillion.html')
