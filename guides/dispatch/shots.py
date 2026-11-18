"""
=============================================================================
FILE: guides/dispatch/shots.py
VERSION: v1 (2026-11-18)
=============================================================================
PURPOSE
  Captures every Dispatch It figure used by the guide and the getting-
  started tour, from the REAL app served locally, with EXAMPLE data.
  - Points the app at a same-origin fake Worker (/__mock) answered below,
    so no ClickUp, Gemini or passcode is needed and no real data is shown.
  - Each figure records its pin positions (see lib/capture.py); a renamed
    or removed control shows up as a missing pin and fails the build.

USAGE (normally via guides/run.py)
  Serve the app: (cd mkp-dispatch && python -m http.server 5190)
  python guides/dispatch/shots.py <out_dir>

EXAMPLE DATA
  Captures, tasks, people and companies below are invented.
=============================================================================
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
from playwright.sync_api import sync_playwright  # noqa: E402
from browser import launch, fonts  # noqa: E402
from capture import capture  # noqa: E402

APP = os.environ.get('DISPATCH_URL', 'http://localhost:5190/')
MOCK = APP.rstrip('/') + '/__mock'
REAL_WORKER = 'https://dispatch-clickup-proxy.c1-jumpw.workers.dev'  # shown in Settings instead of the fake
NOW_MS = int(time.time() * 1000)

STATUS = {
    'clickup_connected': True,
    'gemini': {'configured': True, 'model': 'gemini-flash'},
    'vectors': {'available': True, 'count': 1243},
    'index': {'lists': 112, 'spaces': 7, 'synced_at': NOW_MS - 3600_000, 'truncated': False},
    'sync': {'last_run': NOW_MS - 600_000, 'last_source': 'cron', 'last_error': None, 'hier_at': NOW_MS - 3600_000,
             'tasks_indexed_through': NOW_MS - 600_000, 'backfill': {'done_at': NOW_MS - 86400_000, 'total': 1243},
             'fields': {'done': 112, 'total': 112}},
    'webhook': {'enabled': True, 'health': 'active', 'fail_count': 0},
    'settings': {'auto_enabled': True, 'auto_threshold': 0.85, 'dup_threshold': 0.9},
    'accuracy': {'suggested': 86, 'accepted': 79, 'pct': 92, 'auto': 61, 'undone': 3},
    'private_lists': 1,
}
CATALOG_LISTS = [
    {'id': '901702176129', 'name': 'To-Do', 'path': 'MKP › To-Do', 'space_id': 's1', 'space': 'MKP'},
    {'id': '901702176148', 'name': 'Accounting Item', 'path': 'MKP › Accounting Item', 'space_id': 's1', 'space': 'MKP'},
    {'id': '901799990001', 'name': 'Home Projects', 'path': 'MKP › Home Projects', 'space_id': 's1', 'space': 'MKP'},
    {'id': '901799990002', 'name': 'Travel Planning', 'path': 'MKP › Travel Planning', 'space_id': 's1', 'space': 'MKP'},
    {'id': '901703199842', 'name': 'Receivable', 'path': 'Super Admin › Receivable', 'space_id': 's2', 'space': 'Super Admin'},
    {'id': '901702161386', 'name': 'Task', 'path': 'Super Admin › Task', 'space_id': 's2', 'space': 'Super Admin'},
]
RECENT = [
    {'id': 'r1', 'title': 'Call Jim About The Overdue Invoice', 'entityName': 'Super Admin', 'color': '#7C8AF6', 'typeLabel': 'Receivable',
     'createdAt': NOW_MS - 120_000, 'clickupUrl': 'https://app.clickup.com/t/example1', 'action': 'task',
     'routing': {'source': 'auto', 'confidence': 0.94}, 'auditId': '1793000000000001-abc123'},
    {'id': 'r2', 'title': 'Draft Q4 Content Calendar', 'entityName': 'JTG Admin', 'color': '#E2604F', 'typeLabel': 'Content Idea',
     'createdAt': NOW_MS - 3600_000, 'clickupUrl': 'https://app.clickup.com/t/example2', 'action': 'task',
     'routing': {'source': 'confirmed', 'confidence': 0.78}},
    {'id': 'r3', 'title': 'Hosting Renewal For Client Site', 'entityName': 'Unywebs', 'color': '#3FA7D6', 'typeLabel': 'Task',
     'createdAt': NOW_MS - 7200_000, 'clickupUrl': 'https://app.clickup.com/t/example3', 'action': 'update'},
    {'id': 'r4', 'title': 'Order New Business Cards', 'entityName': 'MKP', 'color': '#E8A33D', 'typeLabel': 'To-Do',
     'createdAt': NOW_MS - 86400_000, 'clickupUrl': 'https://app.clickup.com/t/example4', 'action': 'task'},
    {'id': 'r5', 'title': 'Test Capture', 'entityName': 'MKP', 'color': '#E8A33D', 'typeLabel': 'To-Do',
     'createdAt': NOW_MS - 90000_000, 'action': 'task', 'undone': True},
]
SUGGESTION = {
    'list_id': '901702176129', 'list_path': 'MKP › To-Do', 'owner_label': 'MKP → To-Do',
    'confidence': 0.78, 'raw_confidence': 0.88,
    'factors': [{'label': 'Gemini’s own confidence', 'value': 0.88}, {'label': 'Close second choice', 'delta': -0.1}],
    'reason': 'Personal follow-up with a deadline — fits your MKP to-do list.',
    'alternatives': [{'list_id': '901703199842', 'list_path': 'Super Admin › Receivable', 'confidence': 0.7}],
    'title': 'Call Jim About The Overdue Invoice', 'due_date': '2026-11-06', 'start_date': '',
    'date_reason': '“Friday” = Nov 6.', 'priority': 'high',
    'duplicate': {'task_id': '86b2abcd1', 'name': 'Follow Up With Jim Re: Overdue Payment', 'list_id': '901703199842',
                  'list_path': 'Super Admin › Receivable', 'status': 'open', 'similarity': 0.89,
                  'url': 'https://app.clickup.com/t/86b2abcd1', 'confidence': 0.82, 'reason': 'Same invoice follow-up.'},
    'auto': False, 'threshold': 0.85, 'model': 'gemini-flash', 'catalog_source': 'index', 'catalog_size': 112,
    'index_synced_at': NOW_MS - 3600_000, 'duplicate_check': 'ok',
}
AUDIT = [
    {'id': '1793000000000001-abc123', 'ts': NOW_MS - 120_000, 'kind': 'create_task', 'source': 'auto', 'confidence': 0.94,
     'title': 'Call Jim About The Overdue Invoice', 'list_path': 'Super Admin › Receivable', 'task_url': 'https://app.clickup.com/t/example1',
     'reversed': False, 'duplicate': False, 'moved': False},
    {'id': '1793000000000002-abc124', 'ts': NOW_MS - 3600_000, 'kind': 'create_task', 'source': 'confirmed', 'confidence': 0.78,
     'title': 'Draft Q4 Content Calendar', 'list_path': 'JTG Admin › Content Idea', 'task_url': 'https://app.clickup.com/t/example2',
     'reversed': False, 'duplicate': False, 'moved': True},
    {'id': '1793000000000003-abc125', 'ts': NOW_MS - 7200_000, 'kind': 'add_comment', 'source': 'confirmed', 'confidence': 0.86,
     'title': 'Hosting Renewal For Client Site', 'list_path': 'Unywebs › Task', 'task_url': 'https://app.clickup.com/t/example3',
     'reversed': False, 'duplicate': True, 'moved': False},
    {'id': '1793000000000004-abc126', 'ts': NOW_MS - 86400_000, 'kind': 'create_task', 'source': 'manual', 'confidence': None,
     'title': 'Order New Business Cards', 'list_path': 'MKP › To-Do', 'task_url': 'https://app.clickup.com/t/example4',
     'reversed': False, 'duplicate': False, 'moved': False},
    {'id': '1793000000000005-abc127', 'ts': NOW_MS - 90000_000, 'kind': 'create_task', 'source': 'manual', 'confidence': None,
     'title': 'Test Capture', 'list_path': 'MKP › To-Do', 'task_url': 'https://app.clickup.com/t/example5',
     'reversed': True, 'duplicate': False, 'moved': False},
]


class Mock:
    """Answers the fake Worker. Flags switch scenarios between figures."""
    def __init__(self):
        self.suggest_auto = False   # smart capture files itself (auto-file toast)
        self.dup_on_manual = False  # manual send finds a likely duplicate

    def __call__(self, route):
        req = route.request
        path = req.url.split('/__mock', 1)[1]
        m = req.method

        def ok(obj, status=200):
            route.fulfill(status=status, content_type='application/json', body=json.dumps(obj))
        if path.startswith('/user'):
            return ok({'user': {'id': 1, 'username': 'Alex', 'email': 'alex@example.com'}})
        if path.startswith('/routing/status'):
            return ok(STATUS)
        if path.startswith('/routing/lists'):
            return ok({'synced_at': NOW_MS - 3600_000, 'lists': CATALOG_LISTS})
        if path.startswith('/route/suggest'):
            time.sleep(0.2)
            s = dict(SUGGESTION)
            if self.suggest_auto:
                s.update({'auto': True, 'confidence': 0.91, 'duplicate': None, 'list_id': '901703199842',
                          'list_path': 'Super Admin › Receivable', 'owner_label': 'Super Admin → Receivable'})
            return ok({'suggestion': s})
        if path.startswith('/route/commit'):
            return ok({'audit_id': '1793000000000009-zz0001', 'task': {'id': '86b2new01', 'url': 'https://app.clickup.com/t/86b2new01',
                       'name': 'Call Jim About The Overdue Invoice'}, 'list_path': 'Super Admin › Receivable'})
        if path.startswith('/route/duplicates'):
            if self.dup_on_manual:
                return ok({'available': True, 'threshold': 0.9, 'matches': [
                    {'task_id': '86b2abcd2', 'similarity': 0.93, 'name': 'Order Business Cards From Printer', 'list_id': '901702176129',
                     'status': 'to do', 'url': 'https://app.clickup.com/t/86b2abcd2', 'list_path': 'MKP › To-Do'}]})
            return ok({'available': True, 'threshold': 0.9, 'matches': []})
        if path.startswith('/audit/record'):
            return ok({'audit_id': '1793000000000010-zz0002'})
        if re.match(r'^/audit/[^/]+/undo', path):
            return ok({'ok': True, 'notes': ['Task deleted. ClickUp usually keeps deleted tasks in its Trash for a while if you need it back.']})
        if path.startswith('/audit'):
            return ok({'items': AUDIT, 'cursor': None})
        if re.match(r'^/list/[^/]+/member', path):
            return ok({'members': [{'id': 11, 'username': 'Alex'}, {'id': 12, 'username': 'Sam'}, {'id': 13, 'username': 'Priya'}]})
        if re.match(r'^/list/[^/]+/task', path) and m == 'GET':
            return ok({'tasks': [
                {'id': '86b2t0001', 'name': 'Website Refresh For Spring', 'status': {'status': 'in progress'}, 'url': 'https://app.clickup.com/t/86b2t0001', 'parent': None},
                {'id': '86b2t0002', 'name': 'Quarterly Tax Filing', 'status': {'status': 'to do'}, 'url': 'https://app.clickup.com/t/86b2t0002', 'parent': None},
                {'id': '86b2t0003', 'name': 'Acme Corp', 'status': {'status': 'active'}, 'url': 'https://app.clickup.com/t/86b2t0003', 'parent': None}]})
        if re.match(r'^/list/[^/]+/task', path) and m == 'POST':
            return ok({'id': '86b2x7k4q', 'name': 'Order New Business Cards', 'url': 'https://app.clickup.com/t/86b2x7k4q'})
        if re.match(r'^/list/[^/]+/field', path):
            return ok({'fields': []})
        if path.startswith('/log/chat') or '/comment' in path or '/attachment' in path:
            return ok({'id': 90170012345678})
        return ok({'error': 'Endpoint not allowed by proxy.'}, 404)


def open_page(b, mock, w=390, h=844, unlocked=True, extra_storage=None, offline=False, tour_seen=True):
    """New context + page. Seeds localStorage once per context (the app's
    own refresh would otherwise re-run the seed); tour_seen keeps the
    getting-started tour from opening over the captured screens."""
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, service_workers='block',
                        timezone_id='America/New_York', color_scheme='dark')
    store = {
        'dispatch:settings': {'proxyUrl': MOCK, 'defaultEntity': None},
        'dispatch:routingStatus': {**STATUS, 'fetchedAt': NOW_MS},
        'dispatch:catalog': {'lists': CATALOG_LISTS, 'synced_at': NOW_MS - 3600_000, 'fetchedAt': NOW_MS},
        'dispatch:recent': RECENT,
    }
    if unlocked:
        store['dispatch:deviceKey'] = 'example-passcode'
    store.update(extra_storage or {})
    js = "if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded','1'); localStorage.clear();"
    for k, v in store.items():
        js += f"localStorage.setItem({json.dumps(k)}, {json.dumps(json.dumps(v))});"
    if tour_seen:
        js += "localStorage.setItem('dispatch:tourSeen', 'capture');"
    js += "}"
    if offline:
        js += "Object.defineProperty(navigator, 'onLine', {get: () => false});"
    js += "window.webkitSpeechRecognition = window.SpeechRecognition = class { start(){} stop(){} abort(){} };"
    ctx.add_init_script(js)
    ctx.route(MOCK + '/**', mock)
    fonts(ctx)
    pg = ctx.new_page()
    pg.goto(APP)
    pg.wait_for_timeout(900)
    pg.evaluate('document.fonts.ready')
    return ctx, pg


def fit(pg, extra=110):
    """Shrinks the viewport to the screen's content (plus room for a fixed
    footer) so tall screens don't leave a big empty gap above the footer."""
    pg.set_viewport_size({'width': 390, 'height': 400})
    pg.wait_for_timeout(200)
    bottom = pg.evaluate("Math.max(...[...document.querySelectorAll('main > *')].map(e => e.getBoundingClientRect().bottom + window.scrollY))")
    pg.set_viewport_size({'width': 390, 'height': int(bottom) + extra})
    pg.wait_for_timeout(300)


def go(pg, hash_):
    pg.evaluate(f"location.hash = {json.dumps(hash_)}")
    pg.wait_for_timeout(600)


def run(out):
    os.makedirs(out, exist_ok=True)
    mock = Mock()
    with sync_playwright() as p:
        b = launch(p)

        ctx, pg = open_page(b, mock, unlocked=False)
        capture(pg, out, 'lock', 'viewport', [
            (1, pg.get_by_placeholder('Passcode'), 'left'),
            (2, pg.get_by_role('button', name='Unlock'), 'left'),
        ])
        ctx.close()

        # Home, offline, with one capture waiting to send.
        queue = [{'id': 'q1', 'action': 'task', 'entityId': 'mkp', 'entityName': 'MKP', 'color': '#E8A33D', 'typeId': 'task',
                  'typeLabel': 'To-Do', 'schema': 'task', 'listId': '901702176129', 'fields': {'title': 'Renew Domain'},
                  'title': 'Renew Domain', 'createdAt': NOW_MS - 60_000, 'pendingAttachments': []}]
        ctx, pg = open_page(b, mock, extra_storage={'dispatch:queue': queue}, offline=True)
        capture(pg, out, 'home', 'viewport', [
            (1, pg.get_by_label('Check for updates'), 'right'),
            (2, pg.get_by_label('Help & guide'), 'center'),  # small icons sit side by side: mark them in place
            (3, pg.get_by_label('Activity'), 'center'),
            (4, pg.get_by_label('Settings'), 'right'),
            (5, pg.get_by_role('button', name='Retry now'), 'left'),
            (6, pg.get_by_role('button', name=re.compile('New Capture')), 'top'),
            (7, pg.get_by_role('button', name=re.compile('Choose the destination yourself')), 'left'),
            (8, pg.get_by_text('Recent', exact=True), 'left'),
        ])
        # Help sheet (Home's ? icon)
        pg.get_by_label('Help & guide').click()
        pg.wait_for_timeout(400)
        hs = pg.get_by_role('dialog')
        capture(pg, out, 'help-sheet', hs.first, [
            (1, hs.first.get_by_role('button', name='Getting started tour'), 'left'),
            (2, hs.first.get_by_role('button', name='Full guide'), 'left'),
        ])
        ctx.close()

        ctx, pg = open_page(b, mock)
        go(pg, '#/smart')
        pg.locator('textarea').first.fill('Call Jim Friday about the overdue invoice, urgent')
        fit(pg, extra=140)
        capture(pg, out, 'smart', 'viewport', [
            (1, pg.locator('textarea').first, 'top'),
            (2, pg.get_by_text('Hint', exact=True), 'left'),
            (3, pg.get_by_role('button', name=re.compile('Dictate')), 'left'),
            (4, pg.get_by_role('button', name=re.compile('Route & Send')), 'top'),
            (5, pg.get_by_role('button', name=re.compile('Choose the destination myself')), 'left'),
        ])
        ctx.close()

        ctx, pg = open_page(b, mock, h=1010)
        go(pg, '#/smart')
        pg.locator('textarea').first.fill('Call Jim Friday about the overdue invoice, urgent')
        pg.get_by_role('button', name=re.compile('Route & Send')).click()
        pg.get_by_text('Looks like an existing task').wait_for(timeout=8000)
        pg.wait_for_timeout(400)
        capture(pg, out, 'review', 'viewport', [
            (1, pg.get_by_text('Looks like an existing task'), 'left'),
            (2, pg.get_by_role('button', name='Add as update'), 'left'),
            (3, pg.get_by_text(re.compile('^Suggested destination|^Pick a destination')), 'left'),
            (4, pg.get_by_role('radio').first, 'left'),
            (5, pg.get_by_text('Other list…'), 'left'),
            (6, pg.get_by_text(re.compile('^Why \\d+%')), 'left'),
            (7, pg.get_by_text('Title', exact=True), 'left'),
            (8, pg.get_by_role('button', name=re.compile('^(Create new in|Send to)')), 'top'),
        ])
        pg.get_by_text('Other list…').click()
        pg.wait_for_timeout(500)
        sheet = pg.get_by_role('dialog', name='Choose a list')
        capture(pg, out, 'list-chooser', sheet, [
            (1, sheet.locator('input').first, 'left'),
            (2, sheet.get_by_text('yours').first, 'left'),
        ])
        ctx.close()

        mock.suggest_auto = True
        ctx, pg = open_page(b, mock)
        go(pg, '#/smart')
        pg.locator('textarea').first.fill('Invoice Acme for the October retainer')
        pg.get_by_role('button', name=re.compile('Route & Send')).click()
        t = pg.get_by_text(re.compile('^Auto-filed to'))
        t.wait_for(timeout=8000)
        pg.wait_for_timeout(300)
        capture(pg, out, 'autofile', 'viewport', [
            (1, t, 'top'),
            (2, pg.get_by_role('button', name='Undo').first, 'left'),
        ])
        ctx.close()
        mock.suggest_auto = False

        ctx, pg = open_page(b, mock)
        go(pg, '#/entity')
        capture(pg, out, 'entities', 'viewport', [(1, pg.locator('[data-entity="mkp"]'), 'top')])
        go(pg, '#/type/mkp')
        more = pg.locator('details.more-lists')
        more.locator('summary').click()
        pg.wait_for_timeout(200)
        capture(pg, out, 'types', 'viewport', [
            (1, pg.locator('[data-type="task"]'), 'top'),
            (2, pg.locator('[data-type="followup"]'), 'top'),
            (3, more.locator('summary'), 'left'),
        ])
        ctx.close()

        ctx, pg = open_page(b, mock, h=1300)
        go(pg, '#/form/mkp/task')
        pg.get_by_placeholder('What needs to get done?').fill('Order new business cards')
        pg.wait_for_timeout(500)
        fit(pg)
        capture(pg, out, 'form', 'viewport', [
            (1, pg.get_by_placeholder('What needs to get done?'), 'left'),
            (2, pg.locator('label.field', has_text='Priority').first, 'left'),
            (3, pg.get_by_text('Due date', exact=True), 'left'),
            (4, pg.get_by_role('button', name='Make this a subtask'), 'left'),
            (5, pg.locator('label[for="field-assigneeId"]'), 'left'),
            (6, pg.get_by_role('button', name=re.compile('Voice note')), 'left'),
            (7, pg.get_by_role('button', name='Send to ClickUp'), 'top'),
        ])
        mock.dup_on_manual = True
        pg.get_by_role('button', name='Send to ClickUp').click()
        pg.wait_for_timeout(900)
        dlg = pg.get_by_role('dialog').first
        capture(pg, out, 'dup-sheet', dlg, [
            (1, dlg.get_by_role('button', name='Add as update'), 'left'),
            (2, dlg.get_by_role('button', name='Create new anyway'), 'left'),
        ])
        mock.dup_on_manual = False
        ctx.close()

        ctx, pg = open_page(b, mock)
        go(pg, '#/form/mkp/followup')
        fit(pg)
        capture(pg, out, 'followup', 'viewport', [
            (1, pg.get_by_placeholder(re.compile('Search by name')), 'left'),
            (2, pg.get_by_text(re.compile('^Follow-up note')), 'left'),
        ])
        ctx.close()

        ctx, pg = open_page(b, mock, h=1200)
        go(pg, '#/form/super-admin/add-account')
        sel = pg.locator('select').first
        sel.select_option('MKC Client')
        pg.wait_for_timeout(500)
        fit(pg)
        capture(pg, out, 'accounts', 'viewport', [
            (1, sel, 'left'),
            (2, pg.get_by_placeholder('Search company name…'), 'left'),
            (3, pg.locator('#account-destination'), 'left'),
            (4, pg.locator('p.hint', has_text='For safety, account details'), 'left'),
        ])
        ctx.close()

        ctx, pg = open_page(b, mock)
        go(pg, '#/activity')
        pg.wait_for_timeout(600)
        pg.get_by_role('button', name='Undo').first.click()
        pg.wait_for_timeout(150)
        capture(pg, out, 'activity', 'viewport', [
            (1, pg.get_by_text('suggestions kept'), 'left'),
            (2, pg.get_by_text(re.compile('^Auto \\d+%')).first, 'left'),
            (3, pg.get_by_role('button', name=re.compile('Confirm')).first, 'left'),
            (4, pg.get_by_label('Open in ClickUp').first, 'right'),
            (5, pg.get_by_label('Refresh'), 'right'),
        ])
        ctx.close()

        ctx, pg = open_page(b, mock, h=2000)
        go(pg, '#/settings')
        pg.wait_for_timeout(1200)
        fit(pg, extra=30)
        # Show the real Worker address (the app's default) instead of this run's local fake.
        pg.evaluate("(u => { const i = [...document.querySelectorAll('input')].find(e => e.value.includes('__mock')); if (i) i.value = u; })(%s)"
                    % json.dumps(REAL_WORKER))
        capture(pg, out, 'settings', 'viewport', [
            (1, pg.get_by_role('button', name='Connect to ClickUp'), 'left'),
            (2, pg.get_by_role('button', name='Re-check'), 'top'),
            (3, pg.get_by_text(re.compile('^Gemini connected')), 'left'),
            (4, pg.get_by_role('switch', name='Auto-file when confident'), 'left'),
            (5, pg.locator('#threshold-seg'), 'left'),
            (6, pg.locator('#dup-seg'), 'left'),
            (7, pg.get_by_role('button', name='Sync workspace'), 'left'),
            (8, pg.get_by_role('button', name=re.compile('task index')), 'left'),
            (9, pg.get_by_role('button', name=re.compile('live updates')), 'left'),
            (10, pg.get_by_role('button', name='Save URL'), 'left'),
            (11, pg.get_by_role('button', name=re.compile('Forget passcode')), 'left'),
            (12, pg.get_by_role('button', name=re.compile('Getting started tour')), 'left'),
        ])
        ctx.close()
        b.close()


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else 'shots')
