/**
 * clickup.js
 * -----------------------------------------------------------------------
 * Thin wrapper around the ClickUp API. Every request goes through the
 * proxy Worker (see /worker) instead of hitting api.clickup.com
 * directly, for two reasons:
 *
 *   1. ClickUp's API does not send CORS headers, so browsers block
 *      direct fetch() calls to it from a page on another domain.
 *   2. Your ClickUp token lives as a secret on the Worker, never in
 *      this front-end code or in localStorage. Anyone who views
 *      source on the deployed GitHub Pages site cannot see it.
 * -----------------------------------------------------------------------
 */

const ClickUp = (() => {
  function proxyUrl() {
    const url = Storage.getSettings().proxyUrl;
    if (!url) throw new Error('NO_PROXY_URL');
    return url.replace(/\/$/, '');
  }

  const PRIORITY_MAP = { Urgent: 1, High: 2, Normal: 3, Low: 4 };

  function buildTaskPayload(entry) {
    const payload = { name: entry.fields.title || entry.fields.name || '(untitled)' };

    const descriptionParts = [];
    if (entry.fields.description) descriptionParts.push(entry.fields.description);
    if (entry.fields.company) descriptionParts.push(`Company: ${entry.fields.company}`);
    if (entry.fields.contactMethod) descriptionParts.push(`Best contact method: ${entry.fields.contactMethod}`);
    if (entry.fields.opportunity) descriptionParts.push(`Opportunity: ${entry.fields.opportunity}`);
    if (entry.transcript) descriptionParts.push(`\n— Voice transcript —\n${entry.transcript}`);
    if (descriptionParts.length) payload.description = descriptionParts.join('\n\n');

    if (entry.fields.priority && PRIORITY_MAP[entry.fields.priority]) {
      payload.priority = PRIORITY_MAP[entry.fields.priority];
    }
    if (entry.fields.dueDate) {
      payload.due_date = new Date(entry.fields.dueDate).getTime();
      payload.due_date_time = false;
    }
    if (entry.fields.tags) {
      payload.tags = entry.fields.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return payload;
  }

  async function createTask(listId, entry) {
    const res = await fetch(`${proxyUrl()}/list/${listId}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildTaskPayload(entry))
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CLICKUP_${res.status}: ${text}`);
    }
    return res.json();
  }

  async function uploadAttachment(taskId, file) {
    const form = new FormData();
    form.append('attachment', file, file.name);
    const res = await fetch(`${proxyUrl()}/task/${taskId}/attachment`, {
      method: 'POST',
      body: form
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CLICKUP_ATTACH_${res.status}: ${text}`);
    }
    return res.json();
  }

  async function testConnection() {
    const res = await fetch(`${proxyUrl()}/user`, { method: 'GET' });
    if (!res.ok) throw new Error(`CLICKUP_${res.status}`);
    return res.json();
  }

  return { createTask, uploadAttachment, testConnection };
})();
