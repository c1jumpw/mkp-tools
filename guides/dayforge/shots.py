"""
=============================================================================
FILE: guides/dayforge/shots.py
VERSION: v1 (2026-11-18)
=============================================================================
PURPOSE
  Captures every DayForge figure used by the guide and the getting-started
  tour, from the REAL app running locally, with EXAMPLE data.
  - Fakes a signed-in session in localStorage and answers every Supabase
    call with the example rows below, so no database or login is needed.
  - Each figure records its pin positions (see lib/capture.py); a renamed
    or removed button shows up as a missing pin and fails the build.

USAGE (normally via guides/run.py)
  DayForge dev server must be running: (cd dayforge && npx vite --port 5180)
  python guides/dayforge/shots.py <out_dir>

EXAMPLE DATA
  Everything below is invented for the screenshots (tasks, notes, labels,
  routines). Dates are relative to "today" in America/New_York, so the
  Forecast and timeline always look current.
=============================================================================
"""
import datetime as dt
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
from playwright.sync_api import sync_playwright  # noqa: E402
from browser import launch, fonts  # noqa: E402
from capture import capture  # noqa: E402

APP = os.environ.get('DAYFORGE_URL', 'http://localhost:5180/')
REF = 'lmrbqkhefzbsnfxlszbs'  # DayForge's Supabase project ref (public; used in the auth storage key)
BASE = f'https://{REF}.supabase.co'
TZ = 'America/New_York'
today = dt.datetime.now(ZoneInfo(TZ)).date()
NOW = dt.datetime.now(dt.timezone.utc).isoformat()
UID = '00000000-0000-0000-0000-000000000001'


def d(off):
    return (today + dt.timedelta(days=off)).isoformat()


def task(i, title, **kw):
    row = dict(id=f't{i}', user_id=UID, title=title, notes=None, type='todo', category='work', pinned=False,
               date=None, start_time=None, duration_minutes=30, completed=False, recurrence='none',
               recurrence_days=[], created_at=NOW)
    row.update(kw)
    return row


TASKS = [
    task(1, 'Morning workout', category='personal', date=d(0), start_time='07:00:00', duration_minutes=45, recurrence='daily'),
    task(2, 'Plan the week', date=d(0), start_time='09:00:00', duration_minutes=60, completed=True),
    task(3, 'Write project brief', date=d(0), start_time='10:00:00', duration_minutes=120, notes='- Scope and goals\n- Timeline\n- Budget draft'),
    task(4, 'Lunch with Sam', category='personal', type='event', date=d(0), start_time='12:30:00', duration_minutes=60),
    task(5, 'Client call', type='event', date=d(0), start_time='14:00:00', duration_minutes=30),
    task(6, 'Review invoices', date=d(0), start_time='14:00:00', duration_minutes=60),
    task(7, 'Pick up groceries', category='personal', date=d(0), start_time='17:30:00', duration_minutes=30),
    task(8, 'Call the dentist', category='personal'),
    task(9, 'Renew passport', category='personal', duration_minutes=60),
    task(10, 'Reply to Priya', duration_minutes=15),
    task(11, 'Car registration due Nov 15', category='personal', type='reminder', pinned=True),
    task(12, "Mom's birthday on Sunday", category='personal', type='reminder', pinned=True),
    task(13, 'Team standup', type='event', date=d(1), start_time='09:30:00', duration_minutes=15, recurrence='weekly', recurrence_days=[1, 2, 3, 4, 5]),
    task(14, 'Dentist appointment', category='personal', type='event', date=d(2), start_time='11:00:00', duration_minutes=60),
    task(15, 'Quarterly review prep', date=d(3), start_time='13:00:00', duration_minutes=90),
    task(16, 'Send proposal', date=d(1), start_time='15:00:00', duration_minutes=45),
]
ROUTINES = [dict(id='r1', user_id=UID, name='Weekday morning', created_at=NOW),
            dict(id='r2', user_id=UID, name='Sunday reset', created_at=NOW)]
ROUTINE_ITEMS = [
    dict(id='ri1', routine_id='r1', user_id=UID, title='Morning workout', category='personal', type='todo', start_time='07:00:00', duration_minutes=45, sort_order=0),
    dict(id='ri2', routine_id='r1', user_id=UID, title='Inbox zero', category='work', type='todo', start_time='08:30:00', duration_minutes=30, sort_order=1),
    dict(id='ri3', routine_id='r1', user_id=UID, title='Deep work block', category='work', type='todo', start_time='09:00:00', duration_minutes=120, sort_order=2),
    dict(id='ri4', routine_id='r2', user_id=UID, title='Meal prep', category='personal', type='todo', start_time='15:00:00', duration_minutes=90, sort_order=0),
]
LABELS = [dict(id='l1', user_id=UID, name='Work', sort_order=0, created_at=NOW),
          dict(id='l2', user_id=UID, name='Travel', sort_order=0, created_at=NOW),
          dict(id='l3', user_id=UID, name='Ideas', sort_order=0, created_at=NOW)]


def note(i, content, **kw):
    r = dict(id=f'n{i}', user_id=UID, content=content, converted=False, converted_task_id=None, color=None,
             pinned=False, label_ids=[], created_at=NOW, updated_at=NOW)
    r.update(kw)
    return r


def datelabel(off):
    x = today + dt.timedelta(days=off)
    return f"{x.strftime('%b')} {x.day}, {x.year}"


NOTES = [
    note(1, f'{datelabel(0)}: Trip ideas\n- Book flights\n- Pick a hotel\n* check the cancellation policy\n* ask about breakfast', pinned=True, color='blue', label_ids=['l2', 'l3']),
    note(2, f'{datelabel(-1)}: Q4 planning\n- Draft budget\n- Review hires\n- Book offsite https://example.com/venues', label_ids=['l1']),
    note(3, f'{datelabel(-2)}: Groceries\n- milk\n- eggs\n- coffee', color='green'),
    note(4, f'{datelabel(-4)}: Podcast idea\n- Interview format\n- 20 minutes max', label_ids=['l3'], converted=True),
]
TABLES = {'tasks': TASKS, 'task_completions': [], 'routines': ROUTINES, 'routine_items': ROUTINE_ITEMS,
          'notes': NOTES, 'note_labels': LABELS, 'task_attachments': [], 'note_attachments': [],
          'voice_notes': [], 'task_voice_notes': []}
SESSION = {
    'access_token': 'example-token', 'token_type': 'bearer', 'expires_in': 3600,
    'expires_at': 4102444800, 'refresh_token': 'example-refresh',
    'user': {'id': UID, 'aud': 'authenticated', 'role': 'authenticated', 'email': 'you@example.com',
             'app_metadata': {}, 'user_metadata': {}, 'created_at': NOW},
}


def handle(route):
    """Answers Supabase REST calls with the example tables; writes echo back."""
    req = route.request
    url = req.url
    if '/rest/v1/' in url:
        table = url.split('/rest/v1/')[1].split('?')[0]
        rows = TABLES.get(table, [])
        if req.method == 'GET':
            single = 'vnd.pgrst.object' in (req.headers.get('accept') or '')
            return route.fulfill(status=200, content_type='application/json',
                                 body=json.dumps(rows[0] if single and rows else rows))
        body = req.post_data_json if req.post_data else {}
        if isinstance(body, list):
            body = body[0] if body else {}
        return route.fulfill(status=200, content_type='application/json',
                             body=json.dumps({**(rows[0] if rows else {}), **(body or {})}))
    return route.fulfill(status=200, content_type='application/json', body='{}')


def open_page(browser, w, h, scale, signed_in=True, theme='dark', tour_seen=True):
    """New context + page on the app. tour_seen=True keeps the getting-started
    tour from opening over the screens being captured."""
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=scale, timezone_id=TZ,
                              color_scheme='dark' if theme == 'dark' else 'light')
    init = f"localStorage.setItem('dayforge-theme', {json.dumps(theme)});"
    if tour_seen:
        init += "localStorage.setItem('dayforge-tour-seen', 'capture');"
    if signed_in:
        init += f"localStorage.setItem('sb-{REF}-auth-token', {json.dumps(json.dumps(SESSION))});"
    else:
        init += f"localStorage.removeItem('sb-{REF}-auth-token');"
    ctx.add_init_script(init)
    ctx.route(f'{BASE}/**', handle)
    fonts(ctx)
    pg = ctx.new_page()
    pg.goto(APP)
    pg.wait_for_timeout(1200)
    return ctx, pg


def plate_of(pg, text):
    """The panel/modal card (.plate) that contains the given exact text."""
    return pg.get_by_text(text, exact=True).first.locator('xpath=ancestor::div[contains(@class,"plate")][1]')


def run(out):
    os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        b = launch(p)

        # ---- Sign in (phone) ----
        ctx, pg = open_page(b, 390, 844, 2, signed_in=False)
        form = pg.locator('form').first
        capture(pg, out, 'login', form.locator('xpath=..'), [
            (1, pg.get_by_placeholder('you@example.com'), 'left'),
            (2, pg.get_by_placeholder('••••••••'), 'left'),
            (3, pg.get_by_role('button', name='Sign in'), 'left'),
        ], pad=12)
        ctx.close()

        # ---- Dashboard overview + panels (desktop) ----
        ctx, pg = open_page(b, 1280, 900, 1.5)
        capture(pg, out, 'dashboard', 'viewport', [
            (1, pg.get_by_text('Quick add', exact=True), 'left'),
            (2, pg.get_by_text('Pinned', exact=True), 'left'),
            (3, pg.get_by_text('Forecast', exact=True), 'left'),
            (4, pg.locator('text=/^[A-Z][a-z]+day, [A-Z][a-z]{2} \\d+$/').first, 'left'),
            (5, pg.get_by_text('Timeline', exact=True), 'left'),
            (6, pg.get_by_text('Tray', exact=True), 'left'),
        ])
        hdr = pg.get_by_role('button', name='Routines').locator('xpath=..')
        capture(pg, out, 'header', hdr, pad=18, pins=[
            (1, pg.get_by_label('Switch to light theme'), 'top'),
            (2, pg.get_by_role('button', name='Routines'), 'top'),
            (3, pg.get_by_role('button', name=re.compile('^Notes')), 'top'),
            (4, pg.get_by_role('button', name='Export'), 'top'),
            (5, pg.get_by_role('button', name='+ New task'), 'top'),
            (6, pg.get_by_label('Account menu'), 'top'),
        ])
        qa = plate_of(pg, 'Quick add')
        qa.locator('textarea').fill('Call dentist\nFinish slide deck\nBuy groceries')
        capture(pg, out, 'quickadd', qa, [
            (1, qa.locator('textarea'), 'top'),
            (2, qa.get_by_role('button', name='Personal'), 'left'),
            (3, qa.get_by_role('button', name='Todo'), 'left'),
            (4, qa.get_by_role('button', name='Add to tray'), 'left'),
        ])
        pn = plate_of(pg, 'Pinned')
        capture(pg, out, 'pinned', pn, [
            (1, pn.get_by_placeholder('Pin a reminder…'), 'left'),
            (2, pn.get_by_role('button', name='Pin', exact=True), 'top'),
            (3, pn.get_by_text('Car registration due Nov 15'), 'left'),
            (4, pn.get_by_text('Clear all', exact=True), 'left'),
        ])
        tr = plate_of(pg, 'Tray')
        capture(pg, out, 'tray', tr, [
            (1, tr.get_by_text('Call the dentist'), 'top'),
            (2, tr.get_by_title('Drag to reschedule').first, 'right'),
            (3, tr.get_by_text('Clear tray', exact=True), 'left'),
        ])
        tl = plate_of(pg, 'Timeline')
        wb = pg.get_by_text('Morning workout').first
        blk = wb.locator('xpath=ancestor::div[contains(@class,"absolute")][1]')
        blk3 = pg.get_by_text('Write project brief').first.locator('xpath=ancestor::div[contains(@class,"absolute")][1]')
        tlb = tl.bounding_box()
        bb = blk.bounding_box()
        capture(pg, out, 'timeline', {'x': tlb['x'], 'y': bb['y'] - 40, 'width': tlb['width'], 'height': 330}, [
            (1, blk.locator('button').first, 'left'),
            (2, wb, 'top'),
            (3, pg.get_by_text('↻').first, 'right'),
            (4, blk3.get_by_label('Delete Write project brief'), 'left'),
            (5, blk3.get_by_title('Drag to reschedule'), 'right'),
        ])
        ctx.close()

        # ---- Menu + Account settings ----
        ctx, pg = open_page(b, 1280, 900, 1.5)
        pg.get_by_label('Account menu').click()
        menu = pg.get_by_role('button', name='Account settings').locator('xpath=..')
        capture(pg, out, 'menu', menu, [
            (1, pg.get_by_role('button', name='Account settings'), 'left'),
            (2, pg.get_by_role('button', name='↻ Refresh app'), 'left'),
            (3, pg.get_by_role('button', name='Getting started tour'), 'left'),
            (4, pg.get_by_role('link', name=re.compile('Help & guide')), 'left'),
            (5, pg.get_by_role('button', name='Sign out'), 'left'),
        ], pad=14)
        pg.get_by_role('button', name='Account settings').click()
        acc = plate_of(pg, 'Account')
        capture(pg, out, 'account', acc, [
            (1, acc.get_by_text('New email (optional)'), 'left'),
            (2, acc.get_by_text('New password (optional)'), 'left'),
            (3, acc.get_by_role('button', name='Save changes'), 'left'),
        ])
        ctx.close()

        # ---- Task editor ----
        ctx, pg = open_page(b, 1280, 900, 1.5)
        pg.get_by_text('Write project brief').first.click()
        tm = plate_of(pg, 'Edit task')
        capture(pg, out, 'task', tm, [
            (1, tm.get_by_text('Title', exact=True), 'left'),
            (2, tm.get_by_role('button', name=re.compile('Record voice note')), 'left'),
            (3, tm.get_by_role('button', name=re.compile('Add file')), 'left'),
            (4, tm.get_by_text('Type', exact=True), 'left'),
            (5, tm.get_by_text(re.compile('^Pin as a general reminder')), 'left'),
            (6, tm.get_by_text('Give this a date and time block'), 'left'),
            (7, tm.get_by_text('Duration', exact=True), 'left'),
            (8, tm.get_by_text('End time', exact=True), 'left'),
            (9, tm.get_by_text('Repeats', exact=True), 'left'),
            (10, tm.get_by_role('button', name='Send to tray'), 'left'),
            (11, tm.get_by_role('button', name='Save changes'), 'left'),
            (12, tm.get_by_role('button', name='Delete'), 'left'),
        ])
        ctx.close()

        # ---- Routines (expanded) ----
        ctx, pg = open_page(b, 1280, 900, 1.5)
        pg.get_by_role('button', name='Routines').click()
        pg.get_by_role('button', name=re.compile('^Weekday morning')).click()
        rt = plate_of(pg, 'Routine templates')
        capture(pg, out, 'routines', rt, [
            (1, rt.get_by_placeholder('New routine name (e.g. Morning Routine)'), 'left'),
            (2, rt.get_by_role('button', name=re.compile('^Weekday morning')), 'left'),
            (3, rt.get_by_role('button', name='Apply to day').first, 'top'),
            (4, rt.get_by_placeholder('Item title'), 'left'),
            (5, rt.get_by_role('button', name='Add item'), 'left'),
        ])
        ctx.close()

        # ---- Export ----
        ctx, pg = open_page(b, 1280, 900, 1.5)
        pg.get_by_role('button', name='Export').click()
        ex = plate_of(pg, 'Export to calendar')
        capture(pg, out, 'export', ex, [
            (1, ex.get_by_text('Range', exact=True), 'left'),
            (2, ex.get_by_text('Category', exact=True), 'left'),
            (3, ex.get_by_text('Type', exact=True), 'left'),
            (4, ex.get_by_role('button', name='Download .ics'), 'left'),
        ])
        ctx.close()

        # ---- Light theme + phone dashboard (no pins) ----
        ctx, pg = open_page(b, 1280, 900, 1.5, theme='light')
        capture(pg, out, 'dashboard-light', 'viewport')
        ctx.close()
        ctx, pg = open_page(b, 390, 844, 2)
        capture(pg, out, 'phone-dashboard', 'viewport')
        ctx.close()

        # ---- Notes (phone) ----
        ctx, pg = open_page(b, 390, 844, 2)
        pg.get_by_role('button', name=re.compile('^Notes')).click()
        pg.wait_for_timeout(300)
        first_card = pg.get_by_text('Trip ideas').first.locator('xpath=ancestor::div[contains(@class,"plate")][1]')
        capture(pg, out, 'notes', 'viewport', [
            (1, pg.get_by_placeholder(re.compile('^Jot anything')), 'top'),
            (2, pg.get_by_placeholder('Search notes…'), 'left'),
            (3, pg.locator('[aria-expanded]').filter(has_text='Labels').first, 'left'),
            (4, pg.get_by_role('group', name='Filter notes by label'), 'left'),
            (5, first_card.get_by_label(re.compile('pin', re.I)).first, 'left'),
            (6, first_card.get_by_label('Edit note'), 'left'),
        ])
        capture(pg, out, 'note-card', first_card, [
            (1, first_card.get_by_role('button', name='Convert to task'), 'left'),
            (2, first_card.get_by_role('button', name=re.compile('^Files')), 'top'),
            (3, first_card.get_by_role('button', name=re.compile('Color')), 'top'),
            (4, first_card.get_by_role('button', name=re.compile('^Labels')), 'top'),
            (5, first_card.get_by_role('button', name='Travel'), 'left'),
        ])
        pg.get_by_text('Trip ideas').first.click()
        pg.wait_for_timeout(200)
        pg.get_by_role('button', name='Edit labels ▾').click()
        capture(pg, out, 'note-editor', {'x': 0, 'y': 0, 'width': 390, 'height': 360}, [
            (1, pg.get_by_role('button', name='Hide labels ▴'), 'left'),
            (2, pg.locator('textarea').last, 'top'),
            (3, pg.get_by_role('button', name='Done', exact=True), 'left'),
        ])
        ctx.close()
        ctx, pg = open_page(b, 390, 844, 2)
        pg.get_by_role('button', name=re.compile('^Notes')).click()
        pg.wait_for_timeout(200)
        pg.locator('[aria-expanded]').filter(has_text='Labels').first.click()
        mg = pg.get_by_text('Manage labels', exact=True).locator('xpath=ancestor::div[contains(@class,"plate")][1]')
        capture(pg, out, 'labels-manage', mg, [
            (1, mg.locator('input').first, 'left'),
            (2, mg.get_by_role('button', name='Delete').first, 'top'),
            (3, mg.get_by_placeholder('New label'), 'left'),
        ])
        ctx.close()
        b.close()


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else 'shots')
