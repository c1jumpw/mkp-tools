/**
 * =========================================================================
 * config.js — Dispatch routing & destination map
 * =========================================================================
 * PURPOSE
 *   This file is the entire "brain" of Dispatch. It defines:
 *     1. DEFAULT_PROXY_URL   — where the app sends requests (the Cloudflare
 *                               Worker deployed in /worker, NOT ClickUp
 *                               directly — see clickup.js for why).
 *     2. FIELD_SCHEMAS        — reusable sets of form fields (Task, Note,
 *                               Light Bulb, Contact, etc).
 *     3. ENTITIES              — the 6 ClickUp Spaces (businesses/areas),
 *                               each with a list of Capture Types that
 *                               point at a specific ClickUp List ID.
 *
 *   app.js reads ENTITIES + FIELD_SCHEMAS to build every screen. Nothing
 *   about routing or form fields is hardcoded anywhere else — to change
 *   what goes where, edit this file only.
 *
 * DATA FLOW
 *   User picks Entity → picks Capture Type → fills the fields defined by
 *   that type's `schema` → app.js sends fields + listId to clickup.js →
 *   clickup.js POSTs to DEFAULT_PROXY_URL (the Worker) → Worker creates
 *   the task in the matching ClickUp List.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - DEFAULT_PROXY_URL must point at a live, deployed Worker (see
 *     /worker/clickup-proxy.js) that already has the CLICKUP_TOKEN
 *     secret set. This file holds no credentials — only a public URL.
 *   - Every `listId` below is a ClickUp List ID copied from the list's
 *     URL in the ClickUp web app: app.clickup.com/<team>/v/li/<LIST_ID>.
 *   - Entries flagged `verify: true` had ambiguous/duplicate source data
 *     when this file was generated — see the "verify" note near ENTITIES.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial routing map generated from the user's ClickUp
 *                    space/list export. Proxy URL was NOT set yet (app
 *                    prompted for it manually in Settings).
 *   v2  2026-07-23  Added DEFAULT_PROXY_URL now that the Worker is live
 *                    at https://dispatch-clickup-proxy.c1-jumpw.workers.dev
 *                    (deployed in Step 6 of setup). Settings now
 *                    auto-fills instead of requiring manual entry.
 *                    Added full file/function-level documentation per
 *                    user's commenting standard. No routing changes.
 * =========================================================================
 */

// -----------------------------------------------------------------------
// DEFAULT_PROXY_URL
//   The live Cloudflare Worker that proxies requests to ClickUp.
//   This is a PUBLIC URL, not a secret — it's safe for it to live here
//   and be visible in the deployed site's source. The actual ClickUp
//   token lives only on the Worker (as an encrypted secret), never here.
//   storage.js falls back to this value if the user hasn't manually
//   overridden the Worker URL in Settings (e.g. while testing a second,
//   separate Worker).
// -----------------------------------------------------------------------
const DEFAULT_PROXY_URL = 'https://dispatch-clickup-proxy.c1-jumpw.workers.dev';

// -----------------------------------------------------------------------
// WORKSPACE_ID
//   The ClickUp Workspace (Team) all the lists below belong to. Currently
//   unused by app logic directly (each List ID is globally unique in
//   ClickUp's API), but kept here for reference / future use, e.g. if we
//   ever need to build a "open in ClickUp" deep link.
// -----------------------------------------------------------------------
const WORKSPACE_ID = '25724879';

// -----------------------------------------------------------------------
// FIELD_SCHEMAS
//   Reusable field sets. Every capture type (below, in ENTITIES) points
//   at one of these by name instead of redefining its own fields, so a
//   change here (e.g. adding a field to every "task") applies everywhere
//   at once.
//
//   Supported field `type` values (rendered by app.js → renderField()):
//     text      — single-line input
//     textarea  — multi-line input; set `primary: true` on the field
//                 that dictation (speech-to-text) should type into
//     select    — dropdown; requires an `options: [...]` array
//     date      — native date picker
//     priority  — dropdown fixed to ClickUp's 4-level priority scale
//                 (Urgent/High/Normal/Low), mapped to ClickUp's 1-4
//                 integers in clickup.js's PRIORITY_MAP
// -----------------------------------------------------------------------
const FIELD_SCHEMAS = {
  task: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'What needs to get done?' },
    { key: 'description', label: 'Details', type: 'textarea', placeholder: 'Any context, links, or notes…' },
    { key: 'priority', label: 'Priority', type: 'priority' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'tags', label: 'Tags', type: 'text', placeholder: 'comma, separated, tags' }
  ],
  note: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Give it a short label' },
    { key: 'description', label: 'Note', type: 'textarea', placeholder: 'Dump everything here…', primary: true }
  ],
  lightbulb: [
    { key: 'title', label: 'Idea', type: 'text', required: true, placeholder: 'The idea, in one line' },
    { key: 'description', label: 'Details', type: 'textarea', placeholder: 'What made you think of this? Where could it go?' },
    { key: 'opportunity', label: 'Opportunity', type: 'select', options: ['High', 'Medium', 'Low'] },
    { key: 'tags', label: 'Category', type: 'text', placeholder: 'e.g. content, ops, product' }
  ],
  contact: [
    { key: 'title', label: 'Name', type: 'text', required: true, placeholder: 'Who do you need to reach out to?' },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'contactMethod', label: 'Best way to reach them', type: 'select', options: ['Phone', 'Email', 'Text', 'In person', 'Other'] },
    { key: 'description', label: 'Notes', type: 'textarea', placeholder: 'Why you\u2019re reaching out…' },
    { key: 'dueDate', label: 'Follow up by', type: 'date' }
  ],
  lead: [
    { key: 'title', label: 'Lead name', type: 'text', required: true },
    { key: 'company', label: 'Company', type: 'text' },
    { key: 'contactMethod', label: 'Source', type: 'select', options: ['Referral', 'Inbound', 'Cold outreach', 'Event', 'Other'] },
    { key: 'description', label: 'Notes', type: 'textarea' }
  ],
  log: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Details', type: 'textarea', primary: true }
  ],
  request: [
    { key: 'title', label: 'What do you need?', type: 'text', required: true },
    { key: 'description', label: 'Details', type: 'textarea', placeholder: 'Anything the fulfiller needs to know…' }
  ]
};

// -----------------------------------------------------------------------
// ENTITIES
//   Each entry = one ClickUp Space (a business/area). `captureTypes`
//   within it = the buttons shown on the "Type" screen for that entity;
//   each one maps directly to a destination ClickUp List via `listId`.
//
//   `verify: true` flags entries where the original ClickUp export had
//   two different list names sharing the exact same URL/ID — almost
//   certainly a copy-paste artifact rather than the real destination.
//   These are still wired up and functional (so the app isn't broken
//   while you check), but should be confirmed against the real list ID
//   in ClickUp before relying on them for anything important:
//     app.clickup.com/<workspace>/v/li/<LIST_ID>  ← the number after /li/
//   Flagged currently: MKP → Contact Follow-up, MKP → Meeting Note,
//   Super Admin → Light Bulb, Unywebs → New Hosting Account Request.
// -----------------------------------------------------------------------
const ENTITIES = [
  {
    id: 'mkp',
    name: 'MKP',
    subtitle: 'Personal',
    color: '#E8A33D',
    captureTypes: [
      { id: 'task', label: 'To-Do', icon: 'check', schema: 'task', listId: '901702176129' },
      { id: 'lightbulb', label: 'Light Bulb', icon: 'bulb', schema: 'lightbulb', listId: '901710575809' },
      { id: 'contact', label: 'Contact Follow-up', icon: 'user', schema: 'contact', listId: '901702176129', verify: true },
      { id: 'meeting', label: 'Meeting Note', icon: 'calendar', schema: 'note', listId: '901702176129', verify: true },
      { id: 'accounting', label: 'Accounting Item', icon: 'dollar', schema: 'task', listId: '901702176148' },
      { id: 'subscription', label: 'Subscription', icon: 'repeat', schema: 'task', listId: '901711351925' }
    ]
  },
  {
    id: 'super-admin',
    name: 'Super Admin',
    subtitle: 'Org management',
    color: '#7C8AF6',
    captureTypes: [
      { id: 'task', label: 'Task', icon: 'check', schema: 'task', listId: '901702161386' },
      { id: 'lightbulb', label: 'Light Bulb', icon: 'bulb', schema: 'lightbulb', listId: '901702161386', verify: true },
      { id: 'process', label: 'Process / System Idea', icon: 'gear', schema: 'note', listId: '901711745105' },
      { id: 'client-note', label: 'Client Account Note', icon: 'building', schema: 'log', listId: '901711853904' },
      { id: 'receivable', label: 'Receivable', icon: 'dollar', schema: 'task', listId: '901703199842' },
      { id: 'payable', label: 'Payable', icon: 'dollar', schema: 'task', listId: '901702161436' },
      { id: 'subscription', label: 'Subscription', icon: 'repeat', schema: 'task', listId: '901711350683' },
      { id: 'team-note', label: 'Team Directory Update', icon: 'user', schema: 'log', listId: '901711759484' },
      { id: 'automation', label: 'Automation Idea', icon: 'bulb', schema: 'lightbulb', listId: '901711237466' }
    ]
  },
  {
    id: 'crm-ops',
    name: 'CRM & Operations',
    subtitle: 'Clients & pipeline',
    color: '#4CAF7D',
    captureTypes: [
      { id: 'lead', label: 'New Lead', icon: 'user', schema: 'lead', listId: '901710477809' },
      { id: 'pipeline', label: 'Pipeline Update', icon: 'check', schema: 'task', listId: '901710326878' },
      { id: 'contact', label: 'New Contact', icon: 'user', schema: 'contact', listId: '901710477009' },
      { id: 'company', label: 'Company / Account Note', icon: 'building', schema: 'log', listId: '901710481777' },
      { id: 'task', label: 'CRM Task', icon: 'check', schema: 'task', listId: '901714539764' },
      { id: 'activity', label: 'Activity Log', icon: 'note', schema: 'log', listId: '901715117797' },
      { id: 'email', label: 'Email Follow-up', icon: 'note', schema: 'note', listId: '901715226645' },
      { id: 'lead-magnet', label: 'Lead Magnet Idea', icon: 'bulb', schema: 'lightbulb', listId: '901715467342' }
    ]
  },
  {
    id: 'jtg',
    name: 'JTG Admin',
    subtitle: 'Jump Tech Group — agency',
    color: '#E2604F',
    captureTypes: [
      { id: 'task-f5ceo', label: 'F5 CEO Task', icon: 'check', schema: 'task', listId: '901702184622' },
      { id: 'task-bms', label: 'BMS Task', icon: 'check', schema: 'task', listId: '901702183494' },
      { id: 'task-f5', label: 'F5 Task', icon: 'check', schema: 'task', listId: '901702200453' },
      { id: 'lightbulb', label: 'Light Bulb', icon: 'bulb', schema: 'lightbulb', listId: '901710065006' },
      { id: 'content', label: 'Content Idea', icon: 'note', schema: 'note', listId: '901710065625' }
    ]
  },
  {
    id: 'mambay',
    name: 'Mambay Co',
    subtitle: 'Independent projects & brand',
    color: '#D06BC2',
    captureTypes: [
      { id: 'task', label: 'Task', icon: 'check', schema: 'task', listId: '901702165849' },
      { id: 'lightbulb', label: 'Light Bulb', icon: 'bulb', schema: 'lightbulb', listId: '901710123795' },
      { id: 'content', label: 'Content Idea', icon: 'note', schema: 'note', listId: '901710123796' }
    ]
  },
  {
    id: 'unywebs',
    name: 'Unywebs',
    subtitle: 'Marketplace / reseller',
    color: '#3FA7D6',
    captureTypes: [
      { id: 'task', label: 'Task', icon: 'check', schema: 'task', listId: '901702157771' },
      { id: 'lightbulb', label: 'Light Bulb', icon: 'bulb', schema: 'lightbulb', listId: '901710960459' },
      { id: 'content', label: 'Content Idea', icon: 'note', schema: 'note', listId: '901711428018' },
      { id: 'req-hosting', label: 'New Hosting Account Request', icon: 'gear', schema: 'request', listId: '901710065625', verify: true },
      { id: 'req-systemsio', label: 'New Systems.io Account Request', icon: 'gear', schema: 'request', listId: '188376548' },
      { id: 'req-zoho', label: 'New Zoho Email Request', icon: 'gear', schema: 'request', listId: '901701551198' }
    ]
  }
];
