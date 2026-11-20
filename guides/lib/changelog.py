"""
=============================================================================
FILE: guides/lib/changelog.py
VERSION: v1 (2026-11-20)
=============================================================================
PURPOSE
  Turns an app's CHANGELOG.md (the hand-written release notes) and its git
  history into the data behind:
    - the admin Change log page (every release, oldest to newest or the
      reverse, plus an automatic list of every code change),
    - the role-aware "What's new" card each person sees once after an
      update (admins see everything; everyone else sees only items meant
      for them),
    - the public What's new box in the guide and the tour (everyone-items
      only, since those pages are public).

CHANGELOG.md FORMAT (see guides/README.md for the version people read)
    ## 2026-11-20 · Short title              <- one release
    - New: A plain sentence for the person using the app.
    - [Admins] Changed: Something only admins need to know or do.
  - A release heading may end with "[Admins]" to make the whole release
    admin-only.
  - A bullet may start with an audience tag: [Admins] or [Everyone]
    (Everyone is the default).
  - Then an optional kind: New, Improved, Fixed, Changed, Removed or
    Security, followed by a colon. Default: Improved.
  - Releases are listed newest first. Several releases may share a date;
    the one higher in the file is the newer.

OUTPUT (parse_changelog)
  [{id, date, title, audience, items: [{text, audience, kind}]}...]
  newest first. id = first 10 hex chars of sha1(date + title): stable as
  long as the date and title don't change, which is what the apps store
  to remember "seen up to here".

ERRORS (the build fails on purpose rather than publish a broken log)
  Unknown [tag], unknown "Kind:" that looks like a kind, a release with no
  bullets, a bullet before the first release, dates out of order, or two
  releases with the same date and title.

GIT HISTORY (git_history)
  One row per commit that touched the app's folder: {date, sha, subject}.
  Automatic guide refreshes (made by the workflow) are left out. Returns
  complete=False when the clone is shallow, so the page can say the list
  may be partial instead of looking authoritative.
=============================================================================
"""
import hashlib
import re
import subprocess

AUDIENCES = {'everyone': 'everyone', 'all': 'everyone', 'admins': 'admins', 'admin': 'admins'}
KINDS = ('new', 'improved', 'fixed', 'changed', 'removed', 'security')
DEFAULT_KIND = 'improved'

HEADING_RE = re.compile(r'^##\s+(\d{4}-\d{2}-\d{2})\s*[·\-–—:]\s*(.+?)\s*$')
TAG_RE = re.compile(r'^\[([A-Za-z ]+)\]\s*')
KIND_RE = re.compile(r'^([A-Za-z]+):\s+')
# Commits made by the guides workflow itself — not changes to the app.
AUTO_SUBJECTS = ('Refresh guides and tours (automatic)',)


def release_id(date, title):
    """Stable id the apps store as "seen up to here"."""
    return hashlib.sha1((date + title).encode('utf-8')).hexdigest()[:10]


def _audience(tag, where):
    key = tag.strip().lower()
    if key not in AUDIENCES:
        raise ValueError(f'{where}: unknown audience tag [{tag}] (use [Admins] or [Everyone])')
    return AUDIENCES[key]


def parse_changelog(path):
    """CHANGELOG.md -> list of releases, newest first (see file header)."""
    try:
        lines = open(path, encoding='utf-8').read().splitlines()
    except FileNotFoundError:
        return []
    releases, cur = [], None
    for n, raw in enumerate(lines, 1):
        ln = raw.strip()
        where = f'{path}:{n}'
        m = HEADING_RE.match(ln)
        if m:
            title, audience = m.group(2), 'everyone'
            t = re.search(r'\s*\[([A-Za-z ]+)\]$', title)
            if t:
                audience = _audience(t.group(1), where)
                title = title[:t.start()].rstrip()
            cur = {'id': release_id(m.group(1), title), 'date': m.group(1), 'title': title,
                   'audience': audience, 'items': [], '_line': n}
            releases.append(cur)
            continue
        if not ln.startswith('- '):
            continue
        if cur is None:
            continue  # bullets in the intro (format examples) aren't releases
        text = ln[2:].strip()
        audience = cur['audience']
        t = TAG_RE.match(text)
        if t:
            audience = _audience(t.group(1), where)
            text = text[t.end():]
        if cur['audience'] == 'admins':
            audience = 'admins'  # an admin-only release can't contain public items
        kind = DEFAULT_KIND
        k = KIND_RE.match(text)
        if k:
            word = k.group(1).lower()
            if word in KINDS:
                kind, text = word, text[k.end():]
            elif word in ('new', 'fix', 'improve', 'improvement', 'change', 'remove'):
                raise ValueError(f'{where}: write "{word.title()}:" as one of {", ".join(w.title() for w in KINDS)}')
        if not text:
            raise ValueError(f'{where}: empty bullet')
        cur['items'].append({'text': text, 'audience': audience, 'kind': kind})

    seen = set()
    for i, r in enumerate(releases):
        where = f'{path}:{r.pop("_line")}'
        if not r['items']:
            raise ValueError(f'{where}: release "{r["title"]}" has no "- " bullets')
        if r['id'] in seen:
            raise ValueError(f'{where}: two releases share the date and title "{r["title"]}"')
        seen.add(r['id'])
        if i and r['date'] > releases[i - 1]['date']:
            raise ValueError(f'{where}: releases must be newest first ({r["date"]} is below {releases[i - 1]["date"]})')
        if all(it['audience'] == 'admins' for it in r['items']):
            r['audience'] = 'admins'
    return releases


def public_entry(releases):
    """Newest release that has everyone-items, shaped for the guide/tour
    What's new box: {version, date, title, items: [text]} or None. Admin-only
    items are left out because the guide and tour are public pages."""
    for r in releases:
        items = [it['text'] for it in r['items'] if it['audience'] == 'everyone']
        if items:
            return {'version': r['id'], 'date': r['date'], 'title': r['title'], 'items': items}
    return None


def git_history(repo, paths):
    """Commits touching `paths` (newest first) -> (rows, complete)."""
    def git(*args):
        return subprocess.run(['git', '-C', repo, *args], capture_output=True, text=True, check=True).stdout
    try:
        shallow = git('rev-parse', '--is-shallow-repository').strip() == 'true'
        out = git('log', '--date=short', '--format=%ad%x09%h%x09%an%x09%s', '--', *paths)
    except (OSError, subprocess.CalledProcessError):
        return [], False
    rows = []
    for line in out.splitlines():
        parts = line.split('\t', 3)
        if len(parts) != 4:
            continue
        date, sha, author, subject = parts
        if subject in AUTO_SUBJECTS or author == 'github-actions[bot]':
            continue
        rows.append({'date': date, 'sha': sha, 'subject': subject})
    return rows, not shallow
