# Extracts <main> content from the HTML prototype into src/content/en/*.html, rewriting links to app routes.
import re, os, json, sys
# Historical one-off: the files in src/content/en have been edited since (and staff overrides live in the DB). Running this
# again would overwrite that work, so it refuses unless explicitly forced. There is deliberately no npm script for it.
if '--force' not in sys.argv:
    sys.exit('extract-design.py: refusing to run; it would overwrite the edited src/content/en/*.html files. Pass --force only if you really mean it.')
D = os.path.join(os.path.dirname(__file__), '../../design')
OUT = os.path.join(os.path.dirname(__file__), '../src/content/en')
ROUTES = {'home':'', 'event-detail':'events/ai-risk-register', 'directory':'my/directory',
          'corporate-admin':'admin/corporate', 'chapter-leader':'admin/chapter', 'index':'', 'brand':'design/brand', 'components':'design/components'}
def route(name):
    if name in ROUTES: return ROUTES[name]
    if name.startswith('my-'): return 'my/' + name[3:]
    if name.startswith('admin-'): return 'admin/' + name[6:]
    return name
def fix(html):
    html = re.sub(r'href="([a-z0-9-]+)\.html(#[^"]*)?"', lambda m: f'href="__L__/{route(m.group(1))}{m.group(2) or ""}"'.replace('__L__/"','__L__"').replace('__L__/#','__L__#'), html)
    # a11y fixes applied on extraction (QA BUG-011, BUG-016)
    html = html.replace('<div class="table-wrap">', '<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table">')
    html = html.replace('class="progress" aria-label="Programme design progress 30%">', 'class="progress" role="progressbar" aria-valuenow="30" aria-valuemin="0" aria-valuemax="100" aria-label="Programme design progress 30%">')
    html = html.replace('class="progress">', 'class="progress" role="presentation">')
    html = html.replace(' style="grid-template-columns:1fr 360px"', '').replace('container layout-sidebar"', 'container layout-aside"') if 'grid-template-columns:1fr 360px' in html else html
    html = html.replace('src="assets/', 'src="/assets/').replace('onsubmit="return false"', '')
    return html
for f in os.listdir(D):
    if not f.endswith('.html') or f == 'index.html': continue
    s = open(os.path.join(D, f)).read()
    a = s.index('>', s.index('<main')) + 1; b = s.index('</main>')
    inner = s[a:b]
    # include trailing dialog(s) after main for event-detail
    open(os.path.join(OUT, f[:-5] + '.html'), 'w').write(fix(inner))
print('ok')
