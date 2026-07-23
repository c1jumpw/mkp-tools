/**
 * config.js
 * -----------------------------------------------------------------------
 * This file is the entire "brain" of Dispatch. It maps every capture
 * type to a real ClickUp List ID. Everything else in the app (form
 * fields, colors, labels) is generated from this file.
 *
 * ⚠️  A few List IDs below were duplicated in the ClickUp export this
 *     config was built from (the same URL appeared next to two
 *     different list names). Those entries are flagged with VERIFY.
 *     To fix: open the list in ClickUp → the URL is
 *     app.clickup.com/<workspace>/v/li/<LIST_ID> → copy the number
 *     after /li/ and paste it in below.
 *
 * You do not need to touch any other file to change routing, add a
 * capture type, or add a whole new entity — just edit this file.
 * -----------------------------------------------------------------------
 */

const WORKSPACE_ID = '25724879';

// -----------------------------------------------------------------------
// Reusable field schemas. Every capture type points at one of these.
// Field types supported by the renderer: text, textarea, select, date,
// priority (maps to ClickUp's 1-4 priority scale).
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
// Entities = ClickUp Spaces. Each capture type = one destination List.
// Colors are used for the entity tiles on the picker screen.
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
