/**
 * Parse a project MD file in the ISH standard format.
 * Returns structured data ready to pre-fill an invoice form.
 */
function parseMD(content) {
  const result = {
    project_name: '',
    client: { name: '', company: '', email: '', phone: '' },
    overview: '',
    phases: [],    // [{label, items: [{description, amount}]}]
    items_flat: [], // [{phase_label, description, amount}]
    payment_terms: [],
    total: 0,
    timeline: { start: '', end: '' },
    notes: ''
  };

  const lines = content.split('\n');
  let section = null;
  let currentPhase = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Title
    if (line.startsWith('# ') && !result.project_name) {
      result.project_name = line.slice(2).trim();
      continue;
    }

    // Section headers
    if (line.startsWith('## ')) {
      section = line.slice(3).trim().toLowerCase();
      currentPhase = null;
      continue;
    }

    // Phase headers inside Scope of Work
    if (line.startsWith('### ') && section === 'scope of work') {
      currentPhase = { label: line.slice(4).trim(), items: [] };
      result.phases.push(currentPhase);
      continue;
    }

    // Client fields
    if (section === 'client' && line.startsWith('- ')) {
      const [key, ...rest] = line.slice(2).split(':');
      const val = rest.join(':').trim();
      const k = key.trim().toLowerCase();
      if (k === 'name')    result.client.name    = val;
      if (k === 'company') result.client.company = val;
      if (k === 'email')   result.client.email   = val;
      if (k === 'phone')   result.client.phone   = val;
      continue;
    }

    // Overview
    if (section === 'overview' && line && !line.startsWith('#')) {
      result.overview += (result.overview ? ' ' : '') + line;
      continue;
    }

    // Scope items
    if (section === 'scope of work' && currentPhase && line.startsWith('- ')) {
      const text = line.slice(2).trim();
      // Extract amount: "Feature description — MYR 500" or "Feature — MYR 500"
      const amountMatch = text.match(/[—\-–]\s*MYR\s*([\d,]+(?:\.\d+)?)\s*$/i);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;
      const description = amountMatch ? text.slice(0, text.lastIndexOf(amountMatch[0])).replace(/[—\-–]\s*$/, '').trim() : text;
      currentPhase.items.push({ description, amount });
      result.items_flat.push({ phase_label: currentPhase.label, description, amount });
      continue;
    }

    // Payment terms
    if (section === 'payment terms' && line.startsWith('- ')) {
      const text = line.slice(2).trim();
      const amountMatch = text.match(/MYR\s*([\d,]+(?:\.\d+)?)/i);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;
      const percentMatch = text.match(/\((\d+)%\)/);
      const percent = percentMatch ? parseInt(percentMatch[1]) : 0;
      const label = text.split(':')[0].trim();
      result.payment_terms.push({ label, percent, amount });
      continue;
    }

    // Total
    if (section === 'total' && line.match(/MYR\s*[\d,]+/i)) {
      const m = line.match(/MYR\s*([\d,]+(?:\.\d+)?)/i);
      if (m) result.total = parseFloat(m[1].replace(',', ''));
      continue;
    }

    // Timeline
    if (section === 'timeline' && line.startsWith('- ')) {
      const text = line.slice(2).trim().toLowerCase();
      if (text.startsWith('start:')) result.timeline.start = text.slice(6).trim();
      if (text.startsWith('estimated completion:')) result.timeline.end = text.slice(21).trim();
      continue;
    }

    // Notes
    if (section === 'notes' && line && !line.startsWith('#')) {
      result.notes += (result.notes ? '\n' : '') + line;
      continue;
    }
  }

  return result;
}

module.exports = { parseMD };
