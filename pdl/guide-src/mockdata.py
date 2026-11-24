"""Sample library used only to photograph the real app for the guide. Nothing here touches the real repo or relay.

VERSION HISTORY
  v1  2026-10-30  Sample library, collections, Trash and Vault entries.
  v2  2026-11-22  Moved to c3jumpw/mkp-tools/pdl/guide-src.
"""
import base64, json, datetime, hashlib

MEDIA = "pdl/media"
NOW = datetime.datetime(2026, 10, 30, 8, 12)

def iso(days_ago, hour=9):
    return (NOW - datetime.timedelta(days=days_ago)).replace(hour=hour).isoformat() + "Z"

def sha(s):
    return hashlib.sha1(s.encode()).hexdigest()

MB = 1024 * 1024

# name, size_mb, cover, summary, transcript
ROOT_FILES = [
    ("A. Absolute_biological_requirements_for_success.m4a", 28.9, "biology", True, False),
    ("B. The_High_Achiever_Operating_System.m4a", 24.7, "high_achiever", True, True),
    ("C. Bypassing_the_brain_s_bouncer_for_wealth.m4a", 39.7, "bouncer", False, False),
    ("D.Leadership_starts_in_an_empty_room.m4a", 35.9, "empty_room", True, False),
    ("E-Stop_Pushing_Boulders_and_Build_Levers.m4a.chunked.json", None, "levers", False, False),
    ("F-Internal_Architecture_for_High_Performance_Success.m4a", 37.5, "architecture", False, False),
    ("The_Four_Layers_of_Wealth_Architecture.m4a", 38.7, "four_layers", True, False),
    ("Morning_Visualization_Practice.mp4", 48.2, "sunrise", True, False),
    ("2026_Goals_and_Commitments.pdf", 1.2, None, True, False),
    ("Weekly_Reflection_Notes.md", 0.1, None, False, False),
]
ROOT_DIRS = ["Daily Affirmations", "Health & Energy", "Leadership", "Wealth"]

SUB = {
    "Daily Affirmations": [
        ("I_am_calm_focused_and_capable.m4a", 6.2, "calm", False, False),
        ("Abundance_flows_to_me.m4a", 5.8, None, False, False),
        ("Morning_gratitude_script.m4a", 4.1, None, True, False),
    ],
    "Health & Energy": [("Sleep_as_a_performance_tool.m4a", 22.4, None, False, False)],
    "Leadership": [("Leading_through_uncertainty.m4a", 31.0, None, False, False)],
    "Wealth": [("Cash_flow_before_assets.m4a", 26.3, None, False, False)],
}

TRASH = [("Old_voice_memo_03.m4a", 3.2, 6), ("Draft_goals_v1.pdf", 0.4, 27)]

def file_entry(folder, name, size_mb):
    path = f"{folder}/{name}"
    return {"name": name, "path": path, "type": "file",
            "size": int((size_mb or 0.01) * MB) if not name.endswith(".chunked.json") else 220,
            "sha": sha(path)}

def real_name(name):
    return name[: -len(".chunked.json")] if name.endswith(".chunked.json") else name

def build_folders():
    folders = {}
    covers = {}  # cover path -> cover key
    def add_files(folder, files):
        out = []
        for name, size, cover, summary, transcript in files:
            out.append(file_entry(folder, name, size))
            base = f"{folder}/{real_name(name)}"
            if cover:
                out.append({"name": real_name(name) + ".cover.jpg", "path": base + ".cover.jpg", "type": "file", "size": 60000, "sha": sha(base + "c")})
                covers[base + ".cover.jpg"] = cover
            if summary:
                out.append({"name": real_name(name) + ".summary.json", "path": base + ".summary.json", "type": "file", "size": 600, "sha": sha(base + "s")})
            if transcript:
                out.append({"name": real_name(name) + ".transcript.json", "path": base + ".transcript.json", "type": "file", "size": 900, "sha": sha(base + "t")})
        return out
    root = [{"name": d, "path": f"{MEDIA}/{d}", "type": "dir", "size": 0, "sha": sha(d)} for d in ROOT_DIRS]
    root.append({"name": "trash", "path": f"{MEDIA}/trash", "type": "dir", "size": 0, "sha": sha("trash")})
    root.append({"name": ".collection-covers", "path": f"{MEDIA}/.collection-covers", "type": "dir", "size": 0, "sha": sha("cc")})
    root.append({"name": ".collections.json", "path": f"{MEDIA}/.collections.json", "type": "file", "size": 900, "sha": sha("colls")})
    root += add_files(MEDIA, ROOT_FILES)
    folders[MEDIA] = root
    for d, files in SUB.items():
        folders[f"{MEDIA}/{d}"] = add_files(f"{MEDIA}/{d}", files)
    trash = [file_entry(f"{MEDIA}/trash", n, s) for n, s, _ in TRASH]
    trash.append({"name": ".trash-meta.json", "path": f"{MEDIA}/trash/.trash-meta.json", "type": "file", "size": 300, "sha": sha("tm")})
    folders[f"{MEDIA}/trash"] = trash
    return folders, covers

FOLDERS, COVERS = build_folders()

TRASH_META = {n: {"trashedAt": iso(days), "originalPath": f"{MEDIA}/{n}"} for n, _, days in TRASH}

P = lambda n: f"{MEDIA}/{n}"
COLLECTIONS = {
    "collections": [
        {"id": "morning-ritual", "name": "Morning Ritual"},
        {"id": "wealth-mindset", "name": "Wealth Mindset"},
        {"id": "leadership", "name": "Leadership"},
    ],
    "assignments": {
        P("B. The_High_Achiever_Operating_System.m4a"): ["morning-ritual"],
        P("Morning_Visualization_Practice.mp4"): ["morning-ritual"],
        P("Daily Affirmations/I_am_calm_focused_and_capable.m4a"): ["morning-ritual"],
        P("A. Absolute_biological_requirements_for_success.m4a"): ["morning-ritual"],
        P("2026_Goals_and_Commitments.pdf"): ["morning-ritual", "wealth-mindset"],
        P("C. Bypassing_the_brain_s_bouncer_for_wealth.m4a"): ["wealth-mindset"],
        P("The_Four_Layers_of_Wealth_Architecture.m4a"): ["wealth-mindset"],
        P("F-Internal_Architecture_for_High_Performance_Success.m4a"): ["wealth-mindset"],
        P("D.Leadership_starts_in_an_empty_room.m4a"): ["leadership"],
        P("E-Stop_Pushing_Boulders_and_Build_Levers.m4a.chunked.json"): ["leadership", "wealth-mindset"],
    },
}

SUMMARIES = {
    "B. The_High_Achiever_Operating_System.m4a":
        "A practical framework for treating your daily routine as an operating system. It covers the three inputs that set the tone of a day (sleep, movement, and the first information you take in), the idea of a few non-negotiable operating rules, and why upgrading habits fails while the underlying system is broken.\n\nEnds with an exercise: write down three rules to run on for the next 30 days.\n\nWorth it when: you're planning a reset week, or feel busy without making progress.",
    "A. Absolute_biological_requirements_for_success.m4a":
        "Sleep, light, movement and food as the non-negotiable base layer for performance — with simple daily minimums for each.",
    "D.Leadership_starts_in_an_empty_room.m4a":
        "Leadership as private discipline: the standards you keep when no one is watching decide how you lead when everyone is.",
    "The_Four_Layers_of_Wealth_Architecture.m4a":
        "Four layers of building wealth — income, protection, assets and legacy — and why each one has to hold before the next.",
    "Morning_Visualization_Practice.mp4":
        "A 9-minute guided visualization for the start of the day: breathing, then rehearsing the day's three most important moments.",
    "2026_Goals_and_Commitments.pdf":
        "The year's goals in five areas, each with a measurable target, a monthly checkpoint and the first next action.",
    "Morning_gratitude_script.m4a": "A two-minute gratitude script for the first moments after waking.",
}

TRANSCRIPT_B = {"cues": [
    {"start": 0, "text": "Every high achiever runs on a system, whether they designed it or not."},
    {"start": 14, "text": "The question is whether yours was chosen on purpose."},
    {"start": 31, "text": "Start with the inputs: sleep, movement, and what you let into your mind first thing."},
    {"start": 52, "text": "Then the operating rules — the few decisions you never re-negotiate."},
    {"start": 75, "text": "Most people try to upgrade the apps while the operating system is still broken."},
    {"start": 101, "text": "Fix the system, and the results start compounding on their own."},
    {"start": 125, "text": "Today, write down three rules you will run on for the next thirty days."},
]}

MARKDOWN_DOC = """# Weekly reflection — week 43

**What moved forward**
- Finished the High Achiever OS track twice; wrote my three 30-day rules.
- Two early mornings with the visualization practice.

**What got in the way**
- Late screens on Tuesday and Wednesday. Sleep was the first thing to slip.

**One thing to carry into next week**
Protect the first 30 minutes of the day. No inbox before the practice.
"""

TERMS = [
    {"id": 1, "term": "Kaizen", "language": "Japanese",
     "definition": "Continuous improvement through small, incremental changes made consistently over time.",
     "example_sentence": "Applying kaizen, she improved her morning routine by one small step each week.",
     "subject": "Productivity, Mindset",
     "personal_notes": "Heard this in the High Achiever OS track — pairs well with the 30-day rules exercise.",
     "source_path": P("B. The_High_Achiever_Operating_System.m4a"), "source_timestamp": 75,
     "created_at": iso(2)},
    {"id": 2, "term": "Compounding",
     "definition": "Growth that builds on itself: each gain is added to the base that the next gain is calculated on.",
     "example_sentence": "Reading ten pages a day looks small until compounding turns it into twelve books a year.",
     "subject": "Finance, Mindset", "personal_notes": "",
     "source_path": P("C. Bypassing_the_brain_s_bouncer_for_wealth.m4a"), "source_timestamp": 402,
     "created_at": iso(5)},
    {"id": 3, "term": "Leverage",
     "definition": "Using a tool, system or resource so that a small input produces a much larger output.",
     "example_sentence": "Writing the process down once gave her leverage — the team no longer needed her for every step.",
     "subject": "Business", "personal_notes": "", "created_at": iso(9)},
    {"id": 4, "term": "Equanimity",
     "definition": "Mental calmness and evenness of temper, especially in a difficult situation.",
     "example_sentence": "He met the bad news with equanimity and moved straight to the next step.",
     "subject": "Philosophy, Mindset", "personal_notes": "", "created_at": iso(14)},
    {"id": 5, "term": "Opportunity cost",
     "definition": "The value of the next-best option you give up when you choose something.",
     "example_sentence": "The opportunity cost of the extra meeting was the deep-work hour it replaced.",
     "subject": "Finance", "personal_notes": "", "created_at": iso(21)},
]

TOPICS = [
    {"id": 11, "topic": "Second-order thinking",
     "simple_explanation": "Looking past the immediate result of a decision and asking “and then what?” — what happens next, and what happens after that.",
     "full_explanation": "Most decisions are judged by their first effect: does this help right now? Second-order thinking keeps going. It asks what the first effect will cause, and what that will cause in turn...",
     "subject": "Decision-making", "personal_notes": "", "created_at": iso(3)},
    {"id": 12, "topic": "Habit stacking",
     "simple_explanation": "Attaching a new habit to one you already do every day, so the old habit becomes the reminder for the new one.",
     "full_explanation": "", "subject": "Habits, Productivity", "personal_notes": "",
     "source_path": P("Daily Affirmations/Morning_gratitude_script.m4a"), "source_timestamp": 48,
     "created_at": iso(8)},
    {"id": 13, "topic": "Delayed gratification", "simple_explanation": "", "full_explanation": "",
     "subject": "Mindset", "personal_notes": "", "created_at": iso(12)},
]

IDEAS = [
    {"id": 21, "title": "Sunday 20-minute review ritual",
     "original_note": "What if every Sunday I spent 20 mins going back through the week's vault entries and picked ONE to actually act on?",
     "summary": "A weekly 20-minute Sunday review of the week's vault entries, ending with one entry chosen to put into practice.",
     "reflection": "", "subject": "Habits, Reflection", "created_at": iso(1)},
    {"id": 22, "title": "Teach what I'm learning",
     "original_note": "Explaining a track to someone else after listening — would make me listen differently.",
     "summary": "", "reflection": "", "subject": "Learning", "created_at": iso(6)},
]

DEFINE_KAIZEN = {
    "definition": "Continuous improvement through small, incremental changes made consistently over time.",
    "example": "Applying kaizen, she improved her morning routine by one small step each week.",
    "language": "Japanese",
    "suggested_subjects": ["Productivity", "Mindset", "Japanese culture"],
}
ASK_ANSWER = {
    "answer": "Start with something so small it feels almost too easy — one minute, one page, one rep — and only add the next step once the first has become automatic. The point is consistency, not size.",
    "example": "Instead of a new hour-long routine, add two minutes of stretching after brushing your teeth.",
}

def b64json(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()
